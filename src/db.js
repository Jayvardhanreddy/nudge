const fs = require('fs/promises');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');

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
    counters: database.collection('counters')
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

  const { users, instagramAccounts, automations, webhookEvents, automationEvents, counters } = collections();

  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' }),
    instagramAccounts.createIndex({ owner_user_id: 1, instagram_user_id: 1 }, { unique: true, name: 'instagram_owner_account_unique' }),
    instagramAccounts.createIndex({ instagram_user_id: 1, expires_at: -1 }, { name: 'instagram_user_lookup' }),
    automations.createIndex({ owner_user_id: 1, created_at: -1 }, { name: 'automations_owner_created' }),
    automations.createIndex({ instagram_user_id: 1, enabled: 1 }, { name: 'automations_instagram_enabled' }),
    webhookEvents.createIndex({ event_id: 1 }, { unique: true, name: 'webhook_event_unique' }),
    automationEvents.createIndex({ owner_user_id: 1, created_at: -1 }, { name: 'automation_events_owner_created' }),
    automationEvents.createIndex({ instagram_user_id: 1, created_at: -1 }, { name: 'automation_events_instagram_created' }),
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
  return result.value.value;
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
    const [name, id] = params;
    const result = await users.updateOne({ id }, { $set: { name } });
    return { lastID: id, changes: result.modifiedCount };
  }

  if (normalized.startsWith('insert into instagram_accounts')) {
    const [ownerUserId, instagramUserId, username, ciphertext, iv, tag, expiresAt, connectedAt] = params;
    const result = await instagramAccounts.updateOne(
      { owner_user_id: ownerUserId, instagram_user_id: instagramUserId },
      { $set: { owner_user_id: ownerUserId, instagram_user_id: instagramUserId, username, ciphertext, iv, tag, expires_at: expiresAt, connected_at: connectedAt } },
      { upsert: true }
    );
    return { lastID: instagramUserId, changes: result.modifiedCount || result.upsertedCount };
  }

  if (normalized.startsWith('delete from instagram_accounts')) {
    const [ownerUserId, instagramUserId] = params;
    const result = await instagramAccounts.deleteOne({ owner_user_id: ownerUserId, instagram_user_id: instagramUserId });
    return { changes: result.deletedCount };
  }

  if (normalized.startsWith('insert into automations')) {
    const [ownerUserId, instagramUserId, keyword, dmMessage, enabled, createdAt, updatedAt] = params;
    const id = await nextSequence('automation_id');
    await automations.insertOne({
      id,
      owner_user_id: ownerUserId,
      instagram_user_id: instagramUserId,
      keyword,
      dm_message: dmMessage,
      enabled: Number(enabled),
      created_at: createdAt,
      updated_at: updatedAt
    });
    return { lastID: id, changes: 1 };
  }

  if (normalized.startsWith('update automations set')) {
    const [instagramUserId, keyword, dmMessage, enabled, updatedAt, id, ownerUserId] = params;
    const result = await automations.updateOne(
      { id, owner_user_id: ownerUserId },
      { $set: { instagram_user_id: instagramUserId, keyword, dm_message: dmMessage, enabled: Number(enabled), updated_at: updatedAt } }
    );
    return { changes: result.modifiedCount };
  }

  if (normalized.startsWith('delete from automations')) {
    const [id, ownerUserId] = params;
    const result = await automations.deleteOne({ id, owner_user_id: ownerUserId });
    return { changes: result.deletedCount };
  }

  if (normalized.startsWith('insert or ignore into webhook_events')) {
    const [eventId, processedAt] = params;
    const result = await webhookEvents.updateOne(
      { event_id: eventId },
      { $setOnInsert: { event_id: eventId, processed_at: processedAt } },
      { upsert: true }
    );
    return { changes: result.upsertedCount };
  }

  if (normalized.startsWith('insert into automation_events')) {
    const ownerUserId = params[0];
    const instagramUserId = params[1];
    const automationId = params[2];
    const commentId = params[3];
    const eventType = params[4];
    const keyword = params[5];
    const messageText = params[6];
    const status = params[7];
    const hasError = params.length === 10;
    const errorMessage = hasError ? params[8] : null;
    const createdAt = hasError ? params[9] : params[8];

    const result = await automationEvents.insertOne({
      owner_user_id: ownerUserId,
      instagram_user_id: instagramUserId,
      automation_id: automationId,
      comment_id: commentId,
      event_type: eventType,
      keyword,
      message_text: messageText,
      status,
      ...(hasError ? { error_message: errorMessage } : {}),
      created_at: createdAt
    });
    return { lastID: result.insertedId, changes: 1 };
  }

  throw new Error(`Unsupported database write operation: ${sql}`);
}

