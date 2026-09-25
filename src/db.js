const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const databaseName = process.env.MONGODB_DB_NAME || 'nudge';
const usersFile = path.join(__dirname, '..', 'data', 'users.json');
const instagramFile = path.join(__dirname, '..', 'data', 'instagram-accounts.json');

let client;
let database;

function collections() {
  if (!database) {
    throw new Error('Database not initialized yet.');
  }
  return {
    users: database.collection('users'),
    instagramAccounts: database.collection('instagram_accounts'),
    automations: database.collection('automations'),
    webhookEvents: database.collection('webhook_events'),
    automationEvents: database.collection('automation_events'),
    counters: database.collection('counters'),
    rateLimits: database.collection('rate_limits'),
    sessions: database.collection('sessions'),
    contacts: database.collection('contacts'),
    payments: database.collection('payments'),
    billing_plans: database.collection('billing_plans'),
    coupons: database.collection('coupons'),
    subscriptions: database.collection('subscriptions')
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
    minPoolSize: 1,
    maxIdleTimeMS: 60000,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 10000
  });

  await client.connect();
  database = client.db(databaseName);
  await database.command({ ping: 1 });

  const { users, instagramAccounts, automations, webhookEvents, automationEvents, rateLimits, sessions } = collections();

  // Create indexes safely. TTL indexes ensure MongoDB free tier space (512MB) is never exhausted.
  await Promise.allSettled([
    users.createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' }),
    users.createIndex({ id: 1 }, { unique: true, name: 'users_id_unique' }),
    instagramAccounts.createIndex({ owner_user_id: 1, instagram_user_id: 1 }, { unique: true, name: 'instagram_owner_account_unique' }),
    instagramAccounts.createIndex({ instagram_user_id: 1, expires_at: -1 }, { name: 'instagram_user_lookup' }),
    automations.createIndex({ id: 1 }, { unique: true, sparse: true, name: 'automations_id_unique' }),
    automations.createIndex({ owner_user_id: 1, created_at: -1 }, { name: 'automations_owner_created' }),
    automations.createIndex({ instagram_user_id: 1, enabled: 1 }, { name: 'automations_instagram_enabled' }),
    automations.createIndex({ instagram_user_id: 1, media_id: 1, enabled: 1 }, { name: 'automations_instagram_media_enabled' }),
    // Auto-delete webhook duplicate tracking records after 7 days (saves MongoDB space):
    webhookEvents.createIndex({ event_id: 1 }, { unique: true, name: 'webhook_event_unique' }),
    webhookEvents.createIndex({ processed_at: 1 }, { expireAfterSeconds: 7 * 86400, name: 'webhook_events_ttl' }),
    // Auto-delete automation event logs after 30 days (saves MongoDB space):
    automationEvents.createIndex({ owner_user_id: 1, created_at: -1 }, { name: 'automation_events_owner_created' }),
    automationEvents.createIndex({ instagram_user_id: 1, created_at: -1 }, { name: 'automation_events_instagram_created' }),
    automationEvents.createIndex({ created_at_date: 1 }, { expireAfterSeconds: 30 * 86400, name: 'automation_events_ttl' }),
    // Rate limits auto-expire:
    rateLimits.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'rate_limits_ttl' }),
    // Sessions auto-expire:
    sessions.createIndex({ token_hash: 1 }, { unique: true, name: 'sessions_token_unique' }),
    sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'sessions_expires_ttl' })
  ]);

  await migrateJsonData().catch((err) => console.warn('JSON migration notice:', err.message));
  console.log(`MongoDB connected successfully to database "${databaseName}". Free-tier TTL cleanup active.`);
}

function automationIdFilter(value) {
  const raw = String(value ?? '').trim();
  if (/^[a-f0-9]{24}$/i.test(raw)) {
    return { $or: [{ _id: new ObjectId(raw) }, { id: raw }] };
  }
  return { id: raw };
}

