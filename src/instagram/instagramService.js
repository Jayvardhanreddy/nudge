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
    const error = new Error(data.error_message || data.error?.message || 'Instagram authorization code exchange failed.');
    error.statusCode = 502;
    throw error;
  }
  const longLivedUrl = new URL('https://graph.instagram.com/access_token');
  longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longLivedUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
  longLivedUrl.searchParams.set('access_token', data.access_token);
  const longLivedResponse = await fetch(longLivedUrl);
  const longLivedData = await longLivedResponse.json().catch(() => ({}));
  if (!longLivedResponse.ok || !longLivedData.access_token) {
    const error = new Error(longLivedData.error?.message || 'Instagram long-lived token exchange failed.');
    error.statusCode = 502;
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
    const error = new Error(data.error?.message || 'Unable to read the Instagram account profile.');
    error.statusCode = 502;
    throw error;
  }
  return { userId: String(data.user_id), username: data.username || 'Instagram account' };
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
}

async function listAccounts(userId) {
  const accounts = await db.all('SELECT * FROM instagram_accounts WHERE owner_user_id = ?', [userId]);
  return accounts.map(publicAccount);
}

async function disconnect(userId, instagramUserId) {
  const result = await db.run(
    'DELETE FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?',
    [userId, instagramUserId]
  );
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

module.exports = { ensureConfiguration, exchangeCode, fetchProfile, saveAccount, listAccounts, disconnect, listAllAccounts };
