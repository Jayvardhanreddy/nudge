const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.created_at || user.createdAt };
}

async function register({ name, email, password }) {
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    const error = new Error('An account with that email already exists.');
    error.statusCode = 409;
    throw error;
  }
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
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
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }
  return publicUser(user);
}

function createToken(user) {
  return require('jsonwebtoken').sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

async function getUserById(id) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  return user ? publicUser(user) : null;
}

async function listUsers() {
  return db.all('SELECT id, name, email, created_at AS createdAt FROM users ORDER BY created_at DESC');
}

async function registerOAuthUser({ name, email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw Object.assign(new Error('Google did not return an email address.'), { statusCode: 400 });
  const existing = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
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

module.exports = { register, authenticate, registerOAuthUser, createToken, getUserById, listUsers };
