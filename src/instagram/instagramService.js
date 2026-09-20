const crypto = require('crypto');
const db = require('../db');

const apiVersion = process.env.META_API_VERSION || 'v25.0';
const requiredConfig = ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI', 'META_TOKEN_ENCRYPTION_KEY'];

function ensureConfiguration() {
  const missing = requiredConfig.filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`Instagram integration is not configured. Missing: ${missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }
  if (!/^[a-f0-9]{64}$/i.test(process.env.META_TOKEN_ENCRYPTION_KEY)) {
    const error = new Error('META_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key.');
    error.statusCode = 500;
    throw error;
  }
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function publicAccount(account) {
  return {
    id: account.instagram_user_id,
    username: account.username,
    status: account.expires_at > Date.now() ? 'Connected' : 'Token expired',
    expiresAt: new Date(account.expires_at).toISOString(),
    connectedAt: account.connected_at
  };
}

function metaErrorMessage(data, fallback) {
  return data?.error?.message || data?.error_message || data?.message || fallback;
}

async function exchangeCode(code) {
  ensureConfiguration();

  const form = new FormData();
  form.set('client_id', process.env.META_APP_ID);
  form.set('client_secret', process.env.META_APP_SECRET);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', process.env.META_REDIRECT_URI);
  form.set('code', code);

  const response = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    const error = new Error(`Instagram code exchange failed (HTTP ${response.status}): ${metaErrorMessage(data, 'No access token returned.')}`);
    error.statusCode = 502;
    error.stage = 'code_exchange';
    error.metaError = data.error;
    throw error;
  }

  const longLivedUrl = new URL('https://graph.instagram.com/access_token');
  longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longLivedUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
  longLivedUrl.searchParams.set('access_token', data.access_token);

  const longLivedResponse = await fetch(longLivedUrl);
  const longLivedData = await longLivedResponse.json().catch(() => ({}));

  if (!longLivedResponse.ok || !longLivedData.access_token) {
    const error = new Error(`Instagram long-lived token exchange failed (HTTP ${longLivedResponse.status}): ${metaErrorMessage(longLivedData, 'No long-lived access token returned.')}`);
    error.statusCode = 502;
    error.stage = 'long_lived_exchange';
    error.metaError = longLivedData.error;
    throw error;
  }

  return { accessToken: longLivedData.access_token, expiresIn: Number(longLivedData.expires_in) || 0 };
}

async function fetchProfile(accessToken) {
  const profileUrl = new URL(`https://graph.instagram.com/${apiVersion}/me`);
  profileUrl.searchParams.set('fields', 'user_id,username');
  profileUrl.searchParams.set('access_token', accessToken);

  const response = await fetch(profileUrl);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.user_id) {
    const error = new Error(`Instagram profile lookup failed (HTTP ${response.status}): ${metaErrorMessage(data, 'No Instagram user profile returned.')}`);
    error.statusCode = 502;
    error.stage = 'profile_lookup';
    error.metaError = data.error;
    throw error;
  }

  return { userId: String(data.user_id), username: data.username || 'Instagram account' };
}

async function subscribeToWebhooks(instagramUserId, accessToken) {
  const url = new URL(`https://graph.instagram.com/${apiVersion}/${instagramUserId}/subscribed_apps`);
  url.searchParams.set('subscribed_fields', 'comments');

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success !== true) {
    const error = new Error(`Instagram webhook subscription failed (HTTP ${response.status}): ${metaErrorMessage(data, 'Subscription was not accepted.')}`);
    error.statusCode = response.status || 502;
    error.stage = 'webhook_subscription';
    error.metaError = data.error;
    throw error;
  }

  console.log(`Instagram webhook subscription succeeded for account ${instagramUserId}.`);
  return data;
}

async function saveAccount(userId, profile, token) {
  const encrypted = encryptToken(token.accessToken);
  await db.run(
    `INSERT INTO instagram_accounts
    (owner_user_id, instagram_user_id, username, ciphertext, iv, tag, expires_at, connected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, instagram_user_id) DO UPDATE SET
    username=excluded.username, ciphertext=excluded.ciphertext, iv=excluded.iv,
    tag=excluded.tag, expires_at=excluded.expires_at, connected_at=excluded.connected_at`,
    [userId, profile.userId, profile.username, encrypted.ciphertext, encrypted.iv, encrypted.tag, Date.now() + token.expiresIn * 1000, new Date().toISOString()]
  );
  await subscribeToWebhooks(profile.userId, token.accessToken);
}

async function listAccounts(userId) {
  const accounts = await db.all('SELECT * FROM instagram_accounts WHERE owner_user_id = ?', [userId]);
  return accounts.map(publicAccount);
}

