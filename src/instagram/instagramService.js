const crypto = require('crypto');
const db = require('../db');

const apiVersion = process.env.META_API_VERSION || 'v21.0';
const requiredConfig = ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI', 'META_TOKEN_ENCRYPTION_KEY'];

// 5-minute cache for media/reels to prevent lag and Meta rate limits
const reelsCache = new Map();

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
  profileUrl.searchParams.set('fields', 'user_id,username,name,profile_picture_url,followers_count');
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

  return {
    userId: String(data.user_id),
    username: data.username || 'Instagram account',
    name: data.name || '',
    profilePictureUrl: data.profile_picture_url || null,
    followersCount: Number(data.followers_count) || 0
  };
}

async function subscribeToWebhooks(instagramUserId, accessToken) {
  const url = new URL(`https://graph.instagram.com/${apiVersion}/${instagramUserId}/subscribed_apps`);
  url.searchParams.set('subscribed_fields', 'comments,messages');

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success !== true) {
    const fallbackUrl = new URL(`https://graph.facebook.com/${apiVersion}/${instagramUserId}/subscribed_apps`);
    fallbackUrl.searchParams.set('subscribed_fields', 'comments,messages');
    const fbRes = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const fbData = await fbRes.json().catch(() => ({}));
    if (fbRes.ok && fbData.success === true) {
      console.log(`Instagram webhook subscription succeeded via Facebook Graph for account ${instagramUserId}.`);
      return fbData;
    }

    console.warn(`Instagram webhook subscription warning (HTTP ${response.status}): ${metaErrorMessage(data, 'Subscription could not be verified automatically.')}`);
    return data;
  }

  console.log(`Instagram webhook subscription succeeded for account ${instagramUserId}.`);
  return data;
}

