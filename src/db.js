// Capa de base de datos. En producción usa Postgres (DATABASE_URL, ej. Supabase o Neon).
// Sin DATABASE_URL usa PGlite (Postgres embebido) guardado en ./data, ideal para probar en local.
const path = require('path');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#c4382c',
  text_color    TEXT NOT NULL DEFAULT '#ffffff',
  stamps_goal   INTEGER NOT NULL DEFAULT 10,
  reward        TEXT NOT NULL DEFAULT 'Un producto gratis',
  terms         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  whatsapp      TEXT NOT NULL DEFAULT '',
  logo_png      BYTEA,
  pin_hash      TEXT NOT NULL,
  google_class_ready BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cards (
  id              SERIAL PRIMARY KEY,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code            TEXT UNIQUE NOT NULL,          -- va en el QR y es el serial del pase
  auth_token      TEXT NOT NULL,                 -- token del web service de Apple
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  stamps          INTEGER NOT NULL DEFAULT 0,    -- sellos actuales
  stamps_total    INTEGER NOT NULL DEFAULT 0,    -- sellos históricos
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  last_stamp_at   TIMESTAMPTZ,
  google_saved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_phone)
);

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                     -- join | stamp | redeem | undo
  amount      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_business_idx ON events (business_id, created_at DESC);

-- Registros de dispositivos Apple (para enviar actualizaciones push al pase)
CREATE TABLE IF NOT EXISTS apple_registrations (
  device_id   TEXT NOT NULL,
  push_token  TEXT NOT NULL,
  card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, card_id)
);

-- Usuario con el que el dueño (o quien lo reemplace) entra a /admin. La contraseña vive en pin_hash.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE businesses SET username = slug WHERE username IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_username_idx ON businesses (lower(username));
`;

let impl;

async function init() {
  if (impl) return impl;
  if (process.env.VERCEL && !config.databaseUrl) {
    throw new Error('En Vercel falta DATABASE_URL: conecta una base Postgres (Supabase o Neon).');
  }
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    const pool = new Pool({
      max: process.env.VERCEL ? 3 : 10, // pocas conexiones por función en Vercel
      connectionString: config.databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
    });
    impl = { query: (t, p) => pool.query(t, p), exec: (t) => pool.query(t) };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = new PGlite(path.join(__dirname, '..', 'data'));
    await pg.waitReady;
    impl = { query: (t, p) => pg.query(t, p), exec: (t) => pg.exec(t) };
  }
  await impl.exec(SCHEMA);
  return impl;
}

let ready;
async function query(text, params = []) {
  ready ||= init().catch((e) => { ready = null; throw e; });
  const db = await ready;
  return db.query(text, params);
}

const one = async (t, p) => (await query(t, p)).rows[0] || null;
const many = async (t, p) => (await query(t, p)).rows;

module.exports = { init, query, one, many };
