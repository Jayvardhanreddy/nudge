const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at || user.createdAt
  };
}

async function register({ name, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = await db.getUserByEmail(normalizedEmail);
  if (existing) {
    const error = new Error('An account with that email already exists.');
    error.statusCode = 409;
    throw error;
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: new Date().toISOString()
  };

  await db.run(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.name, user.email, user.passwordHash, user.createdAt]
  );
  return publicUser(user);
}

async function authenticate(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await db.getUserByEmail(normalizedEmail);

  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  return publicUser(user);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createSession(userId, expiresAt) {
  const token = createSessionToken();
  await db.createSession({
    user_id: userId,
    token_hash: hashSessionToken(token),
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  });
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await db.getSession(hashSessionToken(token));
  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    await db.deleteSession(hashSessionToken(token));
    return null;
  }
  return getUserById(session.user_id);
}

async function refreshSession(token, expiresAt) {
  if (token) await db.refreshSession(hashSessionToken(token), expiresAt);
}

async function deleteSession(token) {
  if (token) await db.deleteSession(hashSessionToken(token));
}

function createToken(user) {
  return require('jsonwebtoken').sign(
    { sub: user.id },
    process.env.JWT_SECRET,
    { expiresIn: '30d', issuer: 'nudge-app', audience: 'nudge-web' }
  );
}

async function getUserByEmail(email) {
  return publicUser(await db.getUserByEmail(String(email).trim().toLowerCase()));
}

async function getUserById(id) {
  return publicUser(await db.getUserById(id));
}

async function listUsers() {
  const users = await db.listUsers();
  return users.map(publicUser);
}

async function registerOAuthUser({ name, email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw Object.assign(new Error('OAuth provider did not return an email address.'), { statusCode: 400 });
  }

  const existing = await db.getUserByEmail(normalizedEmail);
  if (existing) return publicUser(existing);

  const user = {
    id: crypto.randomUUID(),
    name: String(name || 'Nudge Creator').trim().slice(0, 100),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
    createdAt: new Date().toISOString()
  };

  await db.run(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.name, user.email, user.passwordHash, user.createdAt]
  );

  return publicUser(user);
}

module.exports = {
  register,
  authenticate,
  registerOAuthUser,
  createToken,
  createSession,
  getSessionUser,
  refreshSession,
  deleteSession,
  getUserById,
  getUserByEmail,
  listUsers
};
