require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const helmet = require('helmet');
const winston = require('winston');
const { rateLimit } = require('express-rate-limit');
const hcaptcha = require('hcaptcha');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const csrf = require('csurf');
const PgSession = require('connect-pg-simple')(session);
const {randomBytes, createHash, randomUUID } = require('crypto');

const app = express();
app.set('trust proxy', 1);

// ----- ENV / MODE -----
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function mustBeURL(name) {
  const v = must(name);
  try { new URL(v); } catch (e) {
    throw new Error(`Invalid URL in ${name}: ${v}`);
  }
  return v;
}

if (process.env.RPC_URL) mustBeURL('RPC_URL');   
must('SESSION_SECRET');
if (process.env.DATABASE_URL) mustBeURL('DATABASE_URL');

const hasDb = !!process.env.DATABASE_URL;
let pool = null;
if (hasDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ...(isProd ? { ssl: { rejectUnauthorized: false } } : {})
  });
}
 async function db() {
  if (!hasDb) throw new Error('DB disabled');
  return pool;
}


// ----- MIDDLEWARE ORDER -----
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public', {
    maxAge: isProd ? '1h' : 0,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
     // explicit content-types you had
     if (filePath.endsWith('.js'))  res.setHeader('Content-Type', 'application/javascript');
     if (filePath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
     if (filePath.endsWith('.ico')) res.setHeader('Content-Type', 'image/x-icon');
      if (/\.(png|jpg|jpeg|gif|svg)$/i.test(filePath)) {
        res.setHeader('Cache-Control', isProd ? 'public, max-age=86400, immutable' : 'no-store');
      }
    }
  }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ----- SESSION STORE -----
const sessionStore = hasDb
  ? new PgSession({
      pool,
     tableName: 'session',
     createTableIfMissing: true,
     pruneSessionInterval: 60 * 60 // seconds
   })
 : undefined;

// ----- SESSION COOKIE -----
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: (process.env.CROSS_SITE_COOKIES === 'true') ? 'none' : 'lax',
    secure: isProd, // HTTPS on Render
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

const crossSite = process.env.CROSS_SITE_COOKIES === 'true';
const csrfProtection = csrf({
  cookie: {
    key: '_csrf',           // name of the secret cookie
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
  }
});
// must be BEFORE you mount csrfProtection on /api/* mutating routes
app.get('/api/csrf', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  return csrfProtection(req, res, next);
});

// =================== Config ===================
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_DAY_MS   = 24 * 60 * 60 * 1000;
const DRAW_MIN_MS  = Number(process.env.DRAW_MIN_MS || 1500);     // min time between draws per session
const MAX_PAYOUT   = Number(process.env.MAX_PAYOUT || 100_000);   // per claim cap (minor units)
const BANK_CAP     = Number(process.env.BANK_CAP || 5_000_000);   // max server bank per session
const PAYOUT_COOLDOWN_MS = Number(process.env.PAYOUT_COOLDOWN_MS || SIX_HOURS_MS); // per address cooldown
const HCAPTCHA_SECRET   = process.env.HCAPTCHA_SECRET;  // REQUIRED
const HCAPTCHA_HOSTNAME = process.env.HCAPTCHA_HOSTNAME || '';    // optional hardening
const tablesByGame = {
  poker:      { stats: 'user_stats',            points: 'season_points' },
  blackjack:  { stats: 'user_stats_blackjack',  points: 'season_points_blackjack' }
};



if (!HCAPTCHA_SECRET) console.error('⚠️ HCAPTCHA_SECRET is not set');

function getClientIp(req){
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = xf || req.socket?.remoteAddress || req.ip || 'unknown';
  return raw === '::1' ? '127.0.0.1' : raw;
}

// =================== Security headers ===================
app.use(helmet()); // sets a bunch of safe defaults (noSniff, hsts, hidePoweredBy, etc.)

// Match your explicit policies:
app.use(helmet.referrerPolicy({ policy: 'no-referrer' }));

// X-Frame-Options for old browsers (CSP frame-ancestors is the modern control)
app.use(helmet.frameguard({ action: 'deny' })); // deny being embedded anywhere

// Content Security Policy (keeps your inline scripts + hCaptcha working)
app.use(
  helmet.contentSecurityPolicy({
    useDefaults: false, // we’ll be explicit
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://hcaptcha.com", "https://*.hcaptcha.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      frameSrc: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"], // don’t allow others to iframe your site
     upgradeInsecureRequests: []  
    },
  })
);
// =================== Logging ===================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'faucet.log' })
  ]
});

app.get('/healthz', async (_req,res)=>{
  let dbOk = hasDb ? 'ok' : 'disabled';
  if (hasDb) {
    try { await pool.query('select 1'); } catch { dbOk = 'down'; }
  }
  res.json({ ok:true, ts:new Date().toISOString(), db: dbOk });
});

app.use((req, _res, next) => {
  logger.info('Incoming request', { method: req.method, url: req.url, ip: req.ip, ua: req.headers['user-agent'] || '' });
  next();
});

// --- UID COOKIE (used by getOrCreateUser/saveAfterDraw) ---
app.use((req, res, next) => {
  let uid = req.cookies?.uid;
  if (!uid) {
    uid = randomUUID();
    res.cookie('uid', uid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
  }
  req.uid = uid;
  next();
});
app.get('/api/version', (_req,res)=> {
  res.json({ ok:true, commit: process.env.GIT_COMMIT || null, build: process.env.BUILD_ID || null });
});



// =================== Hand/IP limiting ===================

const HANDS_WINDOW_MS  = SIX_HOURS_MS;
const TOKENS_PER_CREDIT = Number(process.env.TOKENS_PER_CREDIT || 1); // tokens per 1 credit
const HANDS_LIMIT = Math.max(1, Number(process.env.IP_HANDS_PER_6H)) || 40;
const HANDS_LIMIT_POKER = Number(process.env.IP_HANDS_PER_6H_POKER || HANDS_LIMIT);
const HANDS_LIMIT_BJ    = Number(process.env.IP_HANDS_PER_6H_BJ    || HANDS_LIMIT);
const WINDOW_MS   = 6 * 60 * 60 * 1000;
const handsByIp   = new Map();


setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of handsByIp) {
    if (now - record.windowStart >= SIX_HOURS_MS) handsByIp.delete(ip);
  }
}, 6 * 60 * 1000);

