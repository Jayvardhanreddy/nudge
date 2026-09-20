const fs = require('fs/promises');
const path = require('path');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const databaseName = process.env.MONGODB_DB_NAME || 'nudge';
const usersFile = path.join(__dirname, '..', 'data', 'users.json');
const instagramFile = path.join(__dirname, '..', 'data', 'instagram-accounts.json');

let client;
let database;

function collections() {
  return {
    users: database.collection('users'),
    instagramAccounts: database.collection('instagram_accounts'),
    automations: database.collection('automations'),
    webhookEvents: database.collection('webhook_events'),
    automationEvents: database.collection('automation_events'),
    counters: database.collection('counters'),
    rateLimits: database.collection('rate_limits'),
    sessions: database.collection('sessions')
  };
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
  const { users, instagramAccounts } = collections();

  if (await users.countDocuments() === 0) {
    const usersFromUsersFile = await readJson(usersFile);
    const legacyRecords = await readJson(instagramFile);
    const records = [...usersFromUsersFile, ...legacyRecords.filter((record) => record.passwordHash)];
    if (records.length) {
      await users.bulkWrite(records.map((user) => ({
        updateOne: {
          filter: { id: user.id },
          update: {
            $setOnInsert: {
              id: user.id,
              name: user.name,
              email: String(user.email || '').toLowerCase(),
              password_hash: user.passwordHash,
              created_at: user.createdAt
            }
          },
          upsert: true
        }
      })));
    }
  }

  if (await instagramAccounts.countDocuments() === 0) {
    const accounts = await readJson(instagramFile);
    const valid = accounts
      .filter((account) => account.ownerUserId && account.instagramUserId && account.ciphertext)
      .map((account) => ({
        updateOne: {
          filter: { owner_user_id: account.ownerUserId, instagram_user_id: account.instagramUserId },
          update: {
            $set: {
              owner_user_id: account.ownerUserId,
              instagram_user_id: account.instagramUserId,
              username: account.username,
              ciphertext: account.ciphertext,
              iv: account.iv,
              tag: account.tag,
              expires_at: account.expiresAt,
              connected_at: account.connectedAt
            }
          },
          upsert: true
        }
      }));
    if (valid.length) await instagramAccounts.bulkWrite(valid);
  }
}

async function initialize() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI must be configured.');
  }

  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true
    },
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 60000,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000
  });

  await client.connect();
  database = client.db(databaseName);
  await database.command({ ping: 1 });

  const { users, instagramAccounts, automations, webhookEvents, automationEvents, counters, rateLimits, sessions } = collections();

  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' }),
    instagramAccounts.createIndex({ owner_user_id: 1, instagram_user_id: 1 }, { unique: true, name: 'instagram_owner_account_unique' }),
    instagramAccounts.createIndex({ instagram_user_id: 1, expires_at: -1 }, { name: 'instagram_user_lookup' }),
    automations.createIndex({ owner_user_id: 1, created_at: -1 }, { name: 'automations_owner_created' }),
    automations.createIndex({ instagram_user_id: 1, enabled: 1 }, { name: 'automations_instagram_enabled' }),
    automations.createIndex({ instagram_user_id: 1, media_id: 1, enabled: 1 }, { name: 'automations_instagram_media_enabled' }),
    webhookEvents.createIndex({ event_id: 1 }, { unique: true, name: 'webhook_event_unique' }),
    automationEvents.createIndex({ owner_user_id: 1, created_at: -1 }, { name: 'automation_events_owner_created' }),
    automationEvents.createIndex({ instagram_user_id: 1, created_at: -1 }, { name: 'automation_events_instagram_created' }),
    rateLimits.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'rate_limits_ttl' }),
    sessions.createIndex({ token_hash: 1 }, { unique: true, name: 'sessions_token_unique' }),
    sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'sessions_expires_ttl' })
  ]);

  await migrateJsonData();
  console.log(`MongoDB connected to database "${databaseName}".`);
}

async function nextSequence(name) {
  const { counters } = collections();
  const result = await counters.findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const document = result && result.value && typeof result.value === 'object' ? result.value : result;
  if (!document || !Number.isSafeInteger(Number(document.value))) {
    throw new Error('Failed to generate an automation ID.');
  }
  return Number(document.value);
}

function automationIdFilter(value) {
  const raw = String(value ?? '').trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isSafeInteger(numeric) && numeric > 0) return { id: numeric };
  }
  if (/^[a-f0-9]{24}$/i.test(raw)) return { _id: new ObjectId(raw) };
  return null;
}