async function get(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const { users, instagramAccounts, automations, webhookEvents, automationEvents } = collections();

  if (normalized.startsWith('select count(*) as count from users')) {
    return { count: await users.countDocuments() };
  }

  if (normalized === 'select id from users where email = ?') {
    return users.findOne({ email: String(params[0]).toLowerCase() }, { projection: { id: 1, _id: 0 } });
  }

  if (normalized === 'select * from users where email = ?') {
    return users.findOne({ email: String(params[0]).toLowerCase(), _id: { $exists: true } });
  }

  if (normalized === 'select * from users where id = ?') {
    return users.findOne({ id: params[0] });
  }

  if (normalized === 'select count(*) as count from instagram_accounts where owner_user_id = ?') {
    return { count: await instagramAccounts.countDocuments({ owner_user_id: params[0] }) };
  }

  if (normalized === 'select count(*) as count from automations where owner_user_id = ? and enabled = 1') {
    return { count: await automations.countDocuments({ owner_user_id: params[0], enabled: 1 }) };
  }

  if (normalized === 'select owner_user_id, username from instagram_accounts where owner_user_id = ? and instagram_user_id = ?') {
    return instagramAccounts.findOne(
      { owner_user_id: params[0], instagram_user_id: params[1] },
      { projection: { owner_user_id: 1, username: 1, _id: 0 } }
    );
  }

  if (normalized === 'select * from automations where id = ? and owner_user_id = ?') {
    return automations.findOne({ id: Number(params[0]), owner_user_id: params[1] });
  }

  if (normalized === 'select event_id from webhook_events where event_id = ?') {
    return webhookEvents.findOne({ event_id: params[0] }, { projection: { event_id: 1, _id: 0 } });
  }

  if (normalized === 'select * from instagram_accounts where owner_user_id = ? and instagram_user_id = ?') {
    return instagramAccounts.findOne({ owner_user_id: params[0], instagram_user_id: params[1] });
  }

  if (normalized.startsWith('select * from instagram_accounts where instagram_user_id = ? order by expires_at desc limit 1')) {
    return instagramAccounts.findOne({ instagram_user_id: params[0] }, { sort: { expires_at: -1 } });
  }

  if (normalized.includes('sum(case when event_type')) {
    const ownerUserId = params[0];
    const result = await automationEvents.aggregate([
      { $match: { owner_user_id: ownerUserId } },
      { $group: {
        _id: null,
        comments: { $sum: { $cond: [{ $eq: ['$event_type', 'comment_received'] }, 1, 0] } },
        messagesSent: { $sum: { $cond: [{ $and: [{ $eq: ['$event_type', 'private_reply'] }, { $eq: ['$status', 'success'] }] }, 1, 0] } },
        messagesFailed: { $sum: { $cond: [{ $and: [{ $eq: ['$event_type', 'private_reply'] }, { $eq: ['$status', 'failed'] }] }, 1, 0] } },
        successfulEvents: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } }
      } }
    ]).toArray();
    return result[0] || { comments: 0, messagesSent: 0, messagesFailed: 0, successfulEvents: 0 };
  }

  throw new Error(`Unsupported database read operation: ${sql}`);
}

async function all(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const { users, instagramAccounts, automations, automationEvents } = collections();

  if (normalized.startsWith('select id, name, email, created_at as createdat from users')) {
    return users.aggregate([
      { $sort: { created_at: -1 } },
      { $project: { _id: 0, id: 1, name: 1, email: 1, createdAt: '$created_at' } }
    ]).toArray();
  }

  if (normalized.includes('from instagram_accounts') && normalized.includes('select owner_user_id as owneruserid')) {
    return instagramAccounts.aggregate([{ $project: { _id: 0, ownerUserId: '$owner_user_id', instagramUserId: '$instagram_user_id', username: 1, expiresAt: '$expires_at', connectedAt: '$connected_at' } }]).toArray();
  }

  if (normalized.includes('from automations') && normalized.includes('left join instagram_accounts')) {
    const ownerUserId = params[0];
    return automations.aggregate([
      { $match: { owner_user_id: ownerUserId } },
      { $sort: { created_at: -1 } },
      { $lookup: { from: 'instagram_accounts', let: { owner: '$owner_user_id', ig: '$instagram_user_id' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$owner_user_id', '$$owner'] }, { $eq: ['$instagram_user_id', '$$ig'] }] } } }, { $project: { _id: 0, username: 1 } }], as: 'account' } },
      { $set: { username: { $ifNull: [{ $arrayElemAt: ['$account.username', 0] }, null] } } },
      { $project: { _id: 0, id: 1, ownerUserId: '$owner_user_id', instagramUserId: '$instagram_user_id', keyword: 1, dmMessage: '$dm_message', enabled: 1, createdAt: '$created_at', updatedAt: '$updated_at', username: 1 } }
    ]).toArray();
  }

  if (normalized.startsWith('select * from automations where instagram_user_id = ? and enabled = 1')) {
    return automations.find({ instagram_user_id: params[0], enabled: 1 }).toArray();
  }

  if (normalized.includes('from automation_events') && normalized.includes('order by created_at desc limit 20')) {
    const ownerUserId = params[0];
    return automationEvents.aggregate([
      { $match: { owner_user_id: ownerUserId } },
      { $sort: { created_at: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, eventType: '$event_type', status: 1, keyword: 1, messageText: '$message_text', errorMessage: '$error_message', createdAt: '$created_at' } }
    ]).toArray();
  }

  if (normalized.includes('substr(created_at,1,10)')) {
    const ownerUserId = params[0];
    const cutoff = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    return automationEvents.aggregate([
      { $match: { owner_user_id: ownerUserId, created_at: { $gte: cutoff } } },
      { $group: {
        _id: { $substrBytes: ['$created_at', 0, 10] },
        comments: { $sum: { $cond: [{ $eq: ['$event_type', 'comment_received'] }, 1, 0] } },
        messagesSent: { $sum: { $cond: [{ $and: [{ $eq: ['$event_type', 'private_reply'] }, { $eq: ['$status', 'success'] }] }, 1, 0] } },
        messagesFailed: { $sum: { $cond: [{ $and: [{ $eq: ['$event_type', 'private_reply'] }, { $eq: ['$status', 'failed'] }] }, 1, 0] } }
      } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', comments: 1, messagesSent: 1, messagesFailed: 1 } }
    ]).toArray();
  }

  throw new Error(`Unsupported database list operation: ${sql}`);
}

async function close() {
  if (client) await client.close();
}

module.exports = { initialize, run, get, all, close };
