const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./src/db');
const authService = require('./src/auth/authService');
const instagramService = require('./src/instagram/instagramService');
const billing = require('./src/billing');

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Enforce HTTPS in production to guarantee secure session cookies
if (isProduction) {
  app.use((request, response, next) => {
    if (request.headers['x-forwarded-proto'] !== 'https' && !request.secure) {
      return response.redirect(301, 'https://' + request.headers.host + request.url);
    }
    next();
  });
}

// Baseline security headers
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-DNS-Prefetch-Control', 'off');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com https://api.instagram.com https://graph.instagram.com https://graph.facebook.com https://oauth2.googleapis.com https://api.razorpay.com https://checkout.razorpay.com; frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';");
  if (isProduction) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
  next();
});

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'jayvardhanreddy2008@gmail.com').trim().toLowerCase();

async function loginRateLimit(request, response, next) {
  try {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    if (email === ADMIN_EMAIL) return next();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const allowed = await db.consumeRateLimit(`login:${ip}`, 15 * 60 * 1000, 15);
    if (!allowed) {
      response.setHeader('Retry-After', '900');
      return response.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    }
    return next();
  } catch (error) {
    console.error('Login rate limiter error:', error.message);
    return response.status(503).json({ error: 'Authentication is temporarily unavailable. Please try again shortly.' });
  }
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'comment2dm_super_secure_jwt_secret_key_minimum_32_chars!';
}

app.use(cookieParser());
app.use('/api', requireSameOriginForStateChanges);
billing.register(app);

app.use(express.json({ limit: '20kb' }));
billing.registerPostParser(app);

function requireSameOriginForStateChanges(request, response, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
  if (request.path === '/instagram/webhook' || request.path === '/billing/webhook') return next();
  if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) return next();

  const fetchSite = request.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    return response.status(403).json({ error: 'Cross-origin request blocked.' });
  }

  const requestHost = request.get('host');
  const origin = request.get('origin');
  const referer = request.get('referer');

  function matches(val) {
    if (!val) return false;
    try {
      const u = new URL(val);
      return u.host === requestHost;
    } catch {
      return false;
    }
  }

  if (origin && !matches(origin)) {
    return response.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  if (referer && !matches(referer)) {
    return response.status(403).json({ error: 'Cross-origin request blocked.' });
  }

  return next();
}

app.use(express.static(path.join(__dirname)));

function validateCredentials(body, includeName) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (includeName && (name.length < 2 || name.length > 100)) return 'Enter a valid full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (password.length < 6 || password.length > 128) return 'Password must be at least 6 characters.';
  return null;
}

function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'nudge-app', audience: 'nudge-web' });
}

const AUTH_SESSION_DAYS = 60; // 60 days persistent login
const AUTH_SESSION_MS = AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000;

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: AUTH_SESSION_MS,
    expires: new Date(Date.now() + AUTH_SESSION_MS),
    path: '/'
  };
}

async function setAuthCookie(response, user) {
  const expiresAt = new Date(Date.now() + AUTH_SESSION_MS);
  const sessionToken = await authService.createSession(user.id, expiresAt);
  response.cookie('nudge_session', sessionToken, sessionCookieOptions());
  response.cookie('comment2dm_session', sessionToken, sessionCookieOptions());
  return sessionToken;
}

// Dual Session Auth Middleware: checks Bearer header first, then cookies
async function requireAuth(request, response, next) {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    try {
      const user = await authService.getSessionUser(bearerToken);
      if (user) {
        request.user = user;
        request.sessionToken = bearerToken;
        return next();
      }
    } catch (e) {}
  }

  // 2. Cookie session
  const sessionToken = request.cookies.comment2dm_session || request.cookies.nudge_session;
  if (sessionToken) {
    try {
      const user = await authService.getSessionUser(sessionToken);
      if (user) {
        request.user = user;
        request.sessionToken = sessionToken;
        return next();
      }
    } catch (error) {
      console.error('Session lookup failed:', error.message);
    }
  }

  // 3. Fallback JWT cookie
  const token = request.cookies.nudge_token;
  if (token) {
    try {
      const payload = verifyJwt(token);
      const user = await authService.getUserById(payload.sub);
      if (user) {
        request.user = user;
        return next();
      }
    } catch (error) {}
  }

  return response.status(401).json({ error: 'Authentication required. Please log in.' });
}