// SQL Query Emulation Layer (bridges existing server.js calls to MongoDB)
async function run(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const {
    users, instagramAccounts, automations, webhookEvents, automationEvents
  } = collections();

  // Users insert/update
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

  // Instagram Accounts
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

  // Automations insert: Handle standard server.js format
  // INSERT INTO automations (owner_user_id, instagram_user_id, keyword, dm_message, enabled, created_at, updated_at, media_id, media_url, reply_template, trigger_type)
  if (normalized.startsWith('insert into automations')) {
    let ownerUserId, instagramUserId, keyword, dmMessage, enabled, createdAt, updatedAt, mediaId, mediaUrl, replyTemplate, triggerType;
    if (params.length >= 9) {
      [ownerUserId, instagramUserId, keyword, dmMessage, enabled, createdAt, updatedAt, mediaId, mediaUrl, replyTemplate, triggerType] = params;
    } else {
      [ownerUserId, instagramUserId, keyword, dmMessage, enabled, createdAt, updatedAt] = params;
    }

    const autoId = crypto.randomUUID();
    const result = await automations.insertOne({
      id: autoId,
      owner_user_id: ownerUserId,
      instagram_user_id: instagramUserId,
      media_id: mediaId || null,
      media_url: mediaUrl || null,
      keyword: String(keyword || '').trim(),
      dm_message: String(dmMessage || '').trim(),
      reply_template: replyTemplate ? String(replyTemplate).trim() : null,
      trigger_type: triggerType || 'keyword',
      enabled: Boolean(enabled),
      created_at: createdAt || new Date().toISOString(),
      updated_at: updatedAt || new Date().toISOString()
    });

    return { lastID: autoId, insertedId: result.insertedId.toString(), changes: result.acknowledged ? 1 : 0 };
  }

  // Automations update
  if (normalized.startsWith('update automations set')) {
    // Standard format: [targetIgId, newKeyword, newMessage, newEnabled, now, newMediaId, newMediaUrl, newReplyTemplate, newTriggerType, automationId, ownerUserId]
    // Or legacy format
    const autoId = params[params.length - 2] || params[params.length - 1];
    const ownerUserId = params[params.length - 1];

    const filter = automationIdFilter(autoId);
    if (ownerUserId) filter.owner_user_id = ownerUserId;

    const updateDoc = { updated_at: new Date().toISOString() };
    if (params[0] !== undefined) updateDoc.instagram_user_id = params[0];
    if (params[1] !== undefined) updateDoc.keyword = params[1];
    if (params[2] !== undefined) updateDoc.dm_message = params[2];
    if (params[3] !== undefined) updateDoc.enabled = Boolean(params[3]);
    if (params[5] !== undefined) updateDoc.media_id = params[5];
    if (params[6] !== undefined) updateDoc.media_url = params[6];
    if (params[7] !== undefined) updateDoc.reply_template = params[7];
    if (params[8] !== undefined) updateDoc.trigger_type = params[8];

    const result = await automations.updateOne(filter, { $set: updateDoc });
    return { changes: result.modifiedCount };
  }

  // Automations delete
  if (normalized.startsWith('delete from automations')) {
    const [id, ownerUserId] = params;
    const filter = automationIdFilter(id);
    if (ownerUserId) filter.owner_user_id = ownerUserId;
    const result = await automations.deleteOne(filter);
    return { changes: result.deletedCount };
  }

  // Webhook events tracking
  if (normalized.startsWith('insert or ignore into webhook_events') || normalized.startsWith('insert into webhook_events')) {
    const [eventId, processedAt] = params;
    const now = new Date();
    const result = await webhookEvents.updateOne(
      { event_id: eventId },
      { $setOnInsert: { event_id: eventId, processed_at: now } },
      { upsert: true }
    );
    return { changes: result.upsertedCount };
  }

  // Automation events logging
  if (normalized.startsWith('insert into automation_events')) {
    // [owner_user_id, instagram_user_id, automation_id, comment_id, event_type, keyword, message_text, status, (error_message), created_at]
    let ownerUserId, instagramUserId, automationId, commentId, eventType, keyword, messageText, status, errorMessage, createdAt;
    if (params.length === 10) {
      [ownerUserId, instagramUserId, automationId, commentId, eventType, keyword, messageText, status, errorMessage, createdAt] = params;
    } else {
      [ownerUserId, instagramUserId, automationId, commentId, eventType, keyword, messageText, status, createdAt] = params;
    }

    const now = new Date();
    const result = await automationEvents.insertOne({
      event_id: crypto.randomUUID(),
      owner_user_id: ownerUserId,
      instagram_user_id: instagramUserId,
      automation_id: automationId,
      comment_id: commentId,
      event_type: eventType,
      keyword: keyword || '',
      message_text: messageText || '',
      status: status || 'success',
      error_message: errorMessage || null,
      created_at: createdAt || now.toISOString(),
      created_at_date: now
    });
    return { lastID: result.insertedId.toString(), changes: result.acknowledged ? 1 : 0 };
  }

  return { changes: 0, rows: [] };
}