app.get('/api/profile', async (req, res) => {
  try {
    ensureBank(req);

    // Avoid any caching of this endpoint
    res.set('Cache-Control', 'no-store');

    const [userOk, statsOk] = await Promise.allSettled([
      getOrCreateUser(req.uid),
      loadStats(req.uid)
    ]);
    const s = statsOk.status === 'fulfilled' ? statsOk.value : null;
   const displayId = await ensureDisplayId(req.uid);
    const balPoker = Math.max(0, Number(req.session.wallet?.poker || 0));
    const balBJ    = Math.max(0, Number(req.session.wallet?.blackjack || 0));
    const total    = Math.min(BANK_CAP, balPoker + balBJ);
      req.session.bank = total; // keep session total canonical

    let poker=null, bj=null;
    try {
      await getOrCreateUser(req.uid);
      [poker, bj] = await Promise.all([loadStatsFor(req.uid,'poker'), loadStatsFor(req.uid,'blackjack')]);
    } catch {}
    return res.json({
      ok: true,
      displayId,
      bank: total,
      balances: { poker: balPoker, blackjack: balBJ, total },
      stats: {
        poker: {
          wins: poker?.wins || 0,
          royalFlushes: poker?.royal_flushes || 0,
          achievements: {
            firstWin:   !!poker?.first_win,
            w10:        !!poker?.w10,
            w25:        !!poker?.w25,
            w50:        !!poker?.w50,
            royalFlush: !!poker?.royal_win
          }
        },
        blackjack: {
  wins: bj?.wins || 0,
  achievements: {
    firstWin:  !!bj?.first_win,
    w10:       !!bj?.w10,
    w25:       !!bj?.w25,
    w50:       !!bj?.w50,
    natural:   !!bj?.bj_natural,
    doubleWin: !!bj?.bj_double_win,
    splitWin:  !!bj?.bj_split_win
  }
}
}
           
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'profile_error' });
  }
});
// hash-stream PRNG (deterministic, verifiable)
const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');
const randHex = (n = 32) => randomBytes(n).toString('hex');
function* hashStream(seedHex) {
  let h = seedHex;
  for (;;) {
    h = sha256hex(h);
    // use first 8 hex chars as a 32-bit integer → [0,1)
    const u32 = parseInt(h.slice(0, 8), 16) >>> 0;
    yield u32 / 0xffffffff;
  }
}
function announceAndRefresh(d){
  const creditUnits  = Math.floor((d.credit || 0) / 100);
  const balanceUnits = Math.floor((d.sessionBalance || 0) / 100);

  if (d.bonuses?.length) {
    const lines = d.bonuses
      .map(b => `• ${Math.floor((b.amount || 0) / 100)} KIBL — ${b.name}`)
      .join('<br>');
    toast(`<strong>Bonuses unlocked</strong><br>${lines}`, { type: 'bonus', timeout: 1500 });
  }
  if (creditUnits > 0) {
    toast(`You won <strong>${creditUnits}</strong> KIBL!`, { type: 'win', timeout: 1500 });
  }

  payoutEl.textContent = `Total Payout: ${balanceUnits} KIBL`;
  totalPayout = balanceUnits;
  payoutBtn.disabled = (totalPayout === 0);

  // Always refresh profile + leaderboard so numbers are current
  loadProfile();
  loadLeaderboard();
}
// Fisher–Yates with a provided random stream
function shuffleDeterministic(deck, rng) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const r = rng.next().value;                      // 0..1
    const j = Math.floor(r * (i + 1));              // 0..i
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
app.get('/api/leaderboard', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const game  = (req.query.game === 'blackjack') ? 'blackjack' : 'poker';
    const table = tablesByGame[game].points;
     
    const p   = await db();
    const sid = await getCurrentSeasonId();
    if (!sid) return res.json({ ok: true, game, entries: [] });

    const { rows } = await p.query(
      `select sp.user_id,
              sp.points_total,
              coalesce(u.display_id,
                       'PUP-'||upper(left(sp.user_id::text,4))||'…'||upper(right(sp.user_id::text,4))) as tag
         from ${table} sp
         left join users u on u.user_id = sp.user_id
        where sp.season_id = $1
        order by sp.points_total desc, sp.last_update asc
        limit 20`,
      [sid]
    );

    const entries = rows.map((r, i) => ({
      rank: i + 1,
      user: r.tag,
      points: Number(r.points_total || 0)
    }));

    return res.json({ ok: true, game, entries });
  } catch (e) {
    logger.error('leaderboard error', { e: String(e) });
    return res.status(500).json({ ok: false, error: 'leaderboard_error' });
  }
});

// =================== Draw + Daily reward (server-authoritative) ===================
const RANKS = ['Ace','2','3','4','5','6','7','8','9','10','Jack','Queen','King'];
const SUITS = ['Clubs','Diamonds','Hearts','Spades'];
const RANK_VALUE = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'Jack':11,'Queen':12,'King':13,'Ace':14 };

async function getOrCreateUser(uid) {
  if (!hasDb) return;
  const p = await db();
  await p.query('BEGIN');
  try {
    await p.query('INSERT INTO users(user_id) VALUES($1) ON CONFLICT DO NOTHING', [uid]);
    await p.query('INSERT INTO user_stats(user_id) VALUES($1) ON CONFLICT DO NOTHING', [uid]);
    await p.query('INSERT INTO user_stats_blackjack(user_id) VALUES($1) ON CONFLICT DO NOTHING', [uid]);
    await p.query('COMMIT');
  } catch (e) {
    await p.query('ROLLBACK');
    throw e;
  }
}
app.use(async (req, _res, next) => {
  try { await getOrCreateUser(req.uid); } catch {}
  next();
});

async function loadStatsFor(uid, game) {
  if (!hasDb) return null;
  const { stats } = tablesByGame[game];
  const p = await db();
  const { rows } = await p.query(`select * from ${stats} where user_id = $1`, [uid]);
  return rows[0] || null;
}

async function saveStatsFor(uid, game, { creditMinor, isWin, isRoyal, flags }) {
  if (!hasDb) return;
  const { stats } = tablesByGame[game];
  const p = await db();
  const sets = ['bank_minor = LEAST(bank_minor + $2, $3)'];
  const vals = [uid, creditMinor, Number(process.env.BANK_CAP || 2_000_000)];
  if (isWin)   sets.push('wins = wins + 1');
  if (isRoyal) sets.push('royal_flushes = royal_flushes + 1'); // harmless for BJ (stays 0)
  for (const f of (flags || [])) sets.push(`${f} = true`);
  await p.query(`update ${stats} set ${sets.join(', ')}, last_seen_at = now() where user_id = $1`, vals);
}

async function awardSeasonPointsFor(uid, game, points) {
  if (!hasDb || !points) return;
  const { points: table } = tablesByGame[game];
  const p = await db();
  const sid = await getCurrentSeasonId();
  if (!sid) return;
  await p.query('begin');
  try {
    await p.query(`insert into ${table}(season_id,user_id,points_total) values($1,$2,0) on conflict do nothing`, [sid, uid]);
    await p.query(`update ${table} set points_total=points_total+$3, last_update=now() where season_id=$1 and user_id=$2`, [sid, uid, points]);
    await p.query('commit');
  } catch (e) {
    await p.query('rollback');
  }
}

async function loadStats(uid){
  if (!hasDb) return null;
  const p = await db();
  const { rows } = await p.query('select * from user_stats where user_id=$1', [uid]);
  return rows[0] || null;
}

async function saveAfterDraw(uid, { creditMinor, isWin, isRoyal, flags }){
  if (!hasDb) return;
  const p = await db();
  const sets = ['bank_minor = LEAST(bank_minor + $2, $3)'];
  const vals = [uid, creditMinor, Number(process.env.BANK_CAP||2000000)];
  if (isWin) sets.push('wins = wins + 1');
  if (isRoyal) sets.push('royal_flushes = royal_flushes + 1');
  for (const f of flags||[]) sets.push(`${f} = true`);
  await p.query(`update user_stats set ${sets.join(', ')}, last_seen_at=now() where user_id=$1`, vals);
}

async function ensureDisplayId(uid){
  const left  = String(uid).slice(0,4).toUpperCase();
  const right = String(uid).slice(-4).toUpperCase();
  const display = `PUP-${left}…${right}`;
  if (!hasDb) return display;
  const p = await db();
  await p.query(
    `UPDATE users
       SET display_id = COALESCE(display_id, $2),
           last_seen_at = now()
     WHERE user_id = $1`,
    [uid, display]
  );
  return display;
}