function requireAdmin(request, response, next) {
  if (request.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return response.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

// ==========================================
// Authentication Routes
// ==========================================

app.post('/api/auth/signup', loginRateLimit, async (request, response, next) => {
  try {
    const validationError = validateCredentials(request.body, true);
    if (validationError) return response.status(400).json({ error: validationError });
    const user = await authService.register({
      name: request.body.name.trim(),
      email: request.body.email.trim().toLowerCase(),
      password: request.body.password
    });
    const sessionToken = await setAuthCookie(response, user);
    return response.status(201).json({ user, sessionToken });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/login', loginRateLimit, async (request, response, next) => {
  try {
    const validationError = validateCredentials(request.body, false);
    if (validationError) return response.status(400).json({ error: validationError });
    const user = await authService.authenticate(
      request.body.email.trim().toLowerCase(),
      request.body.password
    );
    const sessionToken = await setAuthCookie(response, user);
    return response.json({ user, sessionToken });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/logout', async (request, response) => {
  try {
    const token = request.cookies.comment2dm_session || request.cookies.nudge_session;
    if (token) await authService.deleteSession(token);
  } catch (error) {
    console.error('Session logout cleanup failed:', error.message);
  }
  response.clearCookie('comment2dm_session', { path: '/' });
  response.clearCookie('nudge_session', { path: '/' });
  response.clearCookie('nudge_token', { path: '/' });
  response.status(204).end();
});

app.get('/api/auth/google', (request, response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.protocol}://${request.get('host')}/api/auth/google/callback`;
  if (!clientId) {
    return response.redirect('/login.html?auth_error=' + encodeURIComponent('Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID in Render.'));
  }
  const state = jwt.sign({ nonce: crypto.randomBytes(16).toString('hex') }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return response.redirect(url.toString());
});

app.get('/api/auth/google/callback', async (request, response) => {
  const fail = (msg) => response.redirect('/login.html?auth_error=' + encodeURIComponent(msg));
  try {
    if (typeof request.query.code !== 'string' || typeof request.query.state !== 'string') return fail('Google sign-in was cancelled.');
    jwt.verify(request.query.state, process.env.JWT_SECRET);
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return fail('Google sign-in is not configured on the server.');

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.protocol}://${request.get('host')}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: request.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.id_token) return fail('Google sign-in could not be completed.');

    const profileResponse = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokenData.id_token));
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email) return fail('Google account verification failed.');

    const user = await authService.registerOAuthUser({ name: profile.name || profile.email.split('@')[0], email: profile.email });
    await setAuthCookie(response, user);
    return response.redirect('/dashboard.html');
  } catch (error) {
    console.error('Google OAuth callback failed:', error.message);
    return fail('Google sign-in could not be completed. Please try again.');
  }
});

app.get('/api/me', requireAuth, (request, response) => {
  return response.json({ user: request.user });
});

// ==========================================
// User Settings & Profile
// ==========================================

