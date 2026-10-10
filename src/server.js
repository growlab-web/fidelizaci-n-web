// Practik Fidelidad — servidor principal
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const config = require('./config');
const db = require('./db');
const img = require('./images');
const apple = require('./wallet/apple');
const google = require('./wallet/google');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
// En Vercel, /public lo sirve su CDN; en local lo sirve Express
const PUB = path.join(__dirname, '..', 'public');
const VIEWS = path.join(__dirname, '..', 'views');
app.use(express.static(PUB, { maxAge: '1h', index: false }));
// La pantalla del dueño (/admin) se construye con Astro en ./dist (npm run build); en Vercel la sirve la CDN
app.use(express.static(path.join(__dirname, '..', 'dist')));

// En Vercel la función se congela al responder: waitUntil la mantiene viva hasta terminar los envíos a Apple/Google
let waitUntil = (p) => p;
try { const vf = require('@vercel/functions'); waitUntil = (p) => { try { vf.waitUntil(p); } catch {} return p; }; } catch {}

// ---------- utilidades ----------
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para dictarlo sin errores
const newCode = () => Array.from(crypto.randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join('');
const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
};
const checkPin = (pin, stored) => {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
};
const cleanUser = (u) => String(u || '').trim().toLowerCase();
const validPassword = (p) => { const s = String(p || ''); return s.length >= 4 && s.length <= 64; };
const cleanPhone = (p) => String(p || '').replace(/[^\d+]/g, '');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const getBusiness = (slug) => db.one('SELECT * FROM businesses WHERE slug = $1', [slug]);
const getCard = (code) => db.one('SELECT * FROM cards WHERE code = $1', [String(code).toUpperCase()]);

const publicBusiness = (b) => ({
  slug: b.slug, name: b.name, color: b.color, text_color: b.text_color, stamps_goal: b.stamps_goal,
  reward: b.reward, terms: b.terms, address: b.address, whatsapp: b.whatsapp,
  logo: `${config.publicUrl}/img/logo/${b.slug}.png?v=${new Date(b.updated_at).getTime()}`,
  wallets: { apple: config.apple.enabled, google: config.google.enabled },
});
const publicCard = (c) => ({
  code: c.code, name: c.customer_name, phone: c.customer_phone, stamps: c.stamps, stamps_total: c.stamps_total,
  rewards_redeemed: c.rewards_redeemed, last_stamp_at: c.last_stamp_at, created_at: c.created_at,
  google_saved: c.google_saved,
});

// Empuja los cambios a Apple y Google sin hacer esperar al dueño
function syncWallets(b, card, notify) {
  waitUntil(Promise.allSettled([
    apple.notifyUpdate(card).catch((e) => console.error('[apple]', e.message)),
    google.updateCard(b, card, { notify }).catch((e) => console.error('[google]', e.message)),
  ]));
}

// ---------- páginas ----------
const page = (name) => (req, res) => res.sendFile(path.join(VIEWS, `${name}.html`));
app.get('/', page('home'));
app.get('/c/:slug', page('join'));
app.get('/t/:code', page('card'));
app.get('/admin/:slug', (req, res) => res.redirect('/admin')); // enlaces antiguos por negocio
app.get('/admin', (req, res) => res.status(503).send('Falta construir la pantalla del dueño: ejecuta "npm run build".'));
app.get('/panel', page('panel'));
app.get('/health', (req, res) => res.json({ ok: true, apple: config.apple.enabled, google: config.google.enabled }));

