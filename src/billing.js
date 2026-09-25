const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const Razorpay = require('razorpay');
const authService = require('./auth/authService');

// Subscription Plan Configurations (Prices in INR Paise: 49900 = ₹499)
const PLANS = {
  pro_monthly: {
    plan: 'pro',
    cycle: 'monthly',
    amount: 49900,
    period: 'monthly',
    totalCount: 120,
    name: 'Comment2DM Pro Monthly'
  },
  pro_annual: {
    plan: 'pro',
    cycle: 'annual',
    amount: 499900,
    period: 'yearly',
    totalCount: 10,
    name: 'Comment2DM Pro Annual'
  },
  elite_monthly: {
    plan: 'elite',
    cycle: 'monthly',
    amount: 149900,
    period: 'monthly',
    totalCount: 120,
    name: 'Comment2DM Elite Monthly'
  },
  elite_annual: {
    plan: 'elite',
    cycle: 'annual',
    amount: 1499900,
    period: 'yearly',
    totalCount: 10,
    name: 'Comment2DM Elite Annual'
  },
  // Legacy aliases
  creator_monthly: {
    plan: 'pro',
    cycle: 'monthly',
    amount: 49900,
    period: 'monthly',
    totalCount: 120,
    name: 'Comment2DM Pro Monthly'
  },
  growth_monthly: {
    plan: 'pro',
    cycle: 'monthly',
    amount: 69900,
    period: 'monthly',
    totalCount: 120,
    name: 'Comment2DM Pro Monthly'
  },
  scale_monthly: {
    plan: 'elite',
    cycle: 'monthly',
    amount: 149900,
    period: 'monthly',
    totalCount: 120,
    name: 'Comment2DM Elite Monthly'
  }
};

// Tier Quotas & Feature Entitlements
const LIMITS = {
  free: {
    instagramAccounts: 1,
    automations: 3,
    dmMonthly: 300,
    aiCreditsMonthly: 100,
    allCommentsTrigger: false,
    publicReplies: true
  },
  pro: {
    instagramAccounts: 3,
    automations: 25,
    dmMonthly: 5000,
    aiCreditsMonthly: 2500,
    allCommentsTrigger: true,
    publicReplies: true
  },
  elite: {
    instagramAccounts: 10,
    automations: Infinity,
    dmMonthly: 50000,
    aiCreditsMonthly: 30000,
    allCommentsTrigger: true,
    publicReplies: true
  },
  // Aliases for legacy plan data in DB
  creator: {
    instagramAccounts: 3,
    automations: 25,
    dmMonthly: 5000,
    aiCreditsMonthly: 2500,
    allCommentsTrigger: true,
    publicReplies: true
  },
  growth: {
    instagramAccounts: 5,
    automations: 50,
    dmMonthly: 15000,
    aiCreditsMonthly: 10000,
    allCommentsTrigger: true,
    publicReplies: true
  },
  scale: {
    instagramAccounts: 10,
    automations: Infinity,
    dmMonthly: 50000,
    aiCreditsMonthly: 30000,
    allCommentsTrigger: true,
    publicReplies: true
  }
};

let db;
let mongo;
let rz;
const cache = new Map();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'jayvardhanreddy2008@gmail.com').trim().toLowerCase();

async function store() {
  if (db) return db;
  mongo = new MongoClient(process.env.MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    maxPoolSize: 5
  });
  await mongo.connect();
  db = mongo.db(process.env.MONGODB_DB_NAME || 'nudge');

  await Promise.allSettled([
    db.collection('subscriptions').createIndex({ user_id: 1, created_at: -1 }),
    db.collection('subscriptions').createIndex({ razorpay_subscription_id: 1 }, { unique: true, sparse: true }),
    db.collection('billing_events').createIndex({ event_id: 1 }, { unique: true, sparse: true }),
    db.collection('billing_plans').createIndex({ plan_key: 1 }, { unique: true })
  ]);
  return db;
}