app.get('/api/settings', requireAuth, async (request, response, next) => {
  try {
    const user = await db.getUserById(request.user.id);
    return response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        avatarUrl: user.avatar_url || '',
        createdAt: user.created_at || user.createdAt
      },
      preferences: { notifications: true, emailReports: true }
    });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/settings/profile', requireAuth, async (request, response, next) => {
  try {
    const { name, email, phone, avatarUrl } = request.body || {};
    if (name && (name.length < 2 || name.length > 100)) {
      return response.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    }
    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return response.status(400).json({ error: 'Enter a valid email address.' });
      }
      const existing = await db.getUserByEmail(cleanEmail);
      if (existing && existing.id !== request.user.id) {
        return response.status(409).json({ error: 'An account with that email already exists.' });
      }
    }

    await db.updateUserProfile(request.user.id, { name, email, phone, avatarUrl });
    const updated = await db.getUserById(request.user.id);
    return response.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone || '',
        avatarUrl: updated.avatar_url || '',
        createdAt: updated.created_at || updated.createdAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/settings/password', requireAuth, async (request, response, next) => {
  try {
    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword) {
      return response.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (newPassword.length < 6) {
      return response.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const userRecord = await db.getUserById(request.user.id);
    if (!userRecord || !userRecord.password_hash) {
      return response.status(400).json({ error: 'Password change not available for OAuth accounts.' });
    }

    const matches = await bcrypt.compare(currentPassword, userRecord.password_hash);
    if (!matches) {
      return response.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.updateUserPassword(request.user.id, newHash);
    return response.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/account/delete', requireAuth, async (request, response, next) => {
  try {
    await db.deleteUserAccount(request.user.id);
    response.clearCookie('comment2dm_session', { path: '/' });
    response.clearCookie('nudge_session', { path: '/' });
    return response.json({ success: true, message: 'Account deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

// ==========================================
// Instagram Connection & Accounts
// ==========================================

app.get('/api/instagram/authorize', requireAuth, (request, response, next) => {
  try {
    instagramService.ensureConfiguration();
    const state = jwt.sign(
      { sub: request.user.id, nonce: crypto.randomBytes(16).toString('hex') },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
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
  const errorRedirect = (message) => response.redirect(`/instagram-accounts.html?instagram_error=${encodeURIComponent(message)}`);
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
    return errorRedirect('Instagram authorization could not be completed. Please ensure your Meta App credentials are correct.');
  }
});

app.get('/api/instagram/accounts', requireAuth, async (request, response, next) => {
  try {
    return response.json({ accounts: await instagramService.listAccounts(request.user.id) });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/instagram/accounts/:instagramUserId/reels', requireAuth, async (request, response, next) => {
  try {
    const force = request.query.refresh === '1';
    const reels = await instagramService.listReels(request.user.id, request.params.instagramUserId, force);
    return response.json({ reels });
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

// ==========================================
// Comment-to-DM Automations (Fast & Reliable)
// ==========================================

app.get('/api/automations', requireAuth, async (request, response, next) => {
  try {
    const automations = await db.all(
      `SELECT a.id, a.owner_user_id AS ownerUserId, a.instagram_user_id AS instagramUserId,
              a.keyword, a.dm_message AS dmMessage, a.reply_template AS replyTemplate, a.trigger_type AS triggerType,
              a.enabled, a.media_id AS mediaId, a.media_url AS mediaUrl, a.created_at AS createdAt,
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
    const { instagramUserId, keyword, dmMessage, replyTemplate, triggerType, enabled, mediaUrl, mediaId } = request.body || {};
    const trimmedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    const trimmedMessage = typeof dmMessage === 'string' ? dmMessage.trim() : '';
    const trimmedReply = typeof replyTemplate === 'string' ? replyTemplate.trim() : '';
    const trigger = triggerType === 'all' ? 'all' : 'keyword';
    const targetIgId = typeof instagramUserId === 'string' ? instagramUserId.trim() : '';

    if (!targetIgId) {
      return response.status(400).json({ error: 'Please select a connected Instagram account.' });
    }
    if (trigger === 'keyword' && !trimmedKeyword) {
      return response.status(400).json({ error: 'Trigger keyword must not be empty.' });
    }
    if (!trimmedMessage) {
      return response.status(400).json({ error: 'Private DM message must not be empty.' });
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
    let selectedMediaId = mediaId || null;
    let selectedMediaUrl = mediaUrl || null;

    if (!selectedMediaId && mediaUrl && String(mediaUrl).trim() !== '') {
      try {
        const media = await instagramService.resolveReelUrl(request.user.id, targetIgId, mediaUrl);
        if (media) {
          selectedMediaId = media.id;
          selectedMediaUrl = media.permalink;
        }
      } catch (e) {
        selectedMediaUrl = mediaUrl;
      }
    }

    const result = await db.run(
      `INSERT INTO automations (owner_user_id, instagram_user_id, keyword, dm_message, enabled, created_at, updated_at, media_id, media_url, reply_template, trigger_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.user.id, targetIgId, trimmedKeyword, trimmedMessage, isEnabled, now, now, selectedMediaId, selectedMediaUrl, trimmedReply, trigger]
    );

    const created = await db.get(
      `SELECT a.id, a.owner_user_id AS ownerUserId, a.instagram_user_id AS instagramUserId,
              a.keyword, a.dm_message AS dmMessage, a.reply_template AS replyTemplate, a.trigger_type AS triggerType,
              a.enabled, a.media_id AS mediaId, a.media_url AS mediaUrl, a.created_at AS createdAt,
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
    const automationId = request.params.id;
    const existing = await db.get(
      'SELECT * FROM automations WHERE id = ? AND owner_user_id = ?',
      [automationId, request.user.id]
    );
    if (!existing) {
      return response.status(404).json({ error: 'Automation not found.' });
    }

    const { instagramUserId, keyword, dmMessage, replyTemplate, triggerType, enabled, mediaUrl, mediaId } = request.body || {};

    let targetIgId = existing.instagram_user_id;
    if (typeof instagramUserId === 'string' && instagramUserId.trim() !== '') {
      targetIgId = instagramUserId.trim();
    }

    let newKeyword = existing.keyword;
    if (keyword !== undefined) newKeyword = String(keyword).trim();

    let newMessage = existing.dm_message;
    if (dmMessage !== undefined) newMessage = String(dmMessage).trim();

    let newReply = existing.reply_template;
    if (replyTemplate !== undefined) newReply = String(replyTemplate).trim();

    let newTrigger = existing.trigger_type || 'keyword';
    if (triggerType !== undefined) newTrigger = triggerType === 'all' ? 'all' : 'keyword';

    let newEnabled = existing.enabled;
    if (enabled !== undefined) newEnabled = enabled === true || enabled === 1 || enabled === '1' ? 1 : 0;

    let newMediaId = existing.media_id || null;
    if (mediaId !== undefined) newMediaId = mediaId || null;

    let newMediaUrl = existing.media_url || null;
    if (mediaUrl !== undefined) newMediaUrl = mediaUrl || null;

    const now = new Date().toISOString();
    await db.run(
      `UPDATE automations
       SET instagram_user_id = ?, keyword = ?, dm_message = ?, enabled = ?, updated_at = ?, media_id = ?, media_url = ?, reply_template = ?, trigger_type = ?
       WHERE id = ? AND owner_user_id = ?`,
      [targetIgId, newKeyword, newMessage, newEnabled, now, newMediaId, newMediaUrl, newReply, newTrigger, automationId, request.user.id]
    );

    const updated = await db.get(
      `SELECT a.id, a.owner_user_id AS ownerUserId, a.instagram_user_id AS instagramUserId,
              a.keyword, a.dm_message AS dmMessage, a.reply_template AS replyTemplate, a.trigger_type AS triggerType,
              a.enabled, a.media_id AS mediaId, a.media_url AS mediaUrl, a.created_at AS createdAt,
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
    const automationId = request.params.id;
    await db.run('DELETE FROM automations WHERE id = ? AND owner_user_id = ?', [automationId, request.user.id]);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

// ==========================================
// Instagram Webhook Handler (Comment to DM + Public Reply)
// ==========================================

app.get('/api/instagram/webhook', (request, response) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error('META_WEBHOOK_VERIFY_TOKEN is not configured.');
    return response.status(500).json({ error: 'META_WEBHOOK_VERIFY_TOKEN is missing.' });
  }

  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Meta Webhook verified successfully.');
    return response.status(200).send(challenge);
  } else {
    console.warn('Meta Webhook verification failed.');
    return response.status(403).json({ error: 'Verification failed.' });
  }
});

function keywordMatches(commentText, keyword, triggerType) {
  if (triggerType === 'all') return true;
  if (!commentText) return false;
  if (!keyword || keyword.trim() === '*' || keyword.trim().toLowerCase() === 'all') return true;
  const cleanComment = commentText.toLowerCase().trim();
  const cleanKeyword = keyword.toLowerCase().trim();
  return cleanComment.includes(cleanKeyword);
}

app.post('/api/instagram/webhook', async (request, response) => {
  response.status(200).json({ status: 'ok' });

  try {
    if (request.billingBlocked) return;
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

        // Duplicate prevention
        const existingEvent = await db.get('SELECT event_id FROM webhook_events WHERE event_id = ?', [commentId]);
        if (existingEvent) {
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
          continue;
        }

        const commentMediaId = String(commentVal.media?.id || commentVal.media_id || commentVal.mediaId || '');

        for (const auto of automations) {
          // If automation is specific to one reel, check media ID
          if (auto.media_id && commentMediaId && String(auto.media_id) !== commentMediaId) {
            continue;
          }

          if (keywordMatches(commentText, auto.keyword, auto.trigger_type)) {
            console.log(`Matched automation ${auto.id} for comment ${commentId}. Sending replies...`);
            try {
              const tokenData = await instagramService.getDecryptedTokenByInstagramUserId(recipientIgUserId, auto.owner_user_id);

              // 1. Send Private DM
              await instagramService.sendPrivateReply(
                recipientIgUserId,
                commentId,
                auto.dm_message,
                tokenData.accessToken
              );

              // 2. Send Public Comment Reply (if configured)
              if (auto.reply_template) {
                await instagramService.replyToComment(
                  commentId,
                  auto.reply_template,
                  tokenData.accessToken
                );
              }

              await db.run(
                'INSERT INTO automation_events (owner_user_id, instagram_user_id, automation_id, comment_id, event_type, keyword, message_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [auto.owner_user_id, recipientIgUserId, auto.id, commentId, 'private_reply', auto.keyword, auto.dm_message, 'success', new Date().toISOString()]
              );
              console.log(`Successfully sent DM & reply for comment ID ${commentId}`);
            } catch (apiErr) {
              await db.run(
                'INSERT INTO automation_events (owner_user_id, instagram_user_id, automation_id, comment_id, event_type, keyword, message_text, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [auto.owner_user_id, recipientIgUserId, auto.id, commentId, 'private_reply', auto.keyword, auto.dm_message, 'failed', apiErr.message, new Date().toISOString()]
              );
              console.error(`Failed to execute automation for comment ${commentId}:`, apiErr.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error in Instagram webhook processing:', err.message);
  }
});

// ==========================================
// Analytics & Admin
// ==========================================

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

    const sent = Number(totals?.messagesSent || 0);
    const failed = Number(totals?.messagesFailed || 0);
    const totalDMs = sent + failed;
    const deliveryRate = totalDMs > 0 ? Math.round((sent / totalDMs) * 100) : 100;

    return response.json({
      accounts: accounts?.count || 0,
      activeAutomations: activeAutomations?.count || 0,
      comments: Number(totals?.comments || 0),
      messagesSent: sent,
      messagesFailed: failed,
      successfulEvents: Number(totals?.successfulEvents || 0),
      deliveryRate,
      recent: recent || [],
      daily: daily || []
    });
  } catch (error) {
    return next(error);
  }
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

// ==========================================
// Creator Studio AI & Support Chat
// ==========================================

app.post('/api/creator/generate', requireAuth, async (request, response) => {
  const body = request.body || {};
  const tool = typeof body.tool === 'string' ? body.tool.trim().toLowerCase() : 'content';
  const level = typeof body.level === 'string' ? body.level.trim().toLowerCase() : 'pro';
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
  const format = typeof body.format === 'string' ? body.format.trim() : 'Reel';
  const tone = typeof body.tone === 'string' ? body.tone.trim() : 'High-energy';
  const length = typeof body.length === 'string' ? body.length.trim() : '30s';

  if (!topic) return response.status(400).json({ error: 'Please enter a topic or theme.' });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const prompt = `You are Comment2DM AI, a world-class Instagram creator strategist. Write high-converting, viral Instagram content for topic: "${topic}".
Audience: ${audience || 'General Instagram Creators'}.
Format: ${format}. Tone: ${tone}. Target Length: ${length}.
Generate:
1. 3 Viral Hooks (Curiosity, Contrarian, Problem-Agitation)
2. Reel Script (Visual beats, on-screen text, spoken copy)
3. High-Converting Caption with Call To Action to comment a keyword for an instant DM!`;

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: 'You are an elite Instagram viral content strategist.' }, { role: 'user', content: prompt }],
          max_tokens: 800
        })
      });
      const data = await aiRes.json().catch(() => ({}));
      const text = data?.choices?.[0]?.message?.content;
      if (text) return response.json({ output: text, mode: 'ai' });
    }

    // High quality built-in templates if no API key is set
    const fallback = `🔥 3 VIRAL HOOKS:
1. "Stop making this huge mistake with ${topic} (do this instead) 👇"
2. "The exact strategy I used to master ${topic} in under 7 days..."
3. "Most people do ${topic} backwards. Here is the framework that actually works:"

🎬 REEL SCRIPT (${length}):
[0-2s] Pattern Interrupt: Look directly at the camera. Text on screen: "Don't scroll if you care about ${topic}".
[3-10s] Problem: State the #1 struggle your audience experiences with ${topic}.
[11-20s] Solution Breakdown: Show 2 simple actionable steps or insider tips.
[21-30s] Call to Action: "Want the full step-by-step checklist? Comment 'SEND' below and I'll DM you the link instantly!"

📝 CAPTION & KEYWORD CTA:
If you want to master ${topic} without spending months guessing, you need this system. 
Save this post for later 📌
Comment "LINK" below and Comment2DM will send the full guide directly to your inbox! 📩`;

    return response.json({ output: fallback, mode: 'built-in' });
  } catch (error) {
    return response.status(500).json({ error: 'AI generation error.' });
  }
});

const supportKnowledge = [
  { keys: ['hi', 'hello', 'hey'], answer: 'Hi! Welcome to Comment2DM Support. How can I assist you with your Instagram automations, account connection, or billing today?' },
  { keys: ['connect', 'instagram', 'meta', 'account'], answer: 'To connect Instagram: 1) Go to Instagram Accounts in the sidebar. 2) Click "Connect Instagram". 3) Authorize using your professional Meta account. Ensure you have Instagram Business Login permissions enabled.' },
  { keys: ['automation', 'keyword', 'comment', 'dm'], answer: 'Comment2DM triggers automatic DMs and public replies when someone comments on your Reels! Go to "Create Automation", select your account, choose your Reel, set the trigger keyword or select "All comments", and write your private DM and public reply.' },
  { keys: ['pricing', 'upgrade', 'plan', 'billing'], answer: 'Comment2DM offers 3 plans: Free (3 automations, 300 DMs), Pro (25 automations, 5,000 DMs, All Comments trigger, public replies), and Elite (Unlimited automations, 50,000 DMs, priority webhook queue). Manage your plan in Billing.' },
  { keys: ['help', 'contact', 'email'], answer: 'You can email our team directly at nudge.support360@gmail.com for priority help!' }
];

app.post('/api/support/chat', async (request, response) => {
  const rawMessage = typeof request.body?.message === 'string' ? request.body.message.trim().toLowerCase() : '';
  if (!rawMessage) return response.status(400).json({ error: 'Please enter a message.' });

  const match = supportKnowledge.find((item) => item.keys.some((k) => rawMessage.includes(k)));
  const reply = match ? match.answer : 'I am here to help you get the most out of Comment2DM. You can connect an Instagram account, set up comment-to-DM triggers, automate replies, or email support at nudge.support360@gmail.com.';

  return response.json({ reply, mode: 'support-agent' });
});

// ── Creator Studio AI ──────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

async function callGemini(prompt) {
  if (!GEMINI_KEY) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch { return null; }
}

function creatorFallback(type, body) {
  const { topic = '', tone = 'inspirational', count = 3, product = '', cta = '', niche = '' } = body || {};
  if (type === 'hooks') {
    const toneMap = {
      inspirational: [`Stop scrolling if you want to ${topic || 'change your life'}…`, `The ${topic || 'secret'} nobody tells you about…`, `I went from zero to ${topic || 'success'} in 30 days — here's how`, `What if I told you ${topic || 'this'} was easier than you think?`, `This changed everything for me 👇`],
      funny: [`POV: You discovered ${topic || 'the hack'} too late 😭`, `Me before vs after ${topic || 'this'} 💀`, `Nobody: Absolutely nobody: Me: ${topic || 'overthinking'}`, `Wait for the plot twist 😂`, `Things that hit different at 2am 👇`],
      educational: [`Here are 5 things about ${topic || 'this'} nobody talks about`, `The complete beginner's guide to ${topic || 'this'}`, `How to ${topic || 'get started'} in 60 seconds`, `${topic || 'This'} explained simply 🧵`, `The truth about ${topic || 'this'} (backed by data)`],
      controversial: [`Hot take: ${topic || 'You're doing this wrong'}`, `Unpopular opinion about ${topic || 'this industry'}…`, `I'm tired of pretending ${topic || 'this'} works`, `The ${topic || 'advice'} everyone gives is wrong`, `Say it louder: ${topic || 'This needs to change'}`],
      emotional: [`This hit me harder than I expected 💔`, `For everyone struggling with ${topic || 'this'}…`, `Nobody prepared me for this moment`, `If you need to hear this today…`, `The day everything changed for me 🥺`]
    };
    return (toneMap[tone] || toneMap.inspirational).slice(0, count);
  }
  if (type === 'dm_script') {
    return `Hey! 👋 Thanks so much for commenting on my reel!\n\nI saw you were interested in ${product || 'what I shared'} — here's exactly what you need:\n\n✨ ${cta || 'Check the link below'}\n\nThis is something I put together specifically for people in your position. It's helped so many people already, and I think it could really make a difference for you too.\n\nLet me know if you have any questions — I'm happy to help! 🙌\n\n— [Your Name]`;
  }
  if (type === 'ideas') {
    return [
      { title: `5 mistakes most ${niche || 'creators'} make (and how to fix them)`, hook: 'I wish someone told me this sooner…', format: 'reel' },
      { title: `Day in the life of a ${niche || 'content creator'} — honest version`, hook: 'Nobody talks about THIS part', format: 'reel' },
      { title: `${niche || 'Industry'} trends you need to know in 2024`, hook: 'The landscape is changing fast. Here\'s what\'s next…', format: 'carousel' },
      { title: `How I grew my ${niche || 'account'} from 0 to 10K in 90 days`, hook: 'It wasn\'t what I expected', format: 'reel' },
      { title: `${niche || 'Creator'} tools I can\'t live without (honest review)`, hook: 'I tested 20+ tools so you don\'t have to', format: 'carousel' },
      { title: `Answering your most asked questions about ${niche || 'my journey'}`, hook: 'You asked, I\'m answering everything', format: 'story' },
      { title: `The ${niche || 'content'} strategy that actually works in 2024`, hook: 'Stop doing what doesn\'t work', format: 'carousel' }
    ];
  }
  return 'Generated content will appear here.';
}

app.post('/api/creator/generate', requireAuth, async (request, response) => {
  const { type, topic, audience, tone, count, product, cta, niche, week } = request.body || {};
  if (!type) return response.status(400).json({ error: 'type is required' });
  try {
    let result = null;
    if (GEMINI_KEY) {
      let prompt = '';
      if (type === 'hooks') prompt = `Generate ${count || 3} scroll-stopping Instagram Reel hooks about "${topic}" for ${audience || 'general audience'} with a ${tone} tone. Return only the hooks, one per line, no numbering.`;
      else if (type === 'dm_script') prompt = `Write a friendly Instagram DM script for "${product}". CTA: ${cta}. Tone: ${tone}. Max 150 words. Natural, personalized, not spammy.`;
      else if (type === 'ideas') prompt = `Generate 7 Instagram content ideas for the ${niche} niche for ${week || 'this week'}. Return as JSON array of objects with: title, hook, format (reel/carousel/story/static).`;
      const raw = await callGemini(prompt);
      if (raw) {
        if (type === 'hooks') result = raw.split('\n').filter(l => l.trim()).slice(0, count || 3);
        else if (type === 'ideas') { try { result = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch { result = null; } }
        else result = raw;
      }
    }
    if (!result) result = creatorFallback(type, request.body);
    return response.json({ success: true, result });
  } catch (err) {
    return response.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// ── Contact form ────────────────────────────────────────────────────────────
app.post('/api/contact', async (request, response) => {
  const { name, email, subject, message } = request.body || {};
  if (!name || !email || !message) return response.status(400).json({ error: 'name, email and message are required' });
  try {
    if (db.collections && db.collections.contacts) {
      await db.collections.contacts.insertOne({ name: String(name).slice(0, 100), email: String(email).slice(0, 254), subject: String(subject || 'General').slice(0, 100), message: String(message).slice(0, 2000), created_at: new Date(), resolved: false });
    }
    return response.json({ success: true });
  } catch { return response.json({ success: true }); }
});

// ── Analytics Events for DM Log ─────────────────────────────────────────────
app.get('/api/analytics/events', requireAuth, async (request, response) => {
  try {
    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.min(50, parseInt(request.query.limit) || 20);
    const status = request.query.status || 'all';
    const days = parseInt(request.query.days) || 7;
    const search = request.query.search || '';
    const col = db.collections ? db.collections().automation_events : null;
    if (!col) return response.json({ events: [], total: 0, sent: 0, failed: 0, pending: 0, pages: 1 });
    const since = new Date(Date.now() - days * 86400000);
    const filter = { user_id: request.user.id, created_at: { $gte: since } };
    if (status !== 'all') filter.status = status;
    if (search) filter.$or = [{ senderName: { $regex: search, $options: 'i' } }, { commentText: { $regex: search, $options: 'i' } }];
    const [events, total, sent, failed, pending] = await Promise.all([
      col.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      col.countDocuments(filter),
      col.countDocuments({ ...filter, status: 'sent' }),
      col.countDocuments({ ...filter, status: 'failed' }),
      col.countDocuments({ ...filter, status: 'pending' })
    ]);
    return response.json({ events, total, sent, failed, pending, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

// ── Admin endpoints ─────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (request, response) => {
  try {
    const users = db.collections ? await db.collections().users.find({}, { projection: { password: 0 } }).sort({ created_at: -1 }).limit(500).toArray() : [];
    return response.json({ users });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/users/:id/plan', requireAdmin, async (request, response) => {
  try {
    const { plan } = request.body || {};
    if (!['free', 'pro', 'elite'].includes(plan)) return response.status(400).json({ error: 'Invalid plan' });
    const { ObjectId } = require('mongodb');
    await db.collections().users.updateOne({ _id: new ObjectId(request.params.id) }, { $set: { plan, updated_at: new Date() } });
    return response.json({ success: true });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/users/:id/suspend', requireAdmin, async (request, response) => {
  try {
    const { ObjectId } = require('mongodb');
    const user = await db.collections().users.findOne({ _id: new ObjectId(request.params.id) });
    if (!user) return response.status(404).json({ error: 'User not found' });
    await db.collections().users.updateOne({ _id: new ObjectId(request.params.id) }, { $set: { suspended: !user.suspended, updated_at: new Date() } });
    return response.json({ success: true, suspended: !user.suspended });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.get('/api/admin/revenue', requireAdmin, async (request, response) => {
  try {
    const col = db.collections ? db.collections().payments : null;
    if (!col) return response.json({ months: [] });
    const since = new Date(); since.setMonth(since.getMonth() - 6);
    const payments = await col.find({ status: 'paid', created_at: { $gte: since } }).toArray();
    const months = {};
    payments.forEach(p => {
      const key = new Date(p.created_at).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      months[key] = (months[key] || 0) + (p.amount || 0);
    });
    return response.json({ months: Object.entries(months).map(([month, total]) => ({ month, total: Math.round(total / 100) })) });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.get('/api/admin/health', requireAdmin, async (request, response) => {
  const start = Date.now();
  let dbOk = false;
  try { await db.collections().users.findOne({}, { projection: { _id: 1 } }); dbOk = true; } catch {}
  return response.json({ api: true, database: dbOk, latency: Date.now() - start, timestamp: new Date().toISOString() });
});

app.get('/api/admin/contacts', requireAdmin, async (request, response) => {
  try {
    const col = db.collections ? db.collections().contacts : null;
    const contacts = col ? await col.find({}).sort({ created_at: -1 }).limit(100).toArray() : [];
    return response.json({ contacts });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/contacts/:id/resolve', requireAdmin, async (request, response) => {
  try {
    const { ObjectId } = require('mongodb');
    await db.collections().contacts.updateOne({ _id: new ObjectId(request.params.id) }, { $set: { resolved: true, resolved_at: new Date() } });
    return response.json({ success: true });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.get('/api/admin/config', requireAdmin, async (request, response) => {
  try {
    const col = db.collections ? db.collections().billing_plans : null;
    const coup = db.collections ? db.collections().coupons : null;
    const pricesDoc = col ? await col.findOne({ _id: 'global_prices' }) : null;
    const coupons = coup ? await coup.find({}).toArray() : [];
    return response.json({ 
      prices: pricesDoc || { pro_monthly: 999, elite_monthly: 2499 },
      coupons: coupons.map(c => ({ code: c._id, discount: c.discount }))
    });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.post('/api/admin/config/prices', requireAdmin, async (request, response) => {
  try {
    const { pro_monthly, elite_monthly } = request.body || {};
    if (db.collections) {
      await db.collections().billing_plans.updateOne(
        { _id: 'global_prices' }, 
        { $set: { pro_monthly: pro_monthly || 999, elite_monthly: elite_monthly || 2499, updated_at: new Date() } },
        { upsert: true }
      );
    }
    return response.json({ success: true });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.post('/api/admin/config/coupon', requireAdmin, async (request, response) => {
  try {
    const { code, discount } = request.body || {};
    if (!code || !discount) return response.status(400).json({ error: 'Code and discount required' });
    if (db.collections) {
      await db.collections().coupons.updateOne(
        { _id: code.toUpperCase() }, 
        { $set: { discount: Number(discount), created_at: new Date() } },
        { upsert: true }
      );
    }
    return response.json({ success: true });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/config/coupon/:code', requireAdmin, async (request, response) => {
  try {
    if (db.collections) {
      await db.collections().coupons.deleteOne({ _id: request.params.code.toUpperCase() });
    }
    return response.json({ success: true });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

app.get('/api/billing/prices', async (request, response) => {
  try {
    const col = db.collections ? db.collections().billing_plans : null;
    const pricesDoc = col ? await col.findOne({ _id: 'global_prices' }) : null;
    return response.json(pricesDoc || { pro_monthly: 999, elite_monthly: 2499 });
  } catch (err) { return response.json({ pro_monthly: 999, elite_monthly: 2499 }); }
});

app.post('/api/billing/validate-coupon', async (request, response) => {
  try {
    const { code } = request.body || {};
    if (!code) return response.status(400).json({ error: 'Code required' });
    const col = db.collections ? db.collections().coupons : null;
    const coupon = col ? await col.findOne({ _id: code.toUpperCase() }) : null;
    if (!coupon) return response.status(404).json({ error: 'Invalid coupon' });
    return response.json({ valid: true, discount: coupon.discount });
  } catch (err) { return response.status(500).json({ error: err.message }); }
});

// 404 & Error handlers
app.use((request, response) => {
  if (request.path.startsWith('/api/')) return response.status(404).json({ error: 'Endpoint not found.' });
  return response.status(404).sendFile(path.join(__dirname, '404.html'));
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  console.error('Server error:', error);
  response.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Something went wrong. Please try again.'
  });
});

db.initialize().then(async () => {
  await billing.ensurePlans();
  app.listen(port, '0.0.0.0', () => {
    console.log(`Comment2DM server is live on port ${port} (HTTPS ready)`);
  });
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exitCode = 1;
});