async function run(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const {
    users, instagramAccounts, automations, webhookEvents, automationEvents
  } = collections();

  if (normalized.startsWith('insert into users')) {
    const [id, name, email, passwordHash, createdAt] = params;
    const result = await users.updateOne(
      { id },
      { $setOnInsert: { id, name, email: String(email).toLowerCase(), password_hash: passwordHash, created_at: createdAt } },
      { upsert: true }
    );
    return { lastID: id, changes: result.upsertedCount };
  }

  if (normalized.startsWith('update users set name')) {
    const [name, email, id] = params;
    const result = await users.updateOne({ id }, { $set: { name, email: String(email).toLowerCase() } });
    return { lastID: id, changes: result.modifiedCount };
  }

  if (normalized.startsWith('insert into instagram_accounts')) {
    const [ownerUserId, instagramUserId, username, ciphertext, iv, tag, expiresAt, connectedAt] = params;
    const result = await instagramAccounts.updateOne(
      { owner_user_id: ownerUserId, instagram_user_id: instagramUserId },
      { $set: { owner_user_id: ownerUserId, instagram_user_id: instagramUserId, username, ciphertext, iv, tag, expires_at: expiresAt, connected_at: connectedAt } },
      { upsert: true }
    );
    return { lastID: result.upsertedId ? result.upsertedId.toString() : null, changes: result.upsertedCount || result.modifiedCount };
  }

  if (normalized.startsWith('update instagram_accounts set')) {
    const [username, ciphertext, iv, tag, expiresAt, connectedAt, instagramUserId, ownerUserId] = params;
    const result = await instagramAccounts.updateOne(
      { instagram_user_id: instagramUserId, owner_user_id: ownerUserId },
      { $set: { username, ciphertext, iv, tag, expires_at: expiresAt, connected_at: connectedAt } }
    );
    return { changes: result.modifiedCount };
  }

  if (normalized.startsWith('delete from instagram_accounts')) {
    const [instagramUserId, ownerUserId] = params;
    const result = await instagramAccounts.deleteOne({ instagram_user_id: instagramUserId, owner_user_id: ownerUserId });
    return { changes: result.deletedCount };
  }

  if (normalized.startsWith('select * from instagram_accounts')) {
    const [ownerUserId] = params;
    const rows = await instagramAccounts.find({ owner_user_id: ownerUserId }).sort({ connected_at: -1 }).toArray();
    return { rows };
  }

  if (normalized.startsWith('select * from users where email')) {
    const [email] = params;
    const row = await users.findOne({ email: String(email).toLowerCase() });
    return { rows: row ? [row] : [] };
  }

  if (normalized.startsWith('select * from users where id')) {
    const [id] = params;
    const row = await users.findOne({ id });
    return { rows: row ? [row] : [] };
  }

  if (normalized.startsWith('insert into automations')) {
    const [id, ownerUserId, instagramUserId, mediaId, mediaUrl, mediaTitle, keyword, replyTemplate, dmTemplate, enabled, createdAt, updatedAt] = params;
    const result = await automations.insertOne({
      id,
      owner_user_id: ownerUserId,
      instagram_user_id: instagramUserId,
      media_id: mediaId,
      media_url: mediaUrl,
      media_title: mediaTitle,
      keyword,
      reply_template: replyTemplate,
      dm_template: dmTemplate,
      enabled: Boolean(enabled),
      created_at: createdAt,
      updated_at: updatedAt
    });
    return { lastID: result.insertedId.toString(), changes: result.acknowledged ? 1 : 0 };
  }

  if (normalized.startsWith('select * from automations where owner_user_id')) {
    const [ownerUserId] = params;
    const rows = await automations.find({ owner_user_id: ownerUserId }).sort({ created_at: -1 }).toArray();
    return { rows };
  }

  if (normalized.startsWith('select * from automations where instagram_user_id')) {
    const [instagramUserId] = params;
    const rows = await automations.find({ instagram_user_id: instagramUserId }).sort({ created_at: -1 }).toArray();
    return { rows };
  }

  if (normalized.startsWith('select * from automations where id')) {
    const [id] = params;
    const filter = automationIdFilter(id);
    if (!filter) return { rows: [] };
    const row = await automations.findOne(filter);
    return { rows: row ? [row] : [] };
  }

  if (normalized.startsWith('update automations set')) {
    const [mediaId, mediaUrl, mediaTitle, keyword, replyTemplate, dmTemplate, enabled, updatedAt, id] = params;
    const filter = automationIdFilter(id);
    if (!filter) return { changes: 0 };
    const result = await automations.updateOne(
      filter,
      { $set: { media_id: mediaId, media_url: mediaUrl, media_title: mediaTitle, keyword, reply_template: replyTemplate, dm_template: dmTemplate, enabled: Boolean(enabled), updated_at: updatedAt } }
    );
    return { changes: result.modifiedCount };
  }

  if (normalized.startsWith('delete from automations')) {
    const [id] = params;
    const filter = automationIdFilter(id);
    if (!filter) return { changes: 0 };
    const result = await automations.deleteOne(filter);
    return { changes: result.deletedCount };
  }

  if (normalized.startsWith('insert into webhook_events')) {
    const [eventId, receivedAt, payload] = params;
    const result = await webhookEvents.updateOne(
      { event_id: eventId },
      { $setOnInsert: { event_id: eventId, received_at: receivedAt, payload } },
      { upsert: true }
    );
    return { changes: result.upsertedCount };
  }

  if (normalized.startsWith('select * from webhook_events')) {
    const rows = await webhookEvents.find({}).sort({ received_at: -1 }).toArray();
    return { rows };
  }

  if (normalized.startsWith('insert into automation_events')) {
    const [eventId, ownerUserId, instagramUserId, mediaId, commentId, username, keyword, reply, dm, status, error, createdAt] = params;
    const result = await automationEvents.insertOne({
      event_id: eventId,
      owner_user_id: ownerUserId,
      instagram_user_id: instagramUserId,
      media_id: mediaId,
      comment_id: commentId,
      username,
      keyword,
      reply,
      dm,
      status,
      error,
      created_at: createdAt
    });
    return { lastID: result.insertedId.toString(), changes: result.acknowledged ? 1 : 0 };
  }

  if (normalized.startsWith('select * from automation_events where owner_user_id')) {
    const [ownerUserId] = params;
    const rows = await automationEvents.find({ owner_user_id: ownerUserId }).sort({ created_at: -1 }).toArray();
    return { rows };
  }

  if (normalized.startsWith('select * from automation_events where instagram_user_id')) {
    const [instagramUserId] = params;
    const rows = await automationEvents.find({ instagram_user_id: instagramUserId }).sort({ created_at: -1 }).toArray();
    return { rows };
  }

  throw new Error(`Unsupported database operation: ${sql}`);
}