async function auth(req) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const user = await authService.getSessionUser(token);
      if (user) return user;
    }
    if (req.cookies?.nudge_session) {
      const user = await authService.getSessionUser(req.cookies.nudge_session);
      if (user) return user;
    }
    const token = req.cookies?.nudge_token;
    if (token) {
      const p = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'nudge-app', audience: 'nudge-web' });
      return p?.sub ? await authService.getUserById(p.sub) : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function entitlement(uid) {
  const d = await store();
  const user = await d.collection('users').findOne({ id: uid }, { projection: { email: 1 } });
  if (user?.email?.toLowerCase() === ADMIN_EMAIL) {
    return {
      plan: 'elite',
      isAdmin: true,
      limits: {
        instagramAccounts: Infinity,
        automations: Infinity,
        dmMonthly: Infinity,
        aiCreditsMonthly: Infinity,
        allCommentsTrigger: true,
        publicReplies: true
      },
      subscription: null
    };
  }

  const s = await d.collection('subscriptions').findOne({ user_id: uid, status: 'active' }, { sort: { created_at: -1 } });
  const rawPlan = s?.plan || 'free';
  const plan = LIMITS[rawPlan] ? (rawPlan === 'creator' || rawPlan === 'growth' ? 'pro' : rawPlan === 'scale' ? 'elite' : rawPlan) : 'free';
  return {
    plan,
    limits: LIMITS[plan] || LIMITS.free,
    subscription: s
  };
}

async function counts(uid) {
  const d = await store();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const [accounts, automations, dmMonthly] = await Promise.all([
    d.collection('instagram_accounts').countDocuments({ owner_user_id: uid }),
    d.collection('automations').countDocuments({ owner_user_id: uid, enabled: true }),
    d.collection('automation_events').countDocuments({
      owner_user_id: uid,
      event_type: 'private_reply',
      status: 'success',
      created_at: { $gte: start.toISOString() }
    })
  ]);
  return { accounts, automations, dmMonthly };
}

async function check(uid, resource) {
  const e = await entitlement(uid);
  const c = await counts(uid);
  const used = resource === 'instagramAccounts' ? c.accounts : resource === 'automations' ? c.automations : c.dmMonthly;
  return { ...e, used, allowed: used < e.limits[resource] };
}

async function billingRateLimit(req, res, next) {
  try {
    const u = await auth(req);
    if (u?.email?.toLowerCase() === ADMIN_EMAIL) return next();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const uid = u?.id || 'anon';
    const key = `billing:${req.path}:${uid}`;
    const max = req.path.includes('create-subscription') ? 5 : req.path.includes('verify-subscription') ? 15 : 10;
    if (!(await require('../src/db').consumeRateLimit(key, 15 * 60 * 1000, max))) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: 'Too many billing requests. Please try again later.' });
    }
    next();
  } catch (e) {
    return res.status(503).json({ error: 'Billing is temporarily unavailable. Please try again shortly.' });
  }
}

async function razor() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  if (!rz) {
    rz = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }
  return rz;
}

async function planList() {
  const authHeader = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/plans?count=100', {
    headers: { Authorization: 'Basic ' + authHeader }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.description || 'Unable to list Razorpay plans.');
  return j.items || [];
}

async function ensurePlans() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.log('Razorpay keys not configured; subscription plans will be initialized when keys are added.');
    return;
  }
  try {
    const d = await store();
    const existing = await planList();
    const authHeader = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');

    for (const [k, x] of Object.entries(PLANS)) {
      let p = existing.find((v) => v?.notes?.comment2dm_plan_key === k || v?.notes?.nudge_plan_key === k);
      if (!p) {
        const r = await fetch('https://api.razorpay.com/v1/plans', {
          method: 'POST',
          headers: { Authorization: 'Basic ' + authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            period: x.period,
            interval: 1,
            item: { name: x.name, amount: x.amount, currency: 'INR', description: x.name + ' for Comment2DM' },
            notes: { comment2dm_plan_key: k, product: 'comment2dm' }
          })
        });
        p = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(p?.error?.description || ('Unable to create plan ' + k));
      }
      cache.set(k, p.id);
      await d.collection('billing_plans').updateOne(
        { plan_key: k },
        { $set: { plan_key: k, razorpay_plan_id: p.id, amount: x.amount, currency: 'INR', period: x.period, updated_at: new Date().toISOString() } },
        { upsert: true }
      );
    }
    console.log('Razorpay Comment2DM subscription plans are ready.');
  } catch (e) {
    console.error('Razorpay plan setup note:', e.message);
  }
}

async function planId(k) {
  if (cache.has(k)) return cache.get(k);
  const d = await store();
  const p = await d.collection('billing_plans').findOne({ plan_key: k });
  if (p?.razorpay_plan_id) {
    cache.set(k, p.razorpay_plan_id);
    return p.razorpay_plan_id;
  }
  await ensurePlans();
  return cache.get(k);
}

