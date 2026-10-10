// Google Wallet: crea la "clase" (diseño por negocio) y el "objeto" (tarjeta de cada cliente),
// genera el link "Agregar a Google Wallet" y actualiza los sellos.
// Documentación: https://developers.google.com/wallet/retail/loyalty-cards
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const config = require('../config');
const db = require('../db');

const G = config.google;
const API = 'https://walletobjects.googleapis.com/walletobjects/v1';
let auth;

function client() {
  if (!G.enabled) throw new Error('Google Wallet no está configurado');
  auth ||= new GoogleAuth({ credentials: G.serviceAccount, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
  return auth.getClient();
}

async function api(method, path, body) {
  const c = await client();
  try {
    const res = await c.request({ url: `${API}${path}`, method, data: body });
    return res.data;
  } catch (e) {
    const status = e.response?.status;
    if (status === 404) return null;
    throw new Error(`Google Wallet ${method} ${path}: ${status} ${JSON.stringify(e.response?.data?.error?.message || e.message)}`);
  }
}

const classId = (b) => `${G.issuerId}.practik_${b.slug.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
const objectId = (card) => `${G.issuerId}.card_${card.code}`;
const img = (uri, text) => ({ sourceUri: { uri }, contentDescription: { defaultValue: { language: 'es', value: text } } });

function classBody(b) {
  return {
    id: classId(b),
    issuerName: b.name,
    programName: `Tarjeta de fidelidad`,
    programLogo: img(`${config.publicUrl}/img/logo/${b.slug}.png?v=${new Date(b.updated_at).getTime()}`, b.name),
    hexBackgroundColor: b.color,
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    rewardsTier: b.reward,
    rewardsTierLabel: 'Premio',
  };
}

// Crea o actualiza el diseño de la tarjeta del negocio
async function ensureClass(b) {
  const existing = await api('GET', `/loyaltyClass/${classId(b)}`);
  if (existing) await api('PATCH', `/loyaltyClass/${classId(b)}`, classBody(b));
  else await api('POST', '/loyaltyClass', classBody(b));
  await db.query('UPDATE businesses SET google_class_ready = TRUE WHERE id = $1', [b.id]);
}

function objectBody(b, card) {
  const goal = b.stamps_goal;
  const ready = card.stamps >= goal;
  return {
    id: objectId(card),
    classId: classId(b),
    state: 'ACTIVE',
    accountId: card.code,
    accountName: card.customer_name,
    loyaltyPoints: { label: 'Sellos', balance: { string: `${Math.min(card.stamps, goal)}/${goal}` } },
    secondaryLoyaltyPoints: { label: 'Premios', balance: { int: card.rewards_redeemed } },
    barcode: { type: 'QR_CODE', value: card.code, alternateText: card.code },
    // La imagen cambia de URL con cada sello para que Google la vuelva a descargar
    heroImage: img(`${config.publicUrl}/img/stamps/${card.code}.png?s=${card.stamps}`, `${card.stamps} de ${goal} sellos`),
    textModulesData: [
      { id: 'reward', header: ready ? '¡Premio listo!' : 'Tu premio', body: ready ? `Muestra tu tarjeta en caja y canjea: ${b.reward}` : `Al juntar ${goal} sellos: ${b.reward}` },
      ...(b.address ? [{ id: 'address', header: 'Dirección', body: b.address }] : []),
    ],
  };
}

// Link firmado "Agregar a Google Wallet". Crea la tarjeta al momento de guardarla.
async function saveUrl(b, card) {
  if (!b.google_class_ready) await ensureClass(b);
  const sa = G.serviceAccount;
  const token = jwt.sign({
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    origins: [config.publicUrl],
    payload: { loyaltyObjects: [objectBody(b, card)] },
  }, sa.private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}

// Actualiza la tarjeta en el celular del cliente. Si aún no la guardó, no hace nada.
async function updateCard(b, card, { notify } = {}) {
  if (!G.enabled) return { updated: false };
  const id = objectId(card);
  const res = await api('PATCH', `/loyaltyObject/${id}`, objectBody(b, card));
  if (!res) return { updated: false };
  if (notify) {
    // Notificación visible en el celular (Google limita la cantidad por día)
    await api('POST', `/loyaltyObject/${id}/addMessage`, {
      message: { header: notify.header, body: notify.body, id: `m${Date.now()}`, messageType: 'TEXT_AND_NOTIFY' },
    }).catch((e) => console.error('[google] mensaje', e.message));
  }
  return { updated: true };
}

module.exports = { ensureClass, saveUrl, updateCard, classId, objectId };