async function saveAccount(userId, profile, token) {
  const encrypted = encryptToken(token.accessToken);
  await db.run(
    `INSERT INTO instagram_accounts
    (owner_user_id, instagram_user_id, username, ciphertext, iv, tag, expires_at, connected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, profile.userId, profile.username, encrypted.ciphertext, encrypted.iv, encrypted.tag, Date.now() + token.expiresIn * 1000, new Date().toISOString()]
  );
  await subscribeToWebhooks(profile.userId, token.accessToken);
}

async function listAccounts(userId) {
  const accounts = await db.getInstagramAccounts(userId);
  return accounts.map(publicAccount);
}

async function listReels(ownerUserId, instagramUserId, forceRefresh = false) {
  const cacheKey = `${ownerUserId}:${instagramUserId}`;
  const cached = reelsCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expires > Date.now()) {
    return cached.items;
  }

  const accessToken = await getDecryptedTokenForAccount(ownerUserId, instagramUserId);
  const items = [];
  let nextUrl = new URL(`https://graph.instagram.com/${apiVersion}/${instagramUserId}/media`);
  nextUrl.searchParams.set('fields', 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,comments_count,like_count');
  nextUrl.searchParams.set('limit', '50');
  nextUrl.searchParams.set('access_token', accessToken);

  try {
    for (let page = 0; page < 2 && nextUrl; page += 1) {
      const response = await fetch(nextUrl);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        break;
      }
      for (const media of Array.isArray(data.data) ? data.data : []) {
        items.push({
          id: String(media.id),
          caption: String(media.caption || ''),
          permalink: media.permalink || '',
          timestamp: media.timestamp || null,
          thumbnailUrl: media.thumbnail_url || null,
          mediaType: media.media_product_type || media.media_type || 'POST',
          commentsCount: Number(media.comments_count) || 0,
          likeCount: Number(media.like_count) || 0
        });
      }
      const next = data.paging?.next;
      nextUrl = next ? new URL(next) : null;
    }
  } catch (err) {
    console.error('Failed to fetch reels from Instagram API:', err.message);
  }

  reelsCache.set(cacheKey, { items, expires: Date.now() + 5 * 60 * 1000 });
  return items;
}

async function resolveReelUrl(ownerUserId, instagramUserId, reelUrl) {
  const raw = String(reelUrl || '').trim();
  if (!raw) return null;

  // Direct media ID match
  if (/^\d+$/.test(raw)) {
    return { id: raw, permalink: `https://www.instagram.com/p/${raw}/` };
  }

  let requested;
  try {
    requested = new URL(raw);
  } catch {
    const error = new Error('Enter a valid Instagram Reel link.');
    error.statusCode = 400;
    throw error;
  }
  if (requested.hostname !== 'instagram.com' && !requested.hostname.endsWith('.instagram.com')) {
    const error = new Error('The link must be an Instagram URL.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedPath = requested.pathname.replace(/\/+$/, '').toLowerCase();
  const reels = await listReels(ownerUserId, instagramUserId);
  const match = reels.find((item) => {
    try {
      const u = new URL(item.permalink);
      return u.pathname.replace(/\/+$/, '').toLowerCase() === normalizedPath;
    } catch {
      return false;
    }
  });

  if (!match) {
    // If exact match not in first pages, permit using the URL directly to prevent blocking the user
    return { id: null, permalink: raw };
  }
  return match;
}

async function disconnect(userId, instagramUserId) {
  if (db.collections) {
    const { instagramAccounts } = db.collections();
    const ids = [String(instagramUserId)];
    if (!isNaN(Number(instagramUserId))) ids.push(Number(instagramUserId));
    await instagramAccounts.deleteMany({
      $or: [
        { instagram_user_id: { $in: ids }, owner_user_id: String(userId) },
        { instagram_user_id: { $in: ids } }
      ]
    });
  } else {
    await db.run('DELETE FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?', [userId, instagramUserId]);
  }
  reelsCache.delete(`${userId}:${instagramUserId}`);
}

async function listAllAccounts() {
  const accounts = await db.collections().instagramAccounts.find({}).toArray();
  return accounts.map((a) => ({
    ownerUserId: a.owner_user_id,
    instagramUserId: a.instagram_user_id,
    username: a.username,
    expiresAt: a.expires_at,
    connectedAt: a.connected_at
  }));
}

function decryptToken(ciphertext, iv, tag) {
  ensureConfiguration();
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY, 'hex'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

async function getAccount(ownerUserId, instagramUserId) {
  return db.getInstagramAccount(ownerUserId, instagramUserId);
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
  let account;
  if (ownerUserId) {
    account = await db.getInstagramAccount(ownerUserId, instagramUserId);
  }
  if (!account && db.collections) {
    const { instagramAccounts } = db.collections();
    const ids = [String(instagramUserId)];
    if (!isNaN(Number(instagramUserId))) ids.push(Number(instagramUserId));

    account = await instagramAccounts.findOne(
      { instagram_user_id: { $in: ids } },
      { sort: { expires_at: -1 } }
    );

    // Fallback: If not found by ID alone, find any active account for this owner
    if (!account && ownerUserId) {
      account = await instagramAccounts.findOne(
        { owner_user_id: String(ownerUserId) },
        { sort: { expires_at: -1 } }
      );
    }
  }
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
  return {
    accessToken: decryptToken(account.ciphertext, account.iv, account.tag),
    ownerUserId: account.owner_user_id,
    username: account.username
  };
}

// 1. Send Private DM Reply to Commenter
async function sendPrivateReply(instagramUserId, commentId, messageText, accessToken) {
  const bodyData = { recipient: { comment_id: commentId }, message: { text: messageText } };
  
  // Attempt 1: graph.instagram.com with user ID
  const url1 = `https://graph.instagram.com/${apiVersion}/${instagramUserId}/messages`;
  let response = await fetch(url1, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(bodyData)
  });
  let data = await response.json().catch(() => ({}));
  if (response.ok && (data.message_id || data.id)) {
    console.log(`Private DM sent successfully via graph.instagram.com to comment ${commentId}`);
    return data;
  }

  // Attempt 2: graph.facebook.com fallback
  console.warn(`Attempt 1 failed (HTTP ${response.status}): ${metaErrorMessage(data, 'Trying Facebook Graph fallback...')}`);
  const url2 = `https://graph.facebook.com/${apiVersion}/${instagramUserId}/messages`;
  const response2 = await fetch(url2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(bodyData)
  });
  const data2 = await response2.json().catch(() => ({}));
  if (response2.ok && (data2.message_id || data2.id)) {
    console.log(`Private DM sent successfully via graph.facebook.com to comment ${commentId}`);
    return data2;
  }

  // Attempt 3: graph.instagram.com/me/messages fallback
  console.warn(`Attempt 2 failed (HTTP ${response2.status}): ${metaErrorMessage(data2, 'Trying /me/messages fallback...')}`);
  const url3 = `https://graph.instagram.com/${apiVersion}/me/messages`;
  const response3 = await fetch(url3, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(bodyData)
  });
  const data3 = await response3.json().catch(() => ({}));
  if (response3.ok && (data3.message_id || data3.id)) {
    console.log(`Private DM sent successfully via /me/messages to comment ${commentId}`);
    return data3;
  }

  const finalError = data3.error || data2.error || data.error;
  const error = new Error(`Instagram DM Error: ${metaErrorMessage({ error: finalError }, 'All DM endpoints failed.')}`);
  error.statusCode = response3.status || response2.status || response.status || 502;
  error.metaError = finalError;
  throw error;
}

// 2. Send Public Reply in the Comment Thread ("Sent to your DM! Check inbox 📩")
async function replyToComment(commentId, messageText, accessToken) {
  if (!commentId || !messageText || !accessToken) return null;
  const url = `https://graph.instagram.com/${apiVersion}/${commentId}/replies`;
  const bodyData = { message: messageText };

  let response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(bodyData)
  });
  let data = await response.json().catch(() => ({}));

  if (!response.ok && (response.status === 404 || data.error?.code === 100 || data.error?.type === 'OAuthException')) {
    const fallbackUrl = `https://graph.facebook.com/${apiVersion}/${commentId}/replies`;
    const fallbackResponse = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(bodyData)
    });
    const fallbackData = await fallbackResponse.json().catch(() => ({}));
    if (fallbackResponse.ok && fallbackData.id) return fallbackData;
    if (!fallbackResponse.ok) { data = fallbackData; response = fallbackResponse; }
  }

  if (!response.ok || data.error) {
    console.warn(`Public comment reply note: ${metaErrorMessage(data, 'Failed to post public comment reply.')}`);
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
  sendPrivateReply,
  replyToComment
};
