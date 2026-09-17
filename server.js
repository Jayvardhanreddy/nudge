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
    authorizeUrl.searchParams.set('scope', 'instagram_business_basic');
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

app.get('/api/admin/overview', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const users = await authService.listUsers();
    const instagramAccounts = await instagramService.listAllAccounts();
    return response.json({ users, instagramAccounts });
  } catch (error) {
    return next(error);
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