// Emulate SQLite db.all(...) for array results
async function all(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const { instagramAccounts, automations, automationEvents, webhookEvents, users } = collections();

  if (normalized.startsWith('select * from automations where owner_user_id') ||
      normalized.includes('from automations a') && normalized.includes('where a.owner_user_id = ?')) {
    const [ownerUserId] = params;
    const list = await automations.find({ owner_user_id: ownerUserId }).sort({ created_at: -1 }).toArray();
    // Join with instagram accounts for username
    const accounts = await instagramAccounts.find({ owner_user_id: ownerUserId }).toArray();
    const acctMap = new Map(accounts.map((a) => [a.instagram_user_id, a.username]));
    return list.map((a) => ({
      id: a.id || a._id.toString(),
      ownerUserId: a.owner_user_id,
      instagramUserId: a.instagram_user_id,
      keyword: a.keyword || '',
      dmMessage: a.dm_message || '',
      replyTemplate: a.reply_template || null,
      triggerType: a.trigger_type || 'keyword',
      enabled: a.enabled ? 1 : 0,
      mediaId: a.media_id || null,
      mediaUrl: a.media_url || null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      username: acctMap.get(a.instagram_user_id) || ''
    }));
  }

  if (normalized.startsWith('select * from automations where instagram_user_id')) {
    const [instagramUserId] = params;
    const list = await automations.find({ instagram_user_id: instagramUserId, enabled: true }).sort({ created_at: -1 }).toArray();
    return list.map((a) => ({
      id: a.id || a._id.toString(),
      owner_user_id: a.owner_user_id,
      instagram_user_id: a.instagram_user_id,
      keyword: a.keyword || '',
      dm_message: a.dm_message || '',
      reply_template: a.reply_template || null,
      trigger_type: a.trigger_type || 'keyword',
      enabled: a.enabled ? 1 : 0,
      media_id: a.media_id || null,
      media_url: a.media_url || null,
      created_at: a.created_at
    }));
  }

  if (normalized.includes('from automation_events where owner_user_id = ? order by created_at desc limit')) {
    const [ownerUserId] = params;
    const events = await automationEvents.find({ owner_user_id: ownerUserId }).sort({ created_at: -1 }).limit(20).toArray();
    return events.map((e) => ({
      eventType: e.event_type,
      status: e.status,
      keyword: e.keyword,
      messageText: e.message_text,
      errorMessage: e.error_message,
      createdAt: e.created_at
    }));
  }

  if (normalized.includes('group by substr(created_at,1,10)')) {
    const [ownerUserId] = params;
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const events = await automationEvents.find({ owner_user_id: ownerUserId, created_at: { $gte: since } }).toArray();
    const dateMap = {};
    for (const e of events) {
      const d = String(e.created_at || '').slice(0, 10);
      if (!dateMap[d]) dateMap[d] = { date: d, comments: 0, messagesSent: 0, messagesFailed: 0 };
      if (e.event_type === 'comment_received') dateMap[d].comments += 1;
      if (e.event_type === 'private_reply' && e.status === 'success') dateMap[d].messagesSent += 1;
      if (e.event_type === 'private_reply' && e.status === 'failed') dateMap[d].messagesFailed += 1;
    }
    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }

  if (normalized.startsWith('select * from instagram_accounts where owner_user_id')) {
    const [ownerUserId] = params;
    return instagramAccounts.find({ owner_user_id: ownerUserId }).sort({ connected_at: -1 }).toArray();
  }

  if (normalized.startsWith('select id, name, email, created_at as createdat from users')) {
    return users.find({}, { projection: { password_hash: 0 } }).sort({ created_at: -1 }).toArray();
  }

  return [];
}