async function getCurrentSeasonId(){
  if (!hasDb) return null;
  const p = await db();
  const { rows } = await p.query(
    `select season_id from seasons
      where status='active' and now() between start_at and end_at
      order by start_at desc limit 1`
  );
  return rows[0]?.season_id ?? null;
}

async function awardSeasonPoints(uid, points){
  if (!hasDb || !points) return;
  const p = await db();
  const sid = await getCurrentSeasonId();
  if (!sid) return;
  await p.query('begin');
  try {
    await p.query('insert into season_points(season_id,user_id,points_total) values($1,$2,0) on conflict do nothing', [sid, uid]);
    await p.query('update season_points set points_total=points_total+$3, last_update=now() where season_id=$1 and user_id=$2', [sid, uid, points]);
    await p.query('commit');
  } catch(e){ await p.query('rollback'); }
}


// In server.js, extend ensureBank()
function ensureBank(req) {
  if (!req.session.bank) req.session.bank = 0;
  if (!req.session.bank && req.session.bank !== 0) req.session.bank = 0;
  if (!req.session.wallet) req.session.wallet = { poker: 0, blackjack: 0 };
  if (!req.session.stats) req.session.stats = { wins: 0, royalFlushes: 0 };
  if (!req.session.achievements) req.session.achievements = {};
  if (!req.session.lastDailyRewardAt) req.session.lastDailyRewardAt = 0;
  if (!req.session.lastDrawAt) req.session.lastDrawAt = 0;
  if (!req.session.deck) req.session.deck = [];
  if (typeof req.session.hasDrawn !== 'boolean') req.session.hasDrawn = false;
  if (!req.session.round) {
  req.session.round = null; // { handId, commit, serverSeed, clientSeed }
      }
  if (!req.session.currentHand) req.session.currentHand = null;
}

function evalHand(hand) {
  const sorted = hand.slice().sort((a,b)=>RANK_VALUE[a.rank]-RANK_VALUE[b.rank]);
  const flush  = hand.every(c=>c.suit===hand[0].suit);
  let straight = sorted.every((c,i)=> i===0 || RANK_VALUE[c.rank]===RANK_VALUE[sorted[i-1].rank]+1);
  const values = sorted.map(c=>RANK_VALUE[c.rank]);
  if (!straight && values.join(',')==='2,3,4,5,14') straight = true; // wheel
  const royal = flush && straight && sorted[0].rank==='10' && sorted[4].rank==='Ace';
  const counts = Object.values(hand.reduce((m,c)=> (m[c.rank]=(m[c.rank]||0)+1, m), {})).sort((a,b)=>b-a);

  let payout = 0;
  if (royal) payout = 250;
  else if (straight && flush) payout = 50;
  else if (counts[0]===4) payout = 25;
  else if (counts[0]===3 && counts[1]===2) payout = 9;
  else if (flush) payout = 6;
  else if (straight) payout = 4;
  else if (counts[0]===3) payout = 3;
  else if (counts[0]===2 && counts[1]===2) payout = 2;
  else if (counts[0]===2) {
    const pairs = Object.entries(hand.reduce((m,c)=> (m[c.rank]=(m[c.rank]||0)+1, m), {})).filter(([,c])=>c===2).map(([r])=>r);
    if (pairs.some(r=>['Jack','Queen','King','Ace'].includes(r))) payout = 1;
  }
  return { payout, isWin: payout>0, isRoyal: royal };
}
function gateStartHand(req, game = 'poker'){
  const ip = getClientIp(req);
  const now = Date.now();

  let rec = handsByIp.get(ip);
  if (!rec || (now - rec.windowStart) >= WINDOW_MS) {
    rec = { windowStart: now, counts: { poker:0, blackjack:0 } };
  }

  const limit = (game === 'blackjack') ? HANDS_LIMIT_BJ : HANDS_LIMIT_POKER;
  const used  = rec.counts[game] || 0;

  if (used >= limit) {
    const retryMs = Math.max(0, WINDOW_MS - (now - rec.windowStart));
    return { ok:false, error:'ip_limit', retryMs, limit };
  }

  rec.counts[game] = used + 1;
  handsByIp.set(ip, rec);

  return { ok:true, remaining: Math.max(0, limit - rec.counts[game]), windowMs: WINDOW_MS };
}

const drawLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const dealLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

app.post('/api/start-hand', async (req, res) => {
  try {
    const g = gateStartHand(req, 'poker');
    if (!g.ok) return res.status(403).json(g);

    ensureBank(req);

    // optional client seed from body (hex string or any string)
    const clientSeed = (req.body && typeof req.body.clientSeed === 'string')
      ? req.body.clientSeed.trim()
      : '';

    const handId     = randomUUID();
    const serverSeed = randHex(32);            // 32 bytes → 64 hex
    const commitHash = sha256hex(serverSeed);  // publish now, reveal later

    // stash round in session
    req.session.round = {
      handId,
      commit: commitHash,
      serverSeed,
      clientSeed,
      revealed: false
    };
    req.session.hasDrawn = false;

    // best-effort audit trail; do not fail the request on DB hiccup
    if (hasDb) {
    try {
      const p = await db();
      await getOrCreateUser(req.uid);
      await ensureDisplayId(req.uid); // make sure display_id exists once
      await p.query(
        `INSERT INTO fair_rounds(hand_id, user_id, commit_hash, client_seed)
         VALUES ($1,$2,$3,$4)`,
        [handId, req.uid, commitHash, clientSeed || null]
      );
    } catch (e) {
      logger.error('fair_rounds insert', { e: String(e) });
    }
  }
    // return the gate info + fair commit
    return res.json({
      ok:true,
      g,               // { ok:true, remaining, windowMs, ... }
      handId,
      commit: commitHash
    });

  } catch (e) {
    console.error('start-hand error', e);
    return res.status(500).json({ ok:false, error:'start_hand_error' });
  }
});

// Deterministic /api/deal using your "2_of_Clubs.png" naming
app.post('/api/deal', dealLimiter, (req, res) => {
  // keep your IP gate behavior
  const ip = getClientIp(req);
  const rec = handsByIp.get(ip);
  if (!rec) return res.status(429).json({ ok:false, error:'use_start_hand_first' });

  ensureBank(req);

  const round = req.session.round;
  if (!round || !round.handId || !round.serverSeed) {
    return res.status(400).json({ ok:false, error:'use_start_hand_first' });
  }

  // === deterministic seed everyone can reproduce ===
  // IMPORTANT: any change to this string or deck build order affects verification.
  const seedString = `${round.serverSeed}:${round.clientSeed || ''}:${round.handId}:deal`;
  const rng = hashStream(sha256hex(seedString)); // helpers you added earlier

  // === build canonical unshuffled deck (Suits outer, Ranks inner) ===
  const deck0 = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck0.push({
        rank: r,
        suit: s,
        filename: `${r}_of_${s}.png`,   // <- "2_of_Clubs.png", "Jack_of_Spades.png"
        displayText: `${r} of ${s}`
      });
    }
  }
  // === deterministic shuffle → first 5 are the hand ===
  const deck = shuffleDeterministic(deck0, rng); // helper from earlier patch
  const hand = deck.slice(0, 5);
  // persist remaining deck for draw() to pull replacements from (also deterministic)
  req.session.deck = deck.slice(5);
  req.session.currentHand = hand;
  req.session.hasDrawn = false;
  // include fair commit bits so UI can show “Commit …”
  return res.json({
    ok: true,
    hand,
    fair: { handId: round.handId, commit: round.commit }
  });
});

