const fs = require('fs/promises');
const path = require('path');
const sqlite3 = require('sqlite3');

const databaseFile = path.join(__dirname, '..', 'data', 'nudge.sqlite');
const usersFile = path.join(__dirname, '..', 'data', 'users.json');
const instagramFile = path.join(__dirname, '..', 'data', 'instagram-accounts.json');

let database;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function migrateJsonData() {
  const userCount = await get('SELECT COUNT(*) AS count FROM users');
  if (userCount.count === 0) {
    const usersFromUsersFile = await readJson(usersFile);
    const legacyRecords = await readJson(instagramFile);
    const users = [...usersFromUsersFile, ...legacyRecords.filter((record) => record.passwordHash)];
    for (const user of users) {
      await run(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [user.id, user.name, user.email, user.passwordHash, user.createdAt]
      );
    }
  }

  const accountCount = await get('SELECT COUNT(*) AS count FROM instagram_accounts');
  if (accountCount.count === 0) {
    const accounts = await readJson(instagramFile);
    for (const account of accounts) {
      if (!account.ownerUserId || !account.instagramUserId || !account.ciphertext) continue;
      await run(
        `INSERT OR IGNORE INTO instagram_accounts
        (owner_user_id, instagram_user_id, username, ciphertext, iv, tag, expires_at, connected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.ownerUserId,
          account.instagramUserId,
          account.username,
          account.ciphertext,
          account.iv,
          account.tag,
          account.expiresAt,
          account.connectedAt
        ]
      );
    }
  }
}

async function initialize() {
  await fs.mkdir(path.dirname(databaseFile), { recursive: true });
  database = await new Promise((resolve, reject) => {
    let connection;
    connection = new sqlite3.Database(databaseFile, (error) => error ? reject(error) : resolve(connection));
  });
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS instagram_accounts (
    owner_user_id TEXT NOT NULL,
    instagram_user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    connected_at TEXT NOT NULL,
    PRIMARY KEY (owner_user_id, instagram_user_id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await migrateJsonData();
}

module.exports = { initialize, run, get, all };