// Emulate SQLite db.get(...) for single row results
async function get(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const { instagramAccounts, automations, automationEvents, webhookEvents, users } = collections();

  if (normalized.includes('count(*) as count from instagram_accounts where owner_user_id')) {
    const [ownerUserId] = params;
    const count = await instagramAccounts.countDocuments({ owner_user_id: ownerUserId });
    return { count };
  }

  if (normalized.includes('count(*) as count from automations where owner_user_id')) {
    const [ownerUserId] = params;
    const count = await automations.countDocuments({ owner_user_id: ownerUserId, enabled: true });
    return { count };
  }

  if (normalized.includes('sum(case when event_type = \'comment_received\'')) {
    const [ownerUserId] = params;
    const events = await automationEvents.find({ owner_user_id: ownerUserId }).toArray();
    let comments = 0;
    let messagesSent = 0;
    let messagesFailed = 0;
    let successfulEvents = 0;
    for (const e of events) {
      if (e.event_type === 'comment_received') comments += 1;
      if (e.event_type === 'private_reply') {
        if (e.status === 'success') messagesSent += 1;
        else messagesFailed += 1;
      }
      if (e.status === 'success') successfulEvents += 1;
    }
    return { comments, messagesSent, messagesFailed, successfulEvents };
  }

  if (normalized.startsWith('select owner_user_id, username from instagram_accounts where owner_user_id = ? and instagram_user_id = ?') ||
      normalized.startsWith('select * from instagram_accounts where owner_user_id = ? and instagram_user_id = ?')) {
    const [ownerUserId, instagramUserId] = params;
    return instagramAccounts.findOne({ owner_user_id: ownerUserId, instagram_user_id: instagramUserId });
  }

  if (normalized.startsWith('select * from instagram_accounts where instagram_user_id = ?')) {
    const [instagramUserId] = params;
    return instagramAccounts.findOne({ instagram_user_id: instagramUserId }, { sort: { expires_at: -1 } });
  }

  if (normalized.includes('from automations a') && normalized.includes('where a.id = ?')) {
    const [id] = params;
    const filter = automationIdFilter(id);
    const item = await automations.findOne(filter);
    if (!item) return null;
    const acct = await instagramAccounts.findOne({ owner_user_id: item.owner_user_id, instagram_user_id: item.instagram_user_id });
    return {
      id: item.id || item._id.toString(),
      ownerUserId: item.owner_user_id,
      instagramUserId: item.instagram_user_id,
      keyword: item.keyword || '',
      dmMessage: item.dm_message || '',
      replyTemplate: item.reply_template || null,
      triggerType: item.trigger_type || 'keyword',
      enabled: item.enabled ? 1 : 0,
      mediaId: item.media_id || null,
      mediaUrl: item.media_url || null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      username: acct?.username || ''
    };
  }

  if (normalized.startsWith('select * from automations where id = ? and owner_user_id = ?')) {
    const [id, ownerUserId] = params;
    const filter = automationIdFilter(id);
    filter.owner_user_id = ownerUserId;
    return automations.findOne(filter);
  }

  if (normalized.startsWith('select event_id from webhook_events where event_id = ?')) {
    const [eventId] = params;
    return webhookEvents.findOne({ event_id: eventId });
  }

  if (normalized.startsWith('select * from users where email = ?')) {
    const [email] = params;
    return users.findOne({ email: String(email).toLowerCase() });
  }

  if (normalized.startsWith('select id from users where email = ?')) {
    const [email] = params;
    return users.findOne({ email: String(email).toLowerCase() }, { projection: { id: 1 } });
  }

  if (normalized.startsWith('select * from users where id = ?')) {
    const [id] = params;
    return users.findOne({ id });
  }

  return null;
}

// User Helpers
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
  return users.find({}, { projection: { password_hash: 0 } }).sort({ created_at: -1 }).toArray();
}

async function updateUserPassword(userId, passwordHash) {
  const { users } = collections();
  return users.updateOne({ id: userId }, { $set: { password_hash: passwordHash, updated_at: new Date().toISOString() } });
}

async function updateUserProfile(userId, { name, email, phone, avatarUrl }) {
  const { users } = collections();
  const update = { updated_at: new Date().toISOString() };
  if (name) update.name = String(name).trim();
  if (email) update.email = String(email).trim().toLowerCase();
  if (phone !== undefined) update.phone = String(phone).trim();
  if (avatarUrl !== undefined) update.avatar_url = String(avatarUrl).trim();
  return users.updateOne({ id: userId }, { $set: update });
}

async function deleteUserAccount(userId) {
  const { users, instagramAccounts, automations, automationEvents, sessions } = collections();
  await Promise.allSettled([
    users.deleteOne({ id: userId }),
    instagramAccounts.deleteMany({ owner_user_id: userId }),
    automations.deleteMany({ owner_user_id: userId }),
    automationEvents.deleteMany({ owner_user_id: userId }),
    sessions.deleteMany({ user_id: userId })
  ]);
  return true;
}

// Instagram Helpers
async function getInstagramAccounts(ownerUserId) {
  const { instagramAccounts } = collections();
  return instagramAccounts.find({ owner_user_id: ownerUserId }).sort({ connected_at: -1 }).toArray();
}

async function getInstagramAccount(ownerUserId, instagramUserId) {
  const { instagramAccounts } = collections();
  return instagramAccounts.findOne({ owner_user_id: ownerUserId, instagram_user_id: instagramUserId });
}

// Rate Limiter
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
      { $set: { key: normalizedKey, count: 1, expires_at: expiresAt } },
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

// Sessions
async function createSession(session) {
  const { sessions } = collections();
  const doc = {
    ...session,
    expires_at: session.expires_at instanceof Date ? session.expires_at : new Date(session.expires_at)
  };
  await sessions.insertOne(doc);
}

async function getSession(tokenHash) {
  const { sessions } = collections();
  return sessions.findOne({ token_hash: tokenHash });
}

async function refreshSession(tokenHash, expiresAt) {
  const { sessions } = collections();
  const dateObj = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  await sessions.updateOne(
    { token_hash: tokenHash },
    { $set: { expires_at: dateObj, last_seen_at: new Date().toISOString() } }
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
  get,
  all,
  getUserById,
  getUserByEmail,
  listUsers,
  updateUserPassword,
  updateUserProfile,
  deleteUserAccount,
  getInstagramAccounts,
  getInstagramAccount,
  createSession,
  getSession,
  refreshSession,
  deleteSession,
  consumeRateLimit,
  close,
  collections
};