async function getUserById(id) {
  const { users } = collections();
  return users.findOne({ id });
}

async function getUserByEmail(email) {
  const { users } = collections();
  return users.findOne({ email: String(email).toLowerCase() });
}

async function listUsers() {
  const { users } = collections();
  return users.find({}).sort({ created_at: -1 }).toArray();
}

async function getInstagramAccounts(ownerUserId) {
  const { instagramAccounts } = collections();
  return instagramAccounts.find({ owner_user_id: ownerUserId }).sort({ connected_at: -1 }).toArray();
}

async function getInstagramAccount(ownerUserId, instagramUserId) {
  const { instagramAccounts } = collections();
  return instagramAccounts.findOne({ owner_user_id: ownerUserId, instagram_user_id: instagramUserId });
}

async function consumeRateLimit(key, windowMs, maxRequests) {
  const { rateLimits } = collections();
  const now = Date.now();
  const expiresAt = new Date(now + Number(windowMs || 60000));
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return true;

  const existing = await rateLimits.findOne({ key: normalizedKey });
  if (!existing || new Date(existing.expires_at).getTime() <= now) {
    await rateLimits.updateOne(
      { key: normalizedKey },
      { $set: { key: normalizedKey, count: 1, expires_at: expiresAt.toISOString() } },
      { upsert: true }
    );
    return true;
  }

  if (Number(existing.count || 0) >= Number(maxRequests || 1)) return false;

  await rateLimits.updateOne(
    { key: normalizedKey },
    { $inc: { count: 1 } }
  );
  return true;
}

async function createSession(session) {
  const { sessions } = collections();
  await sessions.insertOne(session);
}

async function getSession(tokenHash) {
  const { sessions } = collections();
  return sessions.findOne({ token_hash: tokenHash });
}

async function refreshSession(tokenHash, expiresAt) {
  const { sessions } = collections();
  await sessions.updateOne(
    { token_hash: tokenHash },
    { $set: { expires_at: expiresAt, last_seen_at: new Date().toISOString() } }
  );
}

async function deleteSession(tokenHash) {
  const { sessions } = collections();
  await sessions.deleteOne({ token_hash: tokenHash });
}

async function close() {
  if (client) await client.close();
}

module.exports = {
  initialize,
  run,
  getUserById,
  getUserByEmail,
  listUsers,
  getInstagramAccounts,
  getInstagramAccount,
  createSession,
  getSession,
  refreshSession,
  deleteSession,
  consumeRateLimit,
  close
};