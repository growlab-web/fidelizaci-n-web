// Apple Wallet: genera el .pkpass firmado y avisa a los iPhone cuando cambia la tarjeta.
// Documentación: https://developer.apple.com/documentation/walletpasses
const http2 = require('http2');
const { PKPass } = require('passkit-generator');
const config = require('../config');
const img = require('../images');
const db = require('../db');

const A = config.apple;

const rgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
};

async function buildPass(business, card) {
  if (!A.enabled) throw new Error('Apple Wallet no está configurado');
  const goal = business.stamps_goal;
  const ready = card.stamps >= goal;

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: A.passTypeId,
    teamIdentifier: A.teamId,
    serialNumber: card.code,
    authenticationToken: card.auth_token,
    webServiceURL: `${config.publicUrl}/apple`, // Apple llama aquí para registrar el iPhone y bajar la versión nueva
    organizationName: business.name,
    description: `Tarjeta de fidelidad ${business.name}`,
    logoText: business.name,
    backgroundColor: rgb(business.color),
    foregroundColor: rgb(business.text_color),
    labelColor: rgb(business.text_color),
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: card.code, messageEncoding: 'iso-8859-1', altText: card.code }],
    storeCard: {
      headerFields: [{
        key: 'stamps', label: 'SELLOS', value: `${Math.min(card.stamps, goal)}/${goal}`,
        changeMessage: 'Tu tarjeta ahora tiene %@ sellos', // aparece como notificación en el iPhone
      }],
      secondaryFields: [
        { key: 'name', label: 'CLIENTE', value: card.customer_name },
        {
          key: 'reward', label: ready ? 'PREMIO LISTO' : 'PREMIO', value: ready ? `Canjea: ${business.reward}` : business.reward,
          changeMessage: ready ? '¡Completaste tu tarjeta! %@' : undefined,
        },
      ],
      backFields: [
        { key: 'how', label: 'Cómo funciona', value: `Muestra este código en caja en cada compra para sumar un sello. Al juntar ${goal} sellos recibes: ${business.reward}.` },
        { key: 'redeemed', label: 'Premios canjeados', value: String(card.rewards_redeemed) },
        ...(business.address ? [{ key: 'address', label: 'Dirección', value: business.address }] : []),
        ...(business.whatsapp ? [{ key: 'wa', label: 'WhatsApp', value: business.whatsapp }] : []),
        ...(business.terms ? [{ key: 'terms', label: 'Términos', value: business.terms }] : []),
        { key: 'code', label: 'Código', value: card.code },
      ],
    },
  };
  // Limpia changeMessage indefinidos (Apple rechaza nulls)
  passJson.storeCard.secondaryFields.forEach((f) => f.changeMessage === undefined && delete f.changeMessage);

  const files = {
    'pass.json': Buffer.from(JSON.stringify(passJson)),
    'icon.png': await img.logoSquare(business, 29),
    'icon@2x.png': await img.logoSquare(business, 58),
    'icon@3x.png': await img.logoSquare(business, 87),
    'logo.png': await img.logoWide(business, 1),
    'logo@2x.png': await img.logoWide(business, 2),
    'logo@3x.png': await img.logoWide(business, 3),
    'strip.png': await img.stampStrip(business, card.stamps, 375, 123),
    'strip@2x.png': await img.stampStrip(business, card.stamps, 750, 246),
    'strip@3x.png': await img.stampStrip(business, card.stamps, 1125, 369),
  };

  const pass = new PKPass(files, {
    wwdr: A.wwdr,
    signerCert: A.signerCert,
    signerKey: A.signerKey,
    signerKeyPassphrase: A.signerKeyPassphrase,
  });
  return pass.getAsBuffer();
}

// Envía un push vacío a cada iPhone que tenga el pase; el iPhone luego pide la versión nueva.
async function notifyUpdate(card) {
  if (!A.enabled) return { sent: 0 };
  const regs = await db.many('SELECT push_token FROM apple_registrations WHERE card_id = $1', [card.id]);
  if (!regs.length) return { sent: 0 };
  const client = http2.connect(A.apnsHost, { cert: A.signerCert, key: A.signerKey, passphrase: A.signerKeyPassphrase });
  client.on('error', (e) => console.error('[apns] conexión', e.message));
  let sent = 0;
  await Promise.all(regs.map((r) => new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${r.push_token}`,
      'apns-topic': A.passTypeId, 'content-type': 'application/json',
    });
    req.on('response', async (h) => {
      const status = h[':status'];
      if (status === 200) sent++;
      if (status === 410) await db.query('DELETE FROM apple_registrations WHERE push_token = $1', [r.push_token]); // pase eliminado
      if (status !== 200 && status !== 410) console.error('[apns] estado', status);
    });
    req.on('end', resolve);
    req.on('error', (e) => { console.error('[apns]', e.message); resolve(); });
    req.end('{}');
  })));
  client.close();
  return { sent };
}

module.exports = { buildPass, notifyUpdate };