function equal(a, b) {
  a = Buffer.from(String(a || ''));
  b = Buffer.from(String(b || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function create(req, res) {
  const u = await auth(req);
  if (!u) return res.status(401).json({ error: 'Authentication required.' });

  const rawKey = String(req.body?.planKey || '');
  const x = PLANS[rawKey];
  if (!x) return res.status(400).json({ error: 'Invalid subscription plan.' });

  const r = await razor();
  if (!r) return res.status(503).json({ error: 'Razorpay is not configured on Comment2DM yet.' });

  const d = await store();
  const existing = await d.collection('subscriptions').findOne(
    { user_id: u.id, status: { $in: ['created', 'authenticated', 'pending', 'active'] } },
    { sort: { created_at: -1 } }
  );

  if (existing) {
    if (existing.status === 'active') {
      return res.status(409).json({ error: 'You already have an active subscription. Cancel it before starting another plan.' });
    }
    if (existing.plan_key === rawKey && existing.razorpay_subscription_id) {
      return res.json({
        keyId: process.env.RAZORPAY_KEY_ID,
        subscriptionId: existing.razorpay_subscription_id,
        planKey: existing.plan_key,
        amount: PLANS[existing.plan_key]?.amount || x.amount,
        currency: 'INR',
        name: 'Comment2DM',
        prefill: {}
      });
    }
  }

  const pid = await planId(rawKey);
  if (!pid) return res.status(503).json({ error: 'Payment plans are not ready yet. Please try again shortly.' });

  const user = await d.collection('users').findOne({ id: u.id }, { projection: { id: 1, name: 1, email: 1 } });
  const s = await r.subscriptions.create({
    plan_id: pid,
    total_count: x.totalCount,
    customer_notify: 1,
    notes: { user_id: u.id, plan_key: rawKey }
  });

  await d.collection('subscriptions').updateOne(
    { razorpay_subscription_id: s.id },
    {
      $set: {
        user_id: u.id,
        plan: x.plan,
        billing_cycle: x.cycle,
        plan_key: rawKey,
        razorpay_plan_id: pid,
        status: s.status || 'created',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    },
    { upsert: true }
  );

  return res.json({
    keyId: process.env.RAZORPAY_KEY_ID,
    subscriptionId: s.id,
    planKey: rawKey,
    amount: x.amount,
    currency: 'INR',
    name: 'Comment2DM',
    prefill: { name: user?.name || '', email: user?.email || '' }
  });
}

async function verify(req, res) {
  const u = await auth(req);
  if (!u) return res.status(401).json({ error: 'Authentication required.' });

  const sid = String(req.body?.razorpay_subscription_id || '');
  const pid = String(req.body?.razorpay_payment_id || '');
  const sig = String(req.body?.razorpay_signature || '');
  if (!sid || !pid || !sig) return res.status(400).json({ error: 'Incomplete payment verification data.' });

  const exp = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(pid + '|' + sid).digest('hex');
  if (!equal(exp, sig)) return res.status(400).json({ error: 'Payment signature verification failed.' });

  const d = await store();
  const s = await d.collection('subscriptions').findOne({ razorpay_subscription_id: sid, user_id: u.id });
  if (!s) return res.status(404).json({ error: 'Subscription record not found.' });

  await d.collection('subscriptions').updateOne(
    { _id: s._id },
    { $set: { status: 'active', razorpay_payment_id: pid, updated_at: new Date().toISOString() } }
  );
  return res.json({ verified: true, plan: s.plan });
}

async function cancel(req, res) {
  const u = await auth(req);
  if (!u) return res.status(401).json({ error: 'Authentication required.' });

  const d = await store();
  const s = await d.collection('subscriptions').findOne(
    { user_id: u.id, status: { $in: ['created', 'authenticated', 'active', 'pending'] } },
    { sort: { created_at: -1 } }
  );
  if (!s) return res.status(404).json({ error: 'No active subscription found.' });

  const r = await razor();
  if (r && s.razorpay_subscription_id) {
    await r.subscriptions.cancel(s.razorpay_subscription_id, false).catch(() => {});
  }
  await d.collection('subscriptions').updateOne({ _id: s._id }, { $set: { status: 'cancelled', updated_at: new Date().toISOString() } });
  return res.json({ cancelled: true });
}

async function status(req, res) {
  const u = await auth(req);
  if (!u) return res.status(401).json({ error: 'Authentication required.' });
  const e = await entitlement(u.id);
  const c = await counts(u.id);

  return res.json({
    plan: e.plan,
    isAdmin: !!e.isAdmin,
    subscription: e.subscription ? { status: e.subscription.status, billingCycle: e.subscription.billing_cycle, currentEnd: e.subscription.current_end } : null,
    limits: {
      instagramAccounts: e.limits.instagramAccounts,
      automations: Number.isFinite(e.limits.automations) ? e.limits.automations : null,
      dmMonthly: e.limits.dmMonthly,
      aiCreditsMonthly: e.limits.aiCreditsMonthly,
      allCommentsTrigger: e.limits.allCommentsTrigger
    },
    usage: {
      instagramAccounts: c.accounts,
      automations: c.automations,
      dmMonthly: c.dmMonthly
    }
  });
}

async function webhook(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send('Webhook secret is not configured.');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const sig = req.get('x-razorpay-signature');
  const exp = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!equal(exp, sig)) return res.status(400).send('Invalid webhook signature.');

  let ev;
  try {
    ev = JSON.parse(raw.toString());
  } catch {
    return res.status(400).send('Invalid JSON.');
  }

  const d = await store();
  const eid = req.get('x-razorpay-event-id') || crypto.createHash('sha256').update(raw).digest('hex');
  try {
    await d.collection('billing_events').insertOne({ event_id: eid, event: ev, created_at: new Date().toISOString() });
  } catch (e) {
    if (e?.code === 11000) return res.json({ ok: true, duplicate: true });
    throw e;
  }

  const ent = ev?.payload?.subscription?.entity;
  if (ent?.id) {
    const map = {
      'subscription.activated': 'active',
      'subscription.pending': 'pending',
      'subscription.halted': 'halted',
      'subscription.cancelled': 'cancelled',
      'subscription.completed': 'completed'
    };
    const st = map[ev.event] || ent.status;
    await d.collection('subscriptions').updateOne(
      { razorpay_subscription_id: ent.id },
      {
        $set: {
          status: st,
          current_start: ent.current_start ? new Date(ent.current_start * 1000).toISOString() : null,
          current_end: ent.current_end ? new Date(ent.current_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString()
        }
      }
    );
  }
  return res.json({ ok: true });
}

function register(app) {
  app.post('/api/billing/webhook', require('express').raw({ type: 'application/json', limit: '256kb' }), webhook);
  app.get('/api/billing/status', status);
  app.post('/api/billing/create-subscription', billingRateLimit, require('express').json({ limit: '10kb' }), create);
  app.post('/api/billing/verify-subscription', billingRateLimit, require('express').json({ limit: '10kb' }), verify);
  app.post('/api/billing/cancel', billingRateLimit, require('express').json({ limit: '10kb' }), cancel);

  // Enforce tier limits
  app.use('/api/instagram/authorize', async (req, res, next) => {
    const u = await auth(req);
    if (!u) return next();
    try {
      const r = await check(u.id, 'instagramAccounts');
      if (!r.allowed) {
        return res.status(403).json({
          error: `Your ${r.plan.toUpperCase()} plan allows ${r.limits.instagramAccounts} Instagram account${r.limits.instagramAccounts === 1 ? '' : 's'}. Upgrade to connect more.`
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  app.use('/api/automations', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const u = await auth(req);
    if (!u) return next();
    try {
      const r = await check(u.id, 'automations');
      if (!r.allowed) {
        return res.status(403).json({
          error: `Your ${r.plan.toUpperCase()} plan allows ${r.limits.automations} active automations. Upgrade to Pro or Elite to create more.`
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  });
}

function registerPostParser(app) {
  app.use('/api/instagram/webhook', async (req, res, next) => {
    try {
      const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
      for (const entry of entries) {
        const ig = String(entry?.id || '');
        if (!ig) continue;
        const d = await store();
        const account = await d.collection('instagram_accounts').findOne({ instagram_user_id: ig }, { projection: { owner_user_id: 1 } });
        if (!account) continue;
        const r = await check(account.owner_user_id, 'dmMonthly');
        if (!r.allowed) {
          req.billingBlocked = true;
          break;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
}

module.exports = {
  register,
  registerPostParser,
  ensurePlans,
  check,
  entitlement,
  counts,
  PLANS,
  LIMITS
};