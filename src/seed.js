// Crea un negocio de prueba: node src/seed.js
const crypto = require('crypto');
const db = require('./db');

(async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const pin = `${salt}:${crypto.scryptSync('1234', salt, 32).toString('hex')}`;
  await db.query(
    `INSERT INTO businesses (slug, username, name, color, text_color, stamps_goal, reward, address, whatsapp, terms, pin_hash)
     VALUES ('cafe-misti', 'cafe-misti', 'Café Misti', '#c4382c', '#ffffff', 8, 'Un café de cualquier tamaño', 'Calle Mercaderes 120, Arequipa', '51999999999',
       'Un sello por compra desde S/ 10. Premio válido por 60 días.', $1)
     ON CONFLICT (slug) DO NOTHING`, [pin]);
  console.log('Negocio demo listo: /c/cafe-misti (cliente) y /admin (dueño, usuario cafe-misti, contraseña 1234)');
  process.exit(0);
})();
