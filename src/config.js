// Configuración central. Todo sale de variables de entorno (ver .env.example).
const fs = require('fs');
const path = require('path');

// Carga simple de .env sin dependencias
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const b64 = (v) => (v ? Buffer.from(v, 'base64').toString('utf8') : null);
const e = process.env;

const config = {
  port: Number(e.PORT || 3000),
  publicUrl: (e.PUBLIC_URL || `http://localhost:${e.PORT || 3000}`).replace(/\/$/, ''),
  databaseUrl: e.DATABASE_URL || null, // vacío = base de datos local en ./data (PGlite)
  sessionSecret: e.SESSION_SECRET || 'cambia-esto-en-produccion',
  adminKey: e.ADMIN_KEY || null, // clave para el panel /panel donde se crean negocios
  stampCooldownSeconds: Number(e.STAMP_COOLDOWN_SECONDS || 30),

  apple: {
    passTypeId: e.APPLE_PASS_TYPE_ID || null, // ej. pass.pe.practik.fidelidad
    teamId: e.APPLE_TEAM_ID || null,
    signerCert: b64(e.APPLE_SIGNER_CERT_B64), // certificado del Pass Type ID (PEM, base64)
    signerKey: b64(e.APPLE_SIGNER_KEY_B64), // llave privada (PEM, base64)
    signerKeyPassphrase: e.APPLE_SIGNER_KEY_PASSPHRASE || undefined,
    wwdr: b64(e.APPLE_WWDR_B64), // certificado intermedio WWDR G4 (PEM, base64)
    apnsHost: e.APPLE_APNS_HOST || 'https://api.push.apple.com',
  },

  google: {
    issuerId: e.GOOGLE_ISSUER_ID || null,
    serviceAccount: e.GOOGLE_SERVICE_ACCOUNT_B64 ? JSON.parse(b64(e.GOOGLE_SERVICE_ACCOUNT_B64)) : null,
  },
};

config.apple.enabled = !!(config.apple.passTypeId && config.apple.teamId && config.apple.signerCert && config.apple.signerKey && config.apple.wwdr);
config.google.enabled = !!(config.google.issuerId && config.google.serviceAccount);

module.exports = config;