app.post('/api/draw', drawLimiter, async (req, res) => {
  try {
    const ip = getClientIp(req);
    ensureBank(req); // make sure req.session.bank is a finite number

    // throttle per session (handle first-draw case)
    const now = Date.now();
    const lastDrawAt = Number(req.session.lastDrawAt) || 0;
    if (now - lastDrawAt < DRAW_MIN_MS) {
      return res.status(429).json({ ok: false, error: 'too_fast' });
    }

    // Require a started hand (paired with /api/start-hand)
    const rec = handsByIp.get(ip);
    if (!rec) {
      return res.status(429).json({ ok: false, error: 'use_start_hand_first' });
    }

    // Validate payload & draw state
    const { held } = req.body || {};
    if (!Array.isArray(held) || held.length !== 5) {
      return res.status(400).json({ ok: false, error: 'bad_hold_array' });
    }
    if (!req.session.currentHand || !Array.isArray(req.session.deck)) {
      return res.status(400).json({ ok: false, error: 'deal_first' });
    }
    if (req.session.hasDrawn) {
      return res.status(429).json({ ok: false, error: 'already_drawn' });
    }

    // ---- Perform draw: replace only non-held cards ----
    let hand = req.session.currentHand.slice();
    let deck = req.session.deck.slice();
        for (let i = 0; i < 5; i++) {
         if (!held[i]) {
          if (deck.length === 0) {
          // should never happen with single-draw flow; guard just in case
          return res.status(500).json({ ok: false, error: 'deck_underflow' });
        }
        hand[i] = deck.shift();
      }
    }

    // Evaluate hand
    const result = evalHand(hand);
    const isWin   = (typeof result.isWin   === 'boolean') ? result.isWin   : (result.payout > 0);
    const isRoyal = (typeof result.isRoyal === 'boolean') ? result.isRoyal : !!result.royal;

    // ---------- CREDIT & ACHIEVEMENTS (minor units) ----------
    const toInt  = (v) => Math.floor(Number(v) || 0);
    const clamp0 = (v) => Math.max(0, toInt(v));

    // 1 credit => N KIBL; BANK_CAP must be MINOR units (KIBL*100)
    const TOKENS_PER_CREDIT = toInt(process.env.TOKENS_PER_CREDIT || 1);
    const BANK_LIMIT = toInt(process.env.BANK_CAP ?? BANK_CAP);

    // base credit from paytable (credits → KIBL → minor units)
    let credit = clamp0((result.payout || 0) * TOKENS_PER_CREDIT * 100);

    // ensure session structures exist
    req.session.stats        ||= { wins: 0, royalFlushes: 0 };
    req.session.achievements ||= {};
    const A = req.session.achievements;

    const bonuses      = [];   // [{ name, amount (minor) }]
    const achFlags     = [];   // e.g., ['first_win', ...]
    const pointsEarned = clamp0(result.payout || 0); // leaderboard points in "credits"

    function addBonus(name, kibls, flag) {
      const amountMinor = clamp0(kibls * 100);
      if (amountMinor <= 0) return;
      bonuses.push({ name, amount: amountMinor });
      credit += amountMinor;
      if (flag) achFlags.push(flag);
    }

    // update stats
    if (isWin)   req.session.stats.wins++;
    if (isRoyal) req.session.stats.royalFlushes++;

    // achievements (values below are in KIBL; converted in addBonus)
    if (isWin && !A.firstWin)                           { addBonus('firstWin', 100,    'first_win'); A.firstWin = true; }
    if (req.session.stats.wins >= 10 && !A['10Wins'])   { addBonus('10Wins',  1000,    'w10');       A['10Wins'] = true; }
    if (req.session.stats.wins >= 25 && !A['25Wins'])   { addBonus('25Wins',  2500,    'w25');       A['25Wins'] = true; }
    if (req.session.stats.wins >= 50 && !A['50Wins'])   { addBonus('50Wins',  5000,    'w50');       A['50Wins'] = true; }
    if (isRoyal && !A.royalFlush)                       { addBonus('royalFlush', 50000,'royal_win'); A.royalFlush = true; }

    // apply to session (minor units) + finalize round
    const cap = BANK_LIMIT > 0 ? BANK_LIMIT : Number.MAX_SAFE_INTEGER;
 req.session.wallet.poker = Math.max(0, toInt(req.session.wallet.poker) + credit);
 req.session.bank = Math.min(
   cap,
   toInt(req.session.wallet.poker) + toInt(req.session.wallet.blackjack)
 );
    req.session.currentHand  = null;
    req.session.deck         = [];
    req.session.hasDrawn     = true;
    req.session.lastDrawAt   = now; // set last draw time once the draw succeeds

 // persist to DB (only to existing tables/columns)
 await getOrCreateUser(req.uid);
 await saveAfterDraw(req.uid, { creditMinor: credit, isWin, isRoyal, flags: achFlags });
 if (typeof awardSeasonPoints === 'function') {
   await awardSeasonPoints(req.uid, pointsEarned);
 }

    // persist session before replying
    await new Promise((resolve, reject) => {
      if (typeof req.session.save === 'function') {
        req.session.save(err => (err ? reject(err) : resolve()));
      } else {
        resolve();
      }
    });
      const round = req.session.round;
let fair = null;

if (round && !round.revealed) {
  fair = {
    handId: round.handId,
    commit: round.commit,
    serverSeed: round.serverSeed,
    clientSeed: round.clientSeed || null,
    algo: "FY shuffle with hash-stream; seed = sha256(serverSeed:clientSeed:handId:deal)"
  };
  req.session.round.revealed = true;

  // best-effort DB reveal
 if (hasDb) {
  try {
    const p = await db();
    await p.query(
      `UPDATE fair_rounds
          SET server_seed = $2, revealed_at = now()
        WHERE hand_id = $1`,
      [round.handId, round.serverSeed]
    );
  } catch (e) { logger.error('fair_rounds reveal', { e: String(e) }); }
}
}


    // respond (minor units; UI divides by 100)
    return res.json({
      ok: true,
      hand,
      result: { ...result, isWin, isRoyal },
      credit,                          // minor units
      bonuses,                         // [{ name, amount (minor) }]
      sessionBalance: req.session.bank,// minor units
      stats: req.session.stats,
      points: pointsEarned,
      fair
    });
  } catch (err) {
    console.error('draw error', err);
    return res.status(500).json({ ok: false, error: 'draw_error' });
  }
});

app.get('/api/fair/:handId', async (req, res) => {
  if (!hasDb) return res.status(503).json({ ok:false, error:'fair_archive_unavailable' });
  try {
    const p = await db();
    const { rows } = await p.query(
      `SELECT hand_id, commit_hash, server_seed, client_seed, created_at, revealed_at
         FROM fair_rounds WHERE hand_id = $1`, [req.params.handId]
    );
    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });
    const r = rows[0];
    return res.json({
      ok: true,
      handId: r.hand_id,
      commit: r.commit_hash,
      serverSeed: r.server_seed || null,
      clientSeed: r.client_seed || null,
      createdAt: r.created_at,
      revealedAt: r.revealed_at,
      algo: "deck=shuffleDeterministic(FY, rng=hashStream(sha256(serverSeed:clientSeed:handId:deal)))"
    });
  } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
});

const rewardLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });
// DAILY REWARD (minor units throughout)
app.post('/api/daily-reward', rewardLimiter, async (req, res) => {
  try {
    ensureBank(req); // guarantees req.session.bank is a finite number

    const now     = Date.now();
    const last    = Number(req.session.lastDailyRewardAt) || 0;
    const elapsed = now - last;

    if (elapsed < ONE_DAY_MS) {
      return res.status(429).json({
        ok: false,
        error: 'already_claimed',
        retryInMs: ONE_DAY_MS - elapsed,
        nextClaimAt: last + ONE_DAY_MS
      });
    }

    // award in MINOR units; front-end divides by 100 when displaying KIBL
    const DAILY_REWARD = 100 * 100; // 100 KIBL → minor units

    req.session.wallet ||= { poker: 0, blackjack: 0 };
    req.session.wallet.poker = Math.max(0, Number(req.session.wallet.poker || 0) + DAILY_REWARD);

    const cap = Number(process.env.BANK_CAP ?? BANK_CAP ?? 5_000_000);
    req.session.bank = Math.min(
    cap,
     Number(req.session.wallet.poker || 0) + Number(req.session.wallet.blackjack || 0)
      );

req.session.lastDailyRewardAt = now;

    // Mirror to DB (cap-safe); do NOT fail the request if DB write has an issue
    try {
      await getOrCreateUser(req.uid);
      const p = await db();
      const cap = Number(process.env.BANK_CAP ?? process.env.BANK_CAP ?? BANK_CAP ?? 5_000_000);
      await p.query(
        'UPDATE user_stats SET bank_minor = LEAST(bank_minor + $2, $3), last_seen_at = now() WHERE user_id = $1',
        [req.uid, DAILY_REWARD, cap]
      );
    } catch (e) {
      logger.error('db bank increment failed on daily', { e: String(e) });
      // continue; session already updated so user still gets reward
    }

    // Persist session before replying
    await new Promise((resolve, reject) => {
      if (typeof req.session.save === 'function') {
        req.session.save(err => (err ? reject(err) : resolve()));
      } else {
        resolve();
      }
    });

    return res.json({
      ok: true,
      credit: DAILY_REWARD,              // minor units
      sessionBalance: req.session.bank,  // minor units
      nextClaimAt: now + ONE_DAY_MS
    });

  } catch (err) {
    // don’t leak internals
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// =================== Payout (minor units throughout) ===================
const usedCaptchaTokens   = new Set();                  // replay defense
setInterval(() => usedCaptchaTokens.clear(), 5 * 60 * 1000);

const lastPayoutByAddress = new Map();                  // per-address cooldown

function looksLikeNexaAddress(addr = '') {
  if (typeof addr !== 'string') return false;
  if (!addr.startsWith('nexa:')) return false;
  if (addr.length > 120) return false;
  return /^[a-z0-9:]+$/i.test(addr);
}

const payoutLimiter = rateLimit({
  windowMs: SIX_HOURS_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/payout', payoutLimiter);

app.post('/api/payout', async (req, res) => {
  try {
    ensureBank(req);

    // ----- which wallet(s) to pay from? default = both -----
    const game = (req.body?.game || 'all').toString().toLowerCase(); // 'poker' | 'blackjack' | 'all'
    const pokerMinor = Math.max(0, Number(req.session.wallet?.poker || 0));
    const bjMinor    = Math.max(0, Number(req.session.wallet?.blackjack || 0));
    const availableMinor =
      game === 'poker'     ? pokerMinor :
      game === 'blackjack' ? bjMinor    :
      (pokerMinor + bjMinor);

    const {
      playerAddress,
      'h-captcha-response': hcapStd,
      hcaptchaToken: hcapCustom,
    } = req.body || {};

    const captchaToken = hcapCustom || hcapStd;
    if (!captchaToken) return res.status(400).json({ error: 'Please complete the hCaptcha challenge!' });
    if (usedCaptchaTokens.has(captchaToken)) return res.status(400).json({ error: 'captcha_replay' });
    usedCaptchaTokens.add(captchaToken);

    // verify hCaptcha (with retries)
    let captchaResponse;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        captchaResponse = await hcaptcha.verify(process.env.HCAPTCHA_SECRET, captchaToken, req.ip);
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    if (!captchaResponse?.success) {
      return res.status(400).json({ error: 'hCaptcha verification failed', detail: captchaResponse?.['error-codes'] || null });
    }

    if (!availableMinor) return res.status(400).json({ error: 'No balance to withdraw' });
    if (!looksLikeNexaAddress(playerAddress)) return res.status(400).json({ error: 'Invalid Nexa address' });

    // per-address cooldown
    const lastAt = lastPayoutByAddress.get(playerAddress) || 0;
    if (Date.now() - lastAt < PAYOUT_COOLDOWN_MS) {
      const wait = PAYOUT_COOLDOWN_MS - (Date.now() - lastAt);
      return res.status(429).json({ error: 'address_cooldown', retryInMs: wait });
    }

    // compute send amount (minor units)
    const sendMinor = Math.min(availableMinor, MAX_PAYOUT);
    const sendWholeKibl = Math.floor(sendMinor / 100);

    // breakdown deduction by wallet
    let deductPoker = 0, deductBJ = 0;
    if (game === 'poker') {
      deductPoker = sendMinor;
    } else if (game === 'blackjack') {
      deductBJ = sendMinor;
    } else {
      // take from poker first, then blackjack
      deductPoker = Math.min(pokerMinor, sendMinor);
      deductBJ = sendMinor - deductPoker;
    }

    // RPC config
    const rpcUrl = process.env.RPC_URL || `http://localhost:${process.env.RPC_PORT || 7227}`;
    if (!process.env.RPC_USER || !process.env.RPC_PASSWORD || !process.env.KIBL_GROUP_ID) {
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const auth = Buffer.from(`${process.env.RPC_USER}:${process.env.RPC_PASSWORD}`).toString('base64');
    const rpcBody = JSON.stringify({
      jsonrpc: '1.0',
      id: 'kibl',
      method: 'token',
      params: ['send', process.env.KIBL_GROUP_ID, playerAddress, String(sendMinor)]
    });

    // RPC send with retry
    let txId = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(rpcUrl, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Basic ${auth}` }, body: rpcBody });
        const data = await response.json().catch(async () => { throw new Error(`RPC ${response.status} ${await response.text()}`); });
        if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
        txId = data.result;
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    // post-send bookkeeping
    req.session.wallet.poker     = Math.max(0, pokerMinor - deductPoker);
    req.session.wallet.blackjack = Math.max(0, bjMinor    - deductBJ);
    req.session.bank = Math.max(0, Number(req.session.wallet.poker || 0) + Number(req.session.wallet.blackjack || 0));

    lastPayoutByAddress.set(playerAddress, Date.now());

    // persist session
    await new Promise((resolve, reject) => {
      if (typeof req.session.save === 'function') req.session.save(err => (err ? reject(err) : resolve()));
      else resolve();
    });

    // DB audit (best-effort)
    try {
      const p = await db();
      await p.query(
        `INSERT INTO payouts(address, amount_kibl, tx_id, session_id, ip, status)
         VALUES ($1,$2,$3,$4,$5,'success')`,
        [playerAddress, sendWholeKibl, txId, req.sessionID, req.ip]
      );
      // decrement both game balances to mirror session
      if (deductPoker > 0) {
        await p.query(
          'UPDATE user_stats SET bank_minor = GREATEST(bank_minor - $2, 0), last_seen_at = now() WHERE user_id = $1',
          [req.uid, deductPoker]
        );
      }
      if (deductBJ > 0) {
        await p.query(
          'UPDATE user_stats_blackjack SET bank_minor = GREATEST(bank_minor - $2, 0), last_seen_at = now() WHERE user_id = $1',
          [req.uid, deductBJ]
        );
      }
    } catch (e) {
      logger.error('payout bookkeeping failed', { e: String(e) });
      // don’t fail the request; tokens are already sent
    }

    const remainingKibl = Math.floor((req.session.bank || 0) / 100);
    return res.json({
      success: true,
      txId,
      sentKIBL: sendWholeKibl,
      remainingKIBL: remainingKibl,
      remainingByGame: {
        poker:     Math.floor((req.session.wallet?.poker || 0) / 100),
        blackjack: Math.floor((req.session.wallet?.blackjack || 0) / 100),
        total:     remainingKibl
      },
      message: `Sent ${sendWholeKibl} KIBL to ${playerAddress}`
    });

  } catch (error) {
    logger.error('Token send failed', { error: String(error) });
    return res.status(500).json({ error: 'Failed to send tokens due to a server issue. Please try again later.' });
  }
});

// =================== BLACKJACK ENGINE (non-wagering, points-driven) ===================
// ---- Blackjack achievements (KIBL amounts) ----
const BJ_FIRST_WIN_KIBL   = Number(process.env.BJ_FIRST_WIN_KIBL   || 100);
const BJ_W10_KIBL         = Number(process.env.BJ_W10_KIBL         || 1000);
const BJ_W25_KIBL         = Number(process.env.BJ_W25_KIBL         || 2500);
const BJ_W50_KIBL         = Number(process.env.BJ_W50_KIBL         || 5000);
const BJ_NATURAL_KIBL     = Number(process.env.BJ_NATURAL_KIBL     || 1000);
const BJ_DOUBLE_WIN_KIBL  = Number(process.env.BJ_DOUBLE_WIN_KIBL  || 300);
const BJ_SPLIT_WIN_KIBL   = Number(process.env.BJ_SPLIT_WIN_KIBL   || 300);

function bjEnsure(req){
  ensureBank(req);
  req.session.bj ||= { round: null, lastActionAt: 0, wins: 0, achievements: {} };
}

function buildCanonicalDeck(){
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) {
    deck.push({ rank: r, suit: s, filename: `${r}_of_${s}.png`, displayText: `${r} of ${s}` });
  }
  return deck;
}
function scoreHand(cards){
  let t=0,a=0;
  for (const c of cards){
    const r=c.rank;
    t += (r==='Ace')? (a++,11) : (r==='King'||r==='Queen'||r==='Jack')?10 : Number(r);
  }
  while (t>21 && a>0){ t-=10; a--; }
  return { total:t, soft:a>0 };
}
function isBlackjack(cards){ return cards.length===2 && scoreHand(cards).total===21; }
function drawCard(round){ return round.deck[round.deckPos++]; }
function canSplit(cards){
  return (cards?.length===2) && (cards[0].rank===cards[1].rank);
}
// ===== BLACKJACK RULES (tweakable) =====
const ALLOW_DOUBLE_AFTER_SPLIT = false;     // common default: DAS off
const SPLIT_ACES_ONE_CARD_ONLY = true;      // common default: one card to each Ace, no hits
const NATURAL_BLACKJACK_ONLY = true;        // count BJ only on original 2-card hand (no split)
const DEALER_HITS_SOFT_17 = false;
function playDealer(round){
  while (true){
    const s = scoreHand(round.dealer);
    if (s.total < 17) round.dealer.push(drawCard(round));
    else if (s.total === 17 && s.soft && DEALER_HITS_SOFT_17) round.dealer.push(drawCard(round));
    else break;
  }
}
function snapshotPlayers(r){
  return r.players.map(p=>{
    const s = scoreHand(p.cards);
    return { cards:p.cards, total:s.total, soft:s.soft, doubled:p.doubled, splitFrom:p.splitFrom, result:p.result||null, locked: !!p.lockedAfterOne };
  });
}
function advanceOrSettle(r){
  // next unsettled player hand?
  const next = r.players.findIndex(ph => !ph.settled);
  if (next >= 0){ r.activeIndex = next; return; }

  // all player hands decided (or bust) → dealer resolves if at least one hand not bust
  if (r.players.some(ph => ph.result !== 'bust')) playDealer(r);

  // compare
  const d = scoreHand(r.dealer);
  for (const ph of r.players){
    if (ph.result==='bust'){ ph.settled=true; continue; }
    const pt = scoreHand(ph.cards).total;
    if (NATURAL_BLACKJACK_ONLY ? (isBlackjack(ph.cards) && !ph.splitFrom) : isBlackjack(ph.cards)) {
      ph.result = 'bj';
   } 
   else if (d.total>21) {
         ph.result='win';}
    else if (pt>d.total)       ph.result='win';
    else if (pt===d.total)     ph.result='push';
    else                       ph.result='loss';
    ph.settled=true;
  }
  r.settled = true;
}

// Points/KIBL policy for v1 (safe, non-wagering)
function settleAndRewardBJ(req, r){
  const toInt = v => Math.floor(Number(v)||0);
  const basePts = res => (res==='bj'?2 : res==='win'?1 : 0);

  let riskPenaltyDouble = 0;
  let pointsFloat = 0;
  const results = [];

  const anySplit = r.players.some(ph => ph.splitFrom);
  let splitLosses = 0;

  for (const ph of r.players){
    const base = basePts(ph.result);
    let handPts = base;

    if (ph.doubled){
      if (ph.result==='win' || ph.result==='bj') handPts = base * 2;
      else if (ph.result==='loss' || ph.result==='bust') riskPenaltyDouble += 1;
    }

    if (ph.splitFrom){
      handPts = handPts / 2;                         // each split hand half credit
      if (ph.result==='loss' || ph.result==='bust') splitLosses++;
    }

    results.push({ result: ph.result, basePoints: base, doubled: ph.doubled, splitFrom: ph.splitFrom, pointDelta: handPts });
    pointsFloat += handPts;
  }

  // Optional: if both split hands lost, add a -1 penalty
  let splitPenalty = 0;
  if (anySplit && splitLosses === r.players.length) splitPenalty = 1;

  let points = Math.max(0, Math.floor(pointsFloat) - riskPenaltyDouble - splitPenalty);

  const TOKENS_PER_CREDIT = toInt(process.env.TOKENS_PER_CREDIT || 1);
  const WIN_C = toInt(process.env.BJ_WIN_CREDITS || 3);
  const BJ_C  = toInt(process.env.BJ_BJ_CREDITS  || 6);
  const DD_B  = toInt(process.env.BJ_DOUBLE_BONUS|| 2);
  const SPLIT_PENALTY = toInt(process.env.BJ_SPLIT_WIN_PENALTY || 1);

  let credits = 0;
  for (const ph of r.players){
    if (ph.result === 'bj') {
      credits += BJ_C;                              // natural only (fixed above)
    } else if (ph.result === 'win') {
      let c = WIN_C + (ph.doubled ? DD_B : 0);      // reward risk on doubles
      if (ph.splitFrom) c = Math.max(1, c - SPLIT_PENALTY);
      credits += c;
    }
    // pushes/losses/busts → 0 credits+  
    }
  const creditMinor = toInt(credits * TOKENS_PER_CREDIT * 100);

  // Achievements/bonuses (reuse your poker flags if you want; none by default)
  const bonuses = [];
  return { points, creditMinor, bonuses, results };
}

// ---- Rate limits for BJ actions
const bjStartLimiter  = rateLimit({ windowMs: 60_000, max: 40, standardHeaders:true, legacyHeaders:false });
const bjActionLimiter = rateLimit({ windowMs: 60_000, max: 80, standardHeaders:true, legacyHeaders:false });
function setBJButtons({ deal, hit, stand } = {}) {
  const dealBtn  = document.getElementById('bjDealBtn');
  const hitBtn   = document.getElementById('bjHitBtn');
  const standBtn = document.getElementById('bjStandBtn');
  if (dealBtn  != null && deal  !== undefined) dealBtn.disabled  = !deal;
  if (hitBtn   != null && hit   !== undefined) hitBtn.disabled   = !hit;
  if (standBtn != null && stand !== undefined) standBtn.disabled = !stand;
}

async function postBJ(path, payload = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CSRF-Token': window.csrfToken || '' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    const code = json?.error || `HTTP ${res.status}`;
    throw new Error(code);
  }
  return json;
}

async function hit() {
  try {
    setBJButtons({ hit:false, stand:false });
    const data = await postBJ('/api/bj/hit');            // <-- define `data` here
    afterActionSnapshot(data);
  } catch (err) {
    // Treat already-settled as “ready to deal”
    if (err.message === 'hand_settled' || err.message === 'no_round') {
      setBJButtons({ deal:true, hit:false, stand:false });
    }
    toast(`Hit failed: ${err.message}`, { type: 'error' });
  }
}

async function stand() {
  try {
    setBJButtons({ hit:false, stand:false });
    const data = await postBJ('/api/bj/stand');          // <-- define `data` here
    afterActionSnapshot(data);
  } catch (err) {
    if (err.message === 'hand_settled' || err.message === 'no_round') {
      setBJButtons({ deal:true, hit:false, stand:false });
    }
    toast(`Stand failed: ${err.message}`, { type: 'error' });
  }
}

function afterActionSnapshot(data) {
  // ... update cards/totals ...
  if (data.settled) {
    setBJButtons({ deal:true, hit:false, stand:false });
    // optionally show a toast for winnings/bonuses here
  } else {
    setBJButtons({ deal:false, hit:true, stand:true });
  }
}


// ---- /api/bj/start
app.post('/api/bj/start', bjStartLimiter, async (req, res) => {
  try{
    const g = gateStartHand(req, "blackjack");                  // reuse IP gate
    if (!g.ok) return res.status(403).json(g);

    bjEnsure(req);

    const clientSeed = (req.body && typeof req.body.clientSeed === 'string') ? req.body.clientSeed.trim() : '';
    const handId     = randomUUID();
    const serverSeed = randHex(32);
    const commitHash = sha256hex(serverSeed);

    // fair_rounds insert (best-effort)
    if (hasDb){
    try{
      const p = await db();
      await getOrCreateUser(req.uid);
      await ensureDisplayId(req.uid);
      await p.query(
        `INSERT INTO fair_rounds(hand_id, user_id, commit_hash, client_seed)
         VALUES ($1,$2,$3,$4)`,
        [handId, req.uid, commitHash, clientSeed || null]
      );
    } catch(e){ logger.error('fair_rounds insert (bj)', { e:String(e) }); }
  }
    // deterministic deck
    const seedString = `${serverSeed}:${clientSeed}:${handId}:bj`;
    const rng  = hashStream(sha256hex(seedString));
    const deck = shuffleDeterministic(buildCanonicalDeck(), rng);

    const round = {
      handId, commit:commitHash, serverSeed, clientSeed, revealed:false,
      deck, deckPos:0,
      dealer: [], players: [{ cards:[], settled:false, result:null, doubled:false, splitFrom:false }],
      activeIndex: 0, settled:false
    };
    // deal P,D,P,D
    round.players[0].cards.push(drawCard(round));
    round.dealer.push(drawCard(round));
    round.players[0].cards.push(drawCard(round));
    round.dealer.push(drawCard(round));

    req.session.bj.round = round;
    const player = round.players[0];
if (isBlackjack(player.cards)) {
  player.result = 'bj';
  player.settled = true;
  advanceOrSettle(round); // will finish dealer if needed and set round.settled
}
    return res.json({
      ok:true,
      fair:{ handId, commit:commitHash },
      settled: round.settled,
      dealer:{ up: round.dealer[0], holeHidden:true },
      player: round.players[0].cards,
      can:{ hit:true, stand:true, double:true, split: canSplit(round.players[0].cards) }
    });
  } catch(e){
    logger.error('bj/start', { e:String(e) });
    return res.status(500).json({ ok:false, error:'bj_start_error' });
  }
});

// ---- /api/bj/hit
app.post('/api/bj/hit', bjActionLimiter, (req, res) => {
  try{
    bjEnsure(req);
     const r = req.session?.bj?.round;
    if (!r)            return res.status(400).json({ ok:false, error:'no_round' });
    if (r.settled) {
  return res.json({
    ok: true,
    dealer:{ up:r.dealer[0], hole:r.dealer[1], full:r.dealer },
    players: snapshotPlayers(r),
    activeIndex: r.activeIndex,
    settled: true
  });
}
    const h = r.players[r.activeIndex];
    if (!h || h.settled) return res.status(400).json({ ok:false, error:'hand_settled' });
     if (h.lockedAfterOne) return res.status(400).json({ ok:false, error:'cant_hit_split_aces' });
    h.cards.push(drawCard(r));
    if (scoreHand(h.cards).total > 21){ h.result='bust'; h.settled=true; }
    advanceOrSettle(r);

    return res.json({
      ok:true,
      dealer: r.settled ? { up:r.dealer[0], hole:r.dealer[1], full:r.dealer } : { up:r.dealer[0], holeHidden:true },
      players: snapshotPlayers(r),
      activeIndex: r.activeIndex,
      settled: r.settled
    });
  } catch(e){
    logger.error('bj/hit', { e:String(e) });
    return res.status(500).json({ ok:false, error:'bj_hit_error' });
  }
});

// ---- /api/bj/stand
app.post('/api/bj/stand', bjActionLimiter, async (req, res) => {
  try{
    bjEnsure(req);
    const r = req.session?.bj?.round;
    if (!r)        return res.status(400).json({ ok:false, error:'no_round' });
    if (r.settled) {
return res.json({
  ok: true,
  settled: true,                        // << add this
  dealer: { up: r.dealer[0], hole: r.dealer[1], full: r.dealer },
  players: snapshotPlayers(r),
  activeIndex: r.activeIndex,           // (optional, but consistent)
  results,
  credit: creditMinor + extraMinor,
  sessionBalance: req.session.bank,
  points,
  bonuses: [...bonuses, ...bjBonuses],
  fair
});
}

    // finish this hand
    r.players[r.activeIndex].settled = true;
    advanceOrSettle(r);

    if (!r.settled){
      return res.json({
        ok:true,
        dealer:{ up:r.dealer[0], holeHidden:true },
        players: snapshotPlayers(r),
        activeIndex: r.activeIndex,
        settled:false
      });
    }

    // fully settled → reward + reveal fairness
    const { points, creditMinor, bonuses, results } = settleAndRewardBJ(req, r);

      const toMinor = kibl => Math.max(0, Math.floor(Number(kibl || 0) * 100));
      let extraMinor = 0;
const bjBonuses = []; // [{ name, amount }]
const bjFlags   = []; // ['bj_first_win', 'bj_natural', ...]

const A = (req.session.bj.achievements ||= {});
const winsThisRound = results.filter(x => x.result === 'win' || x.result === 'bj').length;
if (winsThisRound > 0) req.session.bj.wins = (req.session.bj.wins || 0) + winsThisRound;

// helpers
function unlock(flag, name, kibl){
  if (!A[flag]) {
    A[flag] = true;
    const amt = toMinor(kibl);
    if (amt > 0) { extraMinor += amt; bjBonuses.push({ name, amount: amt }); }
    bjFlags.push(flag);
  }
}

// first win, streaks
if (winsThisRound > 0) {
  unlock('first_win',  'BJ First Win', BJ_FIRST_WIN_KIBL);
  if (req.session.bj.wins >= 10) unlock('w10',  'BJ 10 Wins',  BJ_W10_KIBL);
  if (req.session.bj.wins >= 25) unlock('w25',  'BJ 25 Wins',  BJ_W25_KIBL);
  if (req.session.bj.wins >= 50) unlock('w50',  'BJ 50 Wins',  BJ_W50_KIBL);
}
const natBjCount = results.filter(x => x.result === 'bj' && !x.splitFrom).length; 
// natural blackjack (original two-card 21) — note: result === 'bj' already implies “natural only”
if (results.some(x => x.result === 'bj' && !x.splitFrom)) {
  unlock('bj_natural', 'Natural Blackjack', BJ_NATURAL_KIBL);
}

// doubled win
if (results.some(x => (x.result === 'win' || x.result === 'bj') && x.doubled)) {
  unlock('bj_double_win', 'Double Win', BJ_DOUBLE_WIN_KIBL);
}

// split win
if (results.some(x => (x.result === 'win' || x.result === 'bj') && x.splitFrom)) {
  unlock('bj_split_win', 'Split Win', BJ_SPLIT_WIN_KIBL);
}
  // Now that extraMinor is final, deposit the whole round (base + bonuses)
  {
    const roundMinor = Math.max(0, (creditMinor || 0) + (extraMinor || 0));
    const cap = Math.floor(Number(process.env.BANK_CAP ?? 5_000_000));
    req.session.wallet.blackjack = Math.max(
      0,
      Math.floor(Number(req.session.wallet.blackjack || 0)) + roundMinor
    );
    req.session.bank = Math.min(
      cap,
      Math.floor(Number(req.session.wallet.poker || 0)) +
      Math.floor(Number(req.session.wallet.blackjack || 0))
    );
  }

  await getOrCreateUser(req.uid);
 const totalMinor = creditMinor + extraMinor;
 await saveStatsFor(req.uid, 'blackjack', {
   creditMinor: totalMinor,
   isWin: totalMinor > 0,
   isRoyal: false,
   flags: bjFlags
 });
 await awardSeasonPointsFor(req.uid, 'blackjack', points);
// also persist the natural blackjack counter
 if (natBjCount > 0 && hasDb) {
   try {
     const p = await db();
     await p.query(
       'update user_stats_blackjack set blackjacks = blackjacks + $2, last_seen_at = now() where user_id = $1',
       [req.uid, natBjCount]
     );
   } catch (e) { logger.error('bj blackjacks increment', { e: String(e) }); }
 }
  
    // reveal (best effort)
    let fair = null;
    if (!r.revealed){
      fair = { handId:r.handId, commit:r.commit, serverSeed:r.serverSeed, clientSeed:r.clientSeed||null,
               algo:"FY+hashStream sha256(serverSeed:clientSeed:handId:bj)" };
      r.revealed = true;
      try{
        const p = await db();
        await p.query(`UPDATE fair_rounds SET server_seed=$2, revealed_at=now() WHERE hand_id=$1`, [r.handId, r.serverSeed]);
      }catch(e){ logger.error('fair_rounds reveal (bj)', { e:String(e) }); }
    }

// response: include both base bonuses (if you choose to use them later) and bjBonuses
return res.json({
  ok:true,
  dealer:{ up:r.dealer[0], hole:r.dealer[1], full:r.dealer },
  players: snapshotPlayers(r),
  results,
  credit: creditMinor + extraMinor,
  sessionBalance: req.session.bank,
  points,
  bonuses: [...bonuses, ...bjBonuses],
  fair
});
  } catch(e){
    logger.error('bj/stand', { e:String(e) });
    return res.status(500).json({ ok:false, error:'bj_stand_error' });
  }
});

// ---- /api/bj/double (first decision only; draw 1, then hand settles)
app.post('/api/bj/double', bjActionLimiter, (req, res) => {
  try{
    bjEnsure(req);
    const r = req.session?.bj?.round;
    if (!r || r.settled) return res.status(400).json({ ok:false, error:'no_round' });

    const h = r.players[r.activeIndex];
    if (!h || h.settled || h.doubled || h.cards.length!==2) return res.status(400).json({ ok:false, error:'cant_double' });
    if (h.splitFrom && !ALLOW_DOUBLE_AFTER_SPLIT) return res.status(400).json({ ok:false, error:'cant_double_after_split' });
     if (h.lockedAfterOne) return res.status(400).json({ ok:false, error:'cant_double_split_aces' });
    const s = scoreHand(h.cards);
     if (s.total >= 21) return res.status(400).json({ ok:false, error:'cant_double_on_21' });
    h.doubled = true;
    h.cards.push(drawCard(r));
    if (scoreHand(h.cards).total > 21) { h.result='bust'; }
    h.settled = true;
    advanceOrSettle(r);

    return res.json({
      ok:true,
      dealer: r.settled ? { up:r.dealer[0], hole:r.dealer[1], full:r.dealer } : { up:r.dealer[0], holeHidden:true },
      players: snapshotPlayers(r),
      activeIndex: r.activeIndex,
      settled: r.settled
    });
  } catch(e){
    logger.error('bj/double', { e:String(e) });
    return res.status(500).json({ ok:false, error:'bj_double_error' });
  }
});

// ---- /api/bj/split (one split v1; exact pair)
app.post('/api/bj/split', bjActionLimiter, (req, res) => {
  try{
    bjEnsure(req);
    const r = req.session?.bj?.round;
    if (!r || r.settled) return res.status(400).json({ ok:false, error:'no_round' });

    const i = r.activeIndex;
    const h = r.players[i];
    if (!h || h.settled || h.cards.length!==2 || !canSplit(h.cards)) return res.status(400).json({ ok:false, error:'cant_split' });
    if (r.players.some(p=>p.splitFrom)) return res.status(400).json({ ok:false, error:'one_split_only' });

    const a = h.cards[0], b = h.cards[1];
    h.cards = [a]; h.splitFrom = true;
    const h2 = { cards:[b], settled:false, result:null, doubled:false, splitFrom:true };
    r.players.splice(i+1, 0, h2);

    // draw one to each
    h.cards.push(drawCard(r));
    h2.cards.push(drawCard(r));

    // Split Aces rule: one card to each, no further hits/doubles
    if (SPLIT_ACES_ONE_CARD_ONLY && a.rank === 'Ace' && b.rank === 'Ace') {
    h.lockedAfterOne = true;
    h2.lockedAfterOne = true;
    }

    return res.json({
      ok:true,
      dealer:{ up:r.dealer[0], holeHidden:true },
      players: snapshotPlayers(r),
      activeIndex: r.activeIndex,
      settled:false
    });
  } catch(e){
    logger.error('bj/split', { e:String(e) });
    return res.status(500).json({ ok:false, error:'bj_split_error' });
  }
});



// =================== Root ===================
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// ----- Errors (keep last) -----
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ ok: false, error: 'bad_csrf' });
  }
  // Optional: quick visibility while debugging
  console.error('Unhandled error:', err);
  return res.status(500).json({ ok: false, error: 'server_error' });
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
  console.log(`Server running at http://localhost:${port}`);
});

