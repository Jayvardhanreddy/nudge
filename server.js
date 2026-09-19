const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./src/db');
const authService = require('./src/auth/authService');
const instagramService = require('./src/instagram/instagramService');

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
}

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

function validateCredentials(body, includeName) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (includeName && (name.length < 2 || name.length > 100)) return 'Enter a valid name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (password.length < 8 || password.length > 128) return 'Password must be between 8 and 128 characters.';
  return null;
}

function setAuthCookie(response, user) {
  response.cookie('nudge_token', authService.createToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

async function requireAuth(request, response, next) {
  const token = request.cookies.nudge_token;
  if (!token) return response.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await authService.getUserById(payload.sub);
    if (!user) return response.status(401).json({ error: 'Authentication required.' });
    request.user = user;
    return next();
  } catch (error) {
    return response.status(401).json({ error: 'Authentication required.' });
  }
}

function requireAdmin(request, response, next) {
  if (!process.env.ADMIN_EMAIL) {
    return response.status(503).json({ error: 'Admin access is not configured.' });
  }
  if (request.user.email.toLowerCase() !== process.env.ADMIN_EMAIL.trim().toLowerCase()) {
    return response.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

app.post('/api/auth/signup', async (request, response, next) => {
  try {
    const validationError = validateCredentials(request.body, true);
    if (validationError) return response.status(400).json({ error: validationError });
    const user = await authService.register({
      name: request.body.name.trim(),
      email: request.body.email.trim().toLowerCase(),
      password: request.body.password
    });
    setAuthCookie(response, user);
    return response.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const validationError = validateCredentials(request.body, false);
    if (validationError) return response.status(400).json({ error: validationError });
    const user = await authService.authenticate(
      request.body.email.trim().toLowerCase(),
      request.body.password
    );
    setAuthCookie(response, user);
    return response.json({ user });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/logout', (request, response) => {
  response.clearCookie('nudge_token', { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' });
  response.status(204).end();
});

app.get('/api/me', requireAuth, (request, response) => response.json({ user: request.user }));

app.get('/api/instagram/authorize', requireAuth, (request, response, next) => {
  try {
    instagramService.ensureConfiguration();
    const state = jwt.sign(
      { sub: request.user.id, nonce: crypto.randomBytes(16).toString('hex') },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    const authorizeUrl = new URL('https://www.instagram.com/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', process.env.META_APP_ID);
    authorizeUrl.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages');
    authorizeUrl.searchParams.set('state', state);
    return response.redirect(authorizeUrl.toString());
  } catch (error) {
    if (error.statusCode === 503) {
      return response.redirect(`/instagram-accounts.html?instagram_error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

app.get('/api/instagram/callback', async (request, response) => {
  const errorRedirect = (message) => response.redirect(
    `/instagram-accounts.html?instagram_error=${encodeURIComponent(message)}`
  );
  if (request.query.error) {
    return errorRedirect(request.query.error_description || 'Instagram authorization was cancelled.');
  }
  if (typeof request.query.code !== 'string' || typeof request.query.state !== 'string') {
    return errorRedirect('Instagram authorization did not return a valid code.');
  }
  try {
    const state = jwt.verify(request.query.state, process.env.JWT_SECRET);
    if (!state.sub) return errorRedirect('Instagram authorization state was invalid.');
    const token = await instagramService.exchangeCode(request.query.code);
    const profile = await instagramService.fetchProfile(token.accessToken);
    await instagramService.saveAccount(state.sub, profile, token);
    return response.redirect('/instagram-accounts.html?instagram_connected=1');
  } catch (error) {
    console.error('Instagram OAuth callback failed:', error.message);
    return errorRedirect(error.statusCode === 503
      ? 'Instagram connection is not configured yet.'
      : 'Instagram authorization could not be completed.');
  }
});

app.get('/api/instagram/accounts', requireAuth, async (request, response, next) => {
  try {
    return response.json({ accounts: await instagramService.listAccounts(request.user.id) });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/instagram/accounts/:instagramUserId', requireAuth, async (request, response, next) => {
  try {
    await instagramService.disconnect(request.user.id, request.params.instagramUserId);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get('/api/analytics/overview', requireAuth, async (request, response, next) => {
  try {
    const ownerId = request.user.id;
    const [accounts, activeAutomations, totals, recent, daily] = await Promise.all([
      db.get('SELECT COUNT(*) AS count FROM instagram_accounts WHERE owner_user_id = ?', [ownerId]),
      db.get('SELECT COUNT(*) AS count FROM automations WHERE owner_user_id = ? AND enabled = 1', [ownerId]),
      db.get(`SELECT
        SUM(CASE WHEN event_type = 'comment_received' THEN 1 ELSE 0 END) AS comments,
        SUM(CASE WHEN event_type = 'private_reply' AND status = 'success' THEN 1 ELSE 0 END) AS messagesSent,
        SUM(CASE WHEN event_type = 'private_reply' AND status = 'failed' THEN 1 ELSE 0 END) AS messagesFailed,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successfulEvents
        FROM automation_events WHERE owner_user_id = ?`, [ownerId]),
      db.all(`SELECT event_type AS eventType, status, keyword, message_text AS messageText, error_message AS errorMessage, created_at AS createdAt
        FROM automation_events WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 20`, [ownerId]),
      db.all(`SELECT substr(created_at,1,10) AS date,
        SUM(CASE WHEN event_type = 'comment_received' THEN 1 ELSE 0 END) AS comments,
        SUM(CASE WHEN event_type = 'private_reply' AND status = 'success' THEN 1 ELSE 0 END) AS messagesSent,
        SUM(CASE WHEN event_type = 'private_reply' AND status = 'failed' THEN 1 ELSE 0 END) AS messagesFailed
        FROM automation_events WHERE owner_user_id = ? AND created_at >= datetime('now','-29 days')
        GROUP BY substr(created_at,1,10) ORDER BY date ASC`, [ownerId])
    ]);
    return response.json({
      accounts: accounts.count,
      activeAutomations: activeAutomations.count,
      comments: Number(totals?.comments || 0),
      messagesSent: Number(totals?.messagesSent || 0),
      messagesFailed: Number(totals?.messagesFailed || 0),
      successfulEvents: Number(totals?.successfulEvents || 0),
      recent,
      daily
    });
  } catch (error) { return next(error); }
});

app.get('/api/settings', requireAuth, async (request, response, next) => {
  try {
    const user = await authService.getUserById(request.user.id);
    return response.json({ user, preferences: { notifications: true, emailReports: false } });
  } catch (error) { return next(error); }
});

app.patch('/api/settings', requireAuth, async (request, response, next) => {
  try {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : request.user.name;
    if (name.length < 2 || name.length > 100) return response.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    await db.run('UPDATE users SET name = ? WHERE id = ?', [name, request.user.id]);
    return response.json({ user: await authService.getUserById(request.user.id) });
  } catch (error) { return next(error); }
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const users = await authService.listUsers();
    const instagramAccounts = await instagramService.listAllAccounts();
    return response.json({ users, instagramAccounts });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/automations', requireAuth, async (request, response, next) => {
  try {
    const automations = await db.all(
      `SELECT a.id, a.owner_user_id AS ownerUserId, a.instagram_user_id AS instagramUserId,
              a.keyword, a.dm_message AS dmMessage, a.enabled, a.created_at AS createdAt,
              a.updated_at AS updatedAt, i.username
       FROM automations a
       LEFT JOIN instagram_accounts i ON a.owner_user_id = i.owner_user_id AND a.instagram_user_id = i.instagram_user_id
       WHERE a.owner_user_id = ?
       ORDER BY a.created_at DESC`,
      [request.user.id]
    );
    return response.json({ automations });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/automations', requireAuth, async (request, response, next) => {
  try {
    const { instagramUserId, keyword, dmMessage, enabled } = request.body || {};
    const trimmedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    const trimmedMessage = typeof dmMessage === 'string' ? dmMessage.trim() : '';
    const targetIgId = typeof instagramUserId === 'string' ? instagramUserId.trim() : '';

    if (!targetIgId) {
      return response.status(400).json({ error: 'Please select a connected Instagram account.' });
    }
    if (!trimmedKeyword) {
      return response.status(400).json({ error: 'Keyword must not be empty.' });
    }
    if (!trimmedMessage) {
      return response.status(400).json({ error: 'DM message must not be empty.' });
    }

    const account = await db.get(
      'SELECT owner_user_id, username FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?',
      [request.user.id, targetIgId]
    );
    if (!account) {
      return response.status(403).json({ error: 'Instagram account not found or not owned by you.' });
    }

    const now = new Date().toISOString();
    const isEnabled = enabled === false || enabled === 0 ? 0 : 1;

    const result = await db.run(
      `INSERT INTO automations (owner_user_id, instagram_user_id, keyword, dm_message, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [request.user.id, targetIgId, trimmedKeyword, trimmedMessage, isEnabled, now, now]
    );

    const created = await db.get(
      `SELECT a.id, a.owner_user_id AS ownerUserId, a.instagram_user_id AS instagramUserId,
              a.keyword, a.dm_message AS dmMessage, a.enabled, a.created_at AS createdAt,
              a.updated_at AS updatedAt, i.username
       FROM automations a
       LEFT JOIN instagram_accounts i ON a.owner_user_id = i.owner_user_id AND a.instagram_user_id = i.instagram_user_id
       WHERE a.id = ?`,
      [result.lastID]
    );

    return response.status(201).json({ automation: created });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/automations/:id', requireAuth, async (request, response, next) => {
  try {
    const automationId = Number(request.params.id);
    if (!Number.isInteger(automationId) || automationId <= 0) {
      return response.status(400).json({ error: 'Invalid automation ID.' });
    }

    const existing = await db.get(
      'SELECT * FROM automations WHERE id = ? AND owner_user_id = ?',
      [automationId, request.user.id]
    );
    if (!existing) {
      return response.status(404).json({ error: 'Automation not found.' });
    }

    const { instagramUserId, keyword, dmMessage, enabled } = request.body || {};

    let targetIgId = existing.instagram_user_id;
    if (typeof instagramUserId === 'string' && instagramUserId.trim() !== '') {
      targetIgId = instagramUserId.trim();
      const account = await db.get(
        'SELECT owner_user_id FROM instagram_accounts WHERE owner_user_id = ? AND instagram_user_id = ?',
        [request.user.id, targetIgId]
      );
      if (!account) {
        return response.status(403).json({ error: 'Instagram account not found or not owned by you.' });
      }
    }

    let newKeyword = existing.keyword;
    if (keyword !== undefined) {
      if (typeof keyword !== 'string' || !keyword.trim()) {
        return response.status(400).json({ error: 'Keyword must not be empty.' });
      }
      newKeyword = keyword.trim();
    }

    let newMessage = existing.dm_message;
    if (dmMessage !== undefined) {
      if (typeof dmMessage !== 'string' || !dmMessage.trim()) {
        return response.status(400).json({ error: 'DM message must not be empty.' });
      }
      newMessage = dmMessage.trim();
    }

    let newEnabled = existing.enabled;
    if (enabled !== undefined) {
      newEnabled = enabled === true || enabled === 1 || enabled === '1' ? 1 : 0;
    }

    const now = new Date().toISOString();
    await db.run(
      `UPDATE automations
       SET instagram_user_id = ?, keyword = ?, dm_message = ?, enabled = ?, updated_at = ?
       WHERE id = ? AND owner_user_id = ?`,
      [targetIgId, newKeyword, newMessage, newEnabled, now, automationId, request.user.id]
    );

    const updated = await db.get(
      `SELECT a.id, a.owner_user_id AS ownerUserId, a.instagram_user_id AS instagramUserId,
              a.keyword, a.dm_message AS dmMessage, a.enabled, a.created_at AS createdAt,
              a.updated_at AS updatedAt, i.username
       FROM automations a
       LEFT JOIN instagram_accounts i ON a.owner_user_id = i.owner_user_id AND a.instagram_user_id = i.instagram_user_id
       WHERE a.id = ?`,
      [automationId]
    );

    return response.json({ automation: updated });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/automations/:id', requireAuth, async (request, response, next) => {
  try {
    const automationId = Number(request.params.id);
    if (!Number.isInteger(automationId) || automationId <= 0) {
      return response.status(400).json({ error: 'Invalid automation ID.' });
    }

    const result = await db.run(
      'DELETE FROM automations WHERE id = ? AND owner_user_id = ?',
      [automationId, request.user.id]
    );

    if (!result.changes) {
      return response.status(404).json({ error: 'Automation not found.' });
    }

    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get('/api/instagram/webhook', (request, response) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error('META_WEBHOOK_VERIFY_TOKEN is not configured.');
    return response.status(500).json({ error: 'META_WEBHOOK_VERIFY_TOKEN environment variable is missing.' });
  }

  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Meta Webhook verification succeeded.');
    return response.status(200).send(challenge);
  } else {
    console.warn('Meta Webhook verification failed due to token mismatch or invalid mode.');
    return response.status(403).json({ error: 'Verification failed.' });
  }
});

function keywordMatches(commentText, keyword) {
  if (!commentText || !keyword) return false;
  const cleanComment = commentText.toLowerCase().trim();
  const cleanKeyword = keyword.toLowerCase().trim();
  return cleanComment.includes(cleanKeyword);
}

app.post('/api/instagram/webhook', async (request, response) => {
  response.status(200).json({ status: 'ok' });

  try {
    const payload = request.body;
    if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) {
      return;
    }

    for (const entry of payload.entry) {
      const recipientIgUserId = String(entry.id || '');
      const changes = Array.isArray(entry.changes) ? entry.changes : [];

      for (const change of changes) {
        if (change.field !== 'comments' || !change.value) continue;

        const commentVal = change.value;
        const commentId = String(commentVal.id || '');
        const commentText = String(commentVal.text || '');

        if (!commentId || !commentText || !recipientIgUserId) continue;

        const existingEvent = await db.get('SELECT event_id FROM webhook_events WHERE event_id = ?', [commentId]);
        if (existingEvent) {
          console.log(`Webhook comment event ${commentId} already processed. Skipping duplicate.`);
          continue;
        }

        await db.run('INSERT OR IGNORE INTO webhook_events (event_id, processed_at) VALUES (?, ?)', [
          commentId,
          new Date().toISOString()
        ]);

        const automations = await db.all(
          'SELECT * FROM automations WHERE instagram_user_id = ? AND enabled = 1',
          [recipientIgUserId]
        );

        if (!automations || automations.length === 0) {
          console.log(`No active automations configured for Instagram account ID: ${recipientIgUserId}`);
          continue;
        }

        for (const auto of automations) {
          if (keywordMatches(commentText, auto.keyword)) {
            console.log(`Comment keyword "${auto.keyword}" matched for comment ID ${commentId}. Sending private reply.`);
            try {
              const tokenData = await instagramService.getDecryptedTokenByInstagramUserId(recipientIgUserId);
              await instagramService.sendPrivateReply(
                recipientIgUserId,
                commentId,
                auto.dm_message,
                tokenData.accessToken
              );
              await db.run('INSERT INTO automation_events (owner_user_id, instagram_user_id, automation_id, comment_id, event_type, keyword, message_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [auto.owner_user_id, recipientIgUserId, auto.id, commentId, 'private_reply', auto.keyword, auto.dm_message, 'success', new Date().toISOString()]);
              console.log(`Private reply successfully sent for comment ID ${commentId}.`);
            } catch (apiErr) {
              await db.run('INSERT INTO automation_events (owner_user_id, instagram_user_id, automation_id, comment_id, event_type, keyword, message_text, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [auto.owner_user_id, recipientIgUserId, auto.id, commentId, 'private_reply', auto.keyword, auto.dm_message, 'failed', apiErr.message, new Date().toISOString()]);
              console.error(`Failed to send private reply for comment ID ${commentId}:`, apiErr.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error processing Instagram webhook payload:', err.message);
  }
});

app.use((request, response, next) => {
  if (request.path.startsWith('/api/')) return response.status(404).json({ error: 'Not found.' });
  return response.status(404).sendFile(path.join(__dirname, '404.html'));
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  return next(error);
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  console.error(error);
  response.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Something went wrong. Please try again.'
  });
});

db.initialize().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Nudge is running on port ${port}`);
  });
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exitCode = 1;
});