async function listReels(ownerUserId, instagramUserId) {
  const accessToken = await getDecryptedTokenForAccount(ownerUserId, instagramUserId);
  const items = [];
  let nextUrl = new URL(`https://graph.instagram.com/${apiVersion}/${instagramUserId}/media`);
  nextUrl.searchParams.set('fields', 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url');
  nextUrl.searchParams.set('limit', '50');
  nextUrl.searchParams.set('access_token', accessToken);

  for (let page = 0; page < 3 && nextUrl; page += 1) {
    const response = await fetch(nextUrl);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Instagram media lookup failed (HTTP ${response.status}): ${metaErrorMessage(data, 'Unable to load Instagram media.')}`);
      error.statusCode = response.status || 502;
      error.stage = 'media_lookup';
      error.metaError = data.error;
      throw error;
    }
    for (const media of Array.isArray(data.data) ? data.data : []) {
      if (media.media_product_type === 'REELS') items.push({
        id: String(media.id),
        caption: String(media.caption || ''),
        permalink: media.permalink || '',
        timestamp: media.timestamp || null,
        thumbnailUrl: media.thumbnail_url || null
      });
    }
    const next = data.paging?.next;
    nextUrl = next ? new URL(next) : null;
  }
  return items;
}

async function resolveReelUrl(ownerUserId, instagramUserId, reelUrl) {
  const raw = String(reelUrl || '').trim();
  if (!raw) return null;
  let requested;
  try {
    requested = new URL(raw);
  } catch {
    const error = new Error('Enter a valid Instagram Reel link.');
    error.statusCode = 400;
    throw error;
  }
  if (requested.hostname !== 'instagram.com' && !requested.hostname.endsWith('.instagram.com')) {
    const error = new Error('The Reel link must be an Instagram URL.');
    error.statusCode = 400;
    throw error;
  }
  const normalizedPath = requested.pathname.replace(/\\/+$/, '').toLowerCase();
  const reels = await listReels(ownerUserId, instagramUserId);
  const match = reels.find((item) => {
    try {
      const u = new URL(item.permalink);
      return u.pathname.replace(/\\/+$/, '').toLowerCase() === normalizedPath;
    } catch {
      return false;
    }
  });
  if (!match) {
    const error = new Error('That Reel could not be found in the connected Instagram account. Make sure the Reel is published on that account and try again.');
    error.statusCode = 422;
    throw error;
  }
  return match;
}

async function disconnect(userId, instagramUserId) {
  const result = await db.run('DELETE FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?', [userId, instagramUserId]);
  if (!result.changes) {
    const error = new Error('Instagram account not found.');
    error.statusCode = 404;
    throw error;
  }
}

async function listAllAccounts() {
  return db.all(`SELECT owner_user_id AS ownerUserId, instagram_user_id AS instagramUserId,
    username, expires_at AS expiresAt, connected_at AS connectedAt FROM instagram_accounts`);
}

function decryptToken(ciphertext, iv, tag) {
  ensureConfiguration();
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY, 'hex'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

async function getAccount(ownerUserId, instagramUserId) {
  return db.get('SELECT * FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?', [ownerUserId, instagramUserId]);
}

async function getDecryptedTokenForAccount(ownerUserId, instagramUserId) {
  const account = await getAccount(ownerUserId, instagramUserId);
  if (!account) {
    const error = new Error('Connected Instagram account not found.');
    error.statusCode = 404;
    throw error;
  }
  if (account.expires_at <= Date.now()) {
    const error = new Error('Instagram access token has expired. Please reconnect your account.');
    error.statusCode = 401;
    throw error;
  }
  return decryptToken(account.ciphertext, account.iv, account.tag);
}

async function getDecryptedTokenByInstagramUserId(instagramUserId, ownerUserId) {
  const account = ownerUserId
    ? await db.get('SELECT * FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?', [ownerUserId, instagramUserId])
    : await db.get('SELECT * FROM instagram_accounts WHERE instagram_user_id = ? ORDER BY expires_at DESC LIMIT 1', [instagramUserId]);
  if (!account) {
    const error = new Error(`Connected Instagram account ${instagramUserId} not found.`);
    error.statusCode = 404;
    throw error;
  }
  if (account.expires_at <= Date.now()) {
    const error = new Error('Instagram access token has expired.');
    error.statusCode = 401;
    throw error;
  }
  return { accessToken: decryptToken(account.ciphertext, account.iv, account.tag), ownerUserId: account.owner_user_id, username: account.username };
}

async function sendPrivateReply(instagramUserId, commentId, messageText, accessToken) {
  const url = `https://graph.instagram.com/${apiVersion}/${instagramUserId}/messages`;
  const bodyData = { recipient: { comment_id: commentId }, message: { text: messageText } };
  let response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(bodyData) });
  let data = await response.json().catch(() => ({}));

  if (!response.ok && (response.status === 404 || data.error?.code === 100 || data.error?.type === 'OAuthException')) {
    const fallbackUrl = `https://graph.facebook.com/${apiVersion}/${instagramUserId}/messages`;
    const fallbackResponse = await fetch(fallbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(bodyData) });
    const fallbackData = await fallbackResponse.json().catch(() => ({}));
    if (fallbackResponse.ok && (fallbackData.message_id || fallbackData.id)) return fallbackData;
    if (!fallbackResponse.ok) { data = fallbackData; response = fallbackResponse; }
  }

  if (!response.ok || (data.error && !data.message_id && !data.id)) {
    const error = new Error(`Instagram API Error: ${metaErrorMessage(data, 'Instagram API call failed.')}`);
    error.statusCode = response.status || 502;
    error.metaError = data.error;
    throw error;
  }

  return data;
}

module.exports = {
  ensureConfiguration,
  exchangeCode,
  fetchProfile,
  saveAccount,
  subscribeToWebhooks,
  listAccounts,
  listReels,
  resolveReelUrl,
  disconnect,
  listAllAccounts,
  getAccount,
  decryptToken,
  getDecryptedTokenForAccount,
  getDecryptedTokenByInstagramUserId,
  sendPrivateReply
};