// ---------- imágenes ----------
app.get('/img/logo/:file', wrap(async (req, res) => {
  const b = await getBusiness(req.params.file.replace(/\.png$/, ''));
  if (!b) return res.sendStatus(404);
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(await img.logoSquare(b, 660));
}));
app.get('/img/stamps/:file', wrap(async (req, res) => {
  const card = await getCard(req.params.file.replace(/\.png$/, ''));
  if (!card) return res.sendStatus(404);
  const b = await db.one('SELECT * FROM businesses WHERE id = $1', [card.business_id]);
  res.type('png').set('Cache-Control', 'public, max-age=300').send(await img.stampStrip(b, card.stamps, 1032, 336));
}));
// QR genérico: /qr.svg?d=TEXTO (código de tarjeta o link de registro para el cartel)
app.get('/qr.svg', wrap(async (req, res) => {
  const d = String(req.query.d || '').slice(0, 300);
  if (!d) return res.sendStatus(400);
  res.type('svg').set('Cache-Control', 'public, max-age=86400')
    .send(await QRCode.toString(d, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
}));

// ---------- API pública (cliente) ----------
app.get('/api/b/:slug', wrap(async (req, res) => {
  const b = await getBusiness(req.params.slug);
  if (!b) return res.status(404).json({ error: 'Este negocio no existe.' });
  res.json(publicBusiness(b));
}));

app.post('/api/b/:slug/join', wrap(async (req, res) => {
  const b = await getBusiness(req.params.slug);
  if (!b) return res.status(404).json({ error: 'Este negocio no existe.' });
  const name = String(req.body.name || '').trim().slice(0, 60);
  const phone = cleanPhone(req.body.phone);
  if (name.length < 2) return res.status(400).json({ error: 'Escribe tu nombre.' });
  if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Escribe un celular válido de 9 dígitos.' });

  let card = await db.one('SELECT * FROM cards WHERE business_id = $1 AND customer_phone = $2', [b.id, phone]);
  let existing = !!card;
  if (!card) {
    card = await db.one(
      `INSERT INTO cards (business_id, code, auth_token, customer_name, customer_phone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [b.id, newCode(), crypto.randomBytes(24).toString('hex'), name, phone],
    );
    await db.query('INSERT INTO events (card_id, business_id, type) VALUES ($1, $2, $3)', [card.id, b.id, 'join']);
  }
  res.json({ code: card.code, existing });
}));

app.get('/api/card/:code', wrap(async (req, res) => {
  const card = await getCard(req.params.code);
  if (!card) return res.status(404).json({ error: 'No encontramos esta tarjeta.' });
  const b = await db.one('SELECT * FROM businesses WHERE id = $1', [card.business_id]);
  res.json({ business: publicBusiness(b), card: { ...publicCard(card), phone: undefined } });
}));

// Descarga del pase de Apple
app.get('/pass/apple/:file', wrap(async (req, res) => {
  if (!config.apple.enabled) return res.status(503).send('Apple Wallet aún no está configurado.');
  const card = await getCard(req.params.file.replace(/\.pkpass$/, ''));
  if (!card) return res.sendStatus(404);
  const b = await db.one('SELECT * FROM businesses WHERE id = $1', [card.business_id]);
  const buf = await apple.buildPass(b, card);
  res.set({ 'Content-Type': 'application/vnd.apple.pkpass', 'Content-Disposition': `attachment; filename="${b.slug}.pkpass"` });
  res.send(buf);
}));

// Redirección al link "Agregar a Google Wallet"
app.get('/pass/google/:code', wrap(async (req, res) => {
  if (!config.google.enabled) return res.status(503).send('Google Wallet aún no está configurado.');
  const card = await getCard(req.params.code);
  if (!card) return res.sendStatus(404);
  const b = await db.one('SELECT * FROM businesses WHERE id = $1', [card.business_id]);
  const url = await google.saveUrl(b, card);
  await db.query('UPDATE cards SET google_saved = TRUE WHERE id = $1', [card.id]);
  res.redirect(url);
}));

// ---------- Web service de Apple Wallet (lo llama el iPhone) ----------
const appleAuth = async (req) => {
  const token = (req.get('Authorization') || '').replace(/^ApplePass\s+/i, '');
  const card = await getCard(req.params.serial);
  if (!card || !token || card.auth_token !== token || req.params.passTypeId !== config.apple.passTypeId) return null;
  return card;
};
app.post('/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial', wrap(async (req, res) => {
  const card = await appleAuth(req);
  if (!card) return res.sendStatus(401);
  const r = await db.query(
    `INSERT INTO apple_registrations (device_id, push_token, card_id) VALUES ($1, $2, $3)
     ON CONFLICT (device_id, card_id) DO UPDATE SET push_token = EXCLUDED.push_token RETURNING (xmax = 0) AS inserted`,
    [req.params.deviceId, req.body.pushToken, card.id],
  );
  res.sendStatus(r.rows[0]?.inserted ? 201 : 200);
}));
app.delete('/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial', wrap(async (req, res) => {
  const card = await appleAuth(req);
  if (!card) return res.sendStatus(401);
  await db.query('DELETE FROM apple_registrations WHERE device_id = $1 AND card_id = $2', [req.params.deviceId, card.id]);
  res.sendStatus(200);
}));
app.get('/apple/v1/devices/:deviceId/registrations/:passTypeId', wrap(async (req, res) => {
  const since = Number(req.query.passesUpdatedSince || 0);
  const rows = await db.many(
    `SELECT c.code, c.updated_at FROM apple_registrations r JOIN cards c ON c.id = r.card_id
     WHERE r.device_id = $1`, [req.params.deviceId],
  );
  const changed = rows.filter((r) => new Date(r.updated_at).getTime() > since);
  if (!changed.length) return res.sendStatus(204);
  const last = Math.max(...rows.map((r) => new Date(r.updated_at).getTime()));
  res.json({ serialNumbers: changed.map((r) => r.code), lastUpdated: String(last) });
}));
app.get('/apple/v1/passes/:passTypeId/:serial', wrap(async (req, res) => {
  const card = await appleAuth(req);
  if (!card) return res.sendStatus(401);
  const modified = new Date(card.updated_at);
  const ims = req.get('If-Modified-Since');
  if (ims && Math.floor(modified.getTime() / 1000) <= Math.floor(new Date(ims).getTime() / 1000)) return res.sendStatus(304);
  const b = await db.one('SELECT * FROM businesses WHERE id = $1', [card.business_id]);
  res.set({ 'Content-Type': 'application/vnd.apple.pkpass', 'Last-Modified': modified.toUTCString() });
  res.send(await apple.buildPass(b, card));
}));
app.post('/apple/v1/log', (req, res) => { console.log('[apple log]', JSON.stringify(req.body)); res.sendStatus(200); });

// ---------- API del dueño ----------
const SESSION_COOKIE = 'pk_owner';
// Huella de la contraseña dentro de la sesión: al cambiar la contraseña se cierran las sesiones abiertas
const passMark = (b) => b.pin_hash.slice(-12);
const loginAttempts = new Map();
app.post('/api/admin/login', wrap(async (req, res) => {
  const username = cleanUser(req.body.username);
  const key = `${req.ip}:${username}`;
  const a = loginAttempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 10 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 6) return res.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' });
  const b = username ? await db.one('SELECT * FROM businesses WHERE lower(username) = $1', [username]) : null;
  if (!b || !checkPin(req.body.password || '', b.pin_hash)) {
    a.n++; loginAttempts.set(key, a);
    return res.status(401).json({ error: 'El usuario o la contraseña no coinciden. Revísalos y vuelve a intentar.' });
  }
  loginAttempts.delete(key);
  const token = jwt.sign({ bid: b.id, pm: passMark(b) }, config.sessionSecret, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https'), maxAge: 30 * 864e5 });
  res.json({ ok: true });
}));

const owner = wrap(async (req, res, next) => {
  let b = null;
  try {
    const s = jwt.verify(req.cookies[SESSION_COOKIE] || '', config.sessionSecret);
    b = await db.one('SELECT * FROM businesses WHERE id = $1', [s.bid]);
    if (!b || s.pm !== passMark(b)) b = null;
  } catch {}
  if (!b) return res.status(401).json({ error: 'Ingresa con tu usuario y contraseña.' });
  req.business = b;
  next();
});

app.post('/api/admin/logout', (req, res) => { res.clearCookie(SESSION_COOKIE); res.json({ ok: true }); });

app.get('/api/admin/me', owner, wrap(async (req, res) => {
  const b = req.business;
  const s = await db.one(
    `SELECT
      (SELECT count(*) FROM cards WHERE business_id = $1)::int AS customers,
      (SELECT coalesce(sum(amount),0) FROM events WHERE business_id = $1 AND type = 'stamp' AND created_at > now() - interval '1 day')::int AS stamps_today,
      (SELECT count(*) FROM events WHERE business_id = $1 AND type = 'redeem')::int AS rewards,
      (SELECT count(*) FROM cards WHERE business_id = $1 AND stamps >= $2)::int AS ready`, [b.id, b.stamps_goal]);
  const recent = await db.many(
    `SELECT e.type, e.amount, e.created_at, c.customer_name, c.code FROM events e JOIN cards c ON c.id = e.card_id
     WHERE e.business_id = $1 ORDER BY e.created_at DESC LIMIT 12`, [b.id]);
  res.json({ business: publicBusiness(b), stats: s, recent });
}));

app.get('/api/admin/search', owner, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const rows = await db.many(
    `SELECT * FROM cards WHERE business_id = $1 AND (customer_phone LIKE $2 OR customer_name ILIKE $3 OR code = $4)
     ORDER BY updated_at DESC LIMIT 8`, [req.business.id, `%${q.replace(/\D/g, '') || '~'}%`, `%${q}%`, q.toUpperCase()]);
  res.json({ results: rows.map(publicCard) });
}));

const ownerCard = async (req, res) => {
  const card = await getCard(req.params.code);
  if (!card || card.business_id !== req.business.id) { res.status(404).json({ error: 'Esta tarjeta no es de tu negocio o no existe.' }); return null; }
  return card;
};

app.get('/api/admin/card/:code', owner, wrap(async (req, res) => {
  const card = await ownerCard(req, res); if (!card) return;
  const history = await db.many('SELECT type, amount, created_at FROM events WHERE card_id = $1 ORDER BY created_at DESC LIMIT 10', [card.id]);
  res.json({ card: publicCard(card), history });
}));

app.post('/api/admin/card/:code/stamp', owner, wrap(async (req, res) => {
  const b = req.business;
  const card = await ownerCard(req, res); if (!card) return;
  const n = Math.max(1, Math.min(5, Number(req.body.count) || 1));
  if (card.last_stamp_at && !req.body.force) {
    const secs = (Date.now() - new Date(card.last_stamp_at).getTime()) / 1000;
    if (secs < config.stampCooldownSeconds) {
      return res.status(409).json({ error: `Esta tarjeta recibió un sello ${secs < 5 ? 'hace un momento' : `hace ${Math.round(secs)} segundos`}.`, confirm: true });
    }
  }
  const updated = await db.one(
    `UPDATE cards SET stamps = stamps + $2, stamps_total = stamps_total + $2, last_stamp_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`, [card.id, n]);
  await db.query('INSERT INTO events (card_id, business_id, type, amount) VALUES ($1, $2, $3, $4)', [card.id, b.id, 'stamp', n]);
  const done = updated.stamps >= b.stamps_goal;
  const left = b.stamps_goal - updated.stamps;
  syncWallets(b, updated, done
    ? { header: '¡Tarjeta completa!', body: `Ya puedes canjear: ${b.reward}` }
    : left <= 2 ? { header: `Te falta${left > 1 ? 'n' : ''} ${left} sello${left > 1 ? 's' : ''}`, body: `Para tu premio: ${b.reward}` } : null);
  res.json({ card: publicCard(updated), ready: done });
}));

app.post('/api/admin/card/:code/redeem', owner, wrap(async (req, res) => {
  const b = req.business;
  const card = await ownerCard(req, res); if (!card) return;
  if (card.stamps < b.stamps_goal) return res.status(400).json({ error: `Le faltan ${b.stamps_goal - card.stamps} sellos para canjear.` });
  const updated = await db.one(
    `UPDATE cards SET stamps = stamps - $2, rewards_redeemed = rewards_redeemed + 1, updated_at = now()
     WHERE id = $1 RETURNING *`, [card.id, b.stamps_goal]);
  await db.query('INSERT INTO events (card_id, business_id, type) VALUES ($1, $2, $3)', [card.id, b.id, 'redeem']);
  syncWallets(b, updated, { header: 'Premio canjeado', body: 'Tu tarjeta empezó de nuevo. ¡Gracias por volver!' });
  res.json({ card: publicCard(updated) });
}));

app.post('/api/admin/card/:code/undo', owner, wrap(async (req, res) => {
  const b = req.business;
  const card = await ownerCard(req, res); if (!card) return;
  if (card.stamps < 1) return res.status(400).json({ error: 'Esta tarjeta no tiene sellos para quitar.' });
  const updated = await db.one(
    `UPDATE cards SET stamps = stamps - 1, stamps_total = stamps_total - 1, updated_at = now() WHERE id = $1 RETURNING *`, [card.id]);
  await db.query('INSERT INTO events (card_id, business_id, type, amount) VALUES ($1, $2, $3, -1)', [card.id, b.id, 'undo']);
  syncWallets(b, updated);
  res.json({ card: publicCard(updated) });
}));

// ---------- Panel de Practik (crear y editar negocios) ----------
const panelAuth = (req, res, next) => {
  if (!config.adminKey) return res.status(503).json({ error: 'Define ADMIN_KEY en las variables de entorno.' });
  if (req.get('x-admin-key') !== config.adminKey) return res.status(401).json({ error: 'Clave de administrador incorrecta.' });
  next();
};

app.get('/api/panel/businesses', panelAuth, wrap(async (req, res) => {
  const rows = await db.many(
    `SELECT b.slug, b.username, b.name, b.color, b.text_color, b.stamps_goal, b.reward, b.terms, b.address, b.whatsapp, b.updated_at,
      (SELECT count(*) FROM cards c WHERE c.business_id = b.id)::int AS customers
     FROM businesses b ORDER BY b.created_at DESC`);
  res.json({ businesses: rows, wallets: { apple: config.apple.enabled, google: config.google.enabled }, publicUrl: config.publicUrl });
}));

app.post('/api/panel/businesses', panelAuth, wrap(async (req, res) => {
  const d = req.body;
  const slug = String(d.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug || !d.name) return res.status(400).json({ error: 'Nombre y enlace son obligatorios.' });
  const hex = (v, def) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : def);
  const goal = Math.max(3, Math.min(12, Number(d.stamps_goal) || 10));
  const logo = d.logo_base64 ? await require('sharp')(Buffer.from(d.logo_base64.split(',').pop(), 'base64')).resize(660, 660, { fit: 'inside' }).png().toBuffer() : null;
  const existing = await getBusiness(slug);
  const username = cleanUser(d.username) || (existing ? existing.username : slug);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: 'El usuario debe tener de 3 a 30 letras o números, sin espacios.' });
  if ((!existing || d.password) && !validPassword(d.password)) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
  const taken = await db.one('SELECT slug FROM businesses WHERE lower(username) = $1 AND slug <> $2', [username, slug]);
  if (taken) return res.status(400).json({ error: `El usuario "${username}" ya lo usa otro negocio. Elige otro.` });

  let b;
  if (existing) {
    b = await db.one(
      `UPDATE businesses SET name=$2, color=$3, text_color=$4, stamps_goal=$5, reward=$6, terms=$7, address=$8, whatsapp=$9,
         logo_png = COALESCE($10, logo_png), pin_hash = COALESCE($11, pin_hash), username=$12, updated_at = now()
       WHERE slug=$1 RETURNING *`,
      [slug, d.name, hex(d.color, existing.color), hex(d.text_color, existing.text_color), goal, d.reward || existing.reward,
        d.terms || '', d.address || '', cleanPhone(d.whatsapp), logo, d.password ? hashPin(d.password) : null, username]);
  } else {
    b = await db.one(
      `INSERT INTO businesses (slug, name, color, text_color, stamps_goal, reward, terms, address, whatsapp, logo_png, pin_hash, username)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [slug, d.name, hex(d.color, '#c4382c'), hex(d.text_color, '#ffffff'), goal, d.reward || 'Un producto gratis',
        d.terms || '', d.address || '', cleanPhone(d.whatsapp), logo, hashPin(d.password), username]);
  }
  if (config.google.enabled) google.ensureClass(b).catch((e) => console.error('[google] clase', e.message));
  res.json({ ok: true, slug: b.slug, username: b.username, links: { customer: `${config.publicUrl}/c/${b.slug}`, owner: `${config.publicUrl}/admin` } });
}));

// ---------- errores ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Algo falló en el servidor. Intenta de nuevo.' });
});

// En local (npm start) levanta el servidor; en Vercel solo se exporta la app (ver api/index.js)
if (require.main === module) {
  db.init().then(() => {
    app.listen(config.port, () => {
      console.log(`Practik Fidelidad en ${config.publicUrl}`);
      console.log(`Apple Wallet: ${config.apple.enabled ? 'activo' : 'sin configurar'} · Google Wallet: ${config.google.enabled ? 'activo' : 'sin configurar'}`);
    });
  });
}

module.exports = app;
