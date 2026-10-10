// Modo de demostración (/admin?demo): responde como el servidor pero con datos de ejemplo guardados en memoria.
// No pide ingreso ni toca la base de datos; al recargar la página todo vuelve a empezar.
const LOGO = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><rect width="88" height="88" rx="20" fill="#c4382c"/>' +
  '<text x="44" y="57" font-family="sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">CM</text></svg>');

const business = {
  slug: 'cafe-misti', name: 'Café Misti', color: '#c4382c', text_color: '#ffffff', stamps_goal: 8,
  reward: 'Un café de cualquier tamaño', terms: 'Un sello por compra desde S/ 10.', address: 'Calle Mercaderes 120, Arequipa',
  whatsapp: '51999999999', logo: LOGO, wallets: { apple: true, google: true },
};

const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
const mk = (code, name, phone, stamps, rewards) => ({
  code, name, phone, stamps, stamps_total: stamps + rewards * 8, rewards_redeemed: rewards,
  last_stamp_at: null, created_at: ago(60 * 24 * 20), google_saved: false,
});
const cards = [
  mk('DEMOMARIA2', 'María Quispe', '987654321', 3, 0),
  mk('DEMOJUAN22', 'Juan Mamani', '951222333', 8, 1), // tarjeta completa: muestra "Entregar premio"
  mk('DEMOLUCIA2', 'Lucía Fernández', '999888777', 7, 2), // le falta un sello
  mk('DEMOCARLOS', 'Carlos Huamán', '944555666', 0, 0),
];
const events = [
  { code: 'DEMOJUAN22', type: 'stamp', amount: 1, created_at: ago(25) },
  { code: 'DEMOLUCIA2', type: 'stamp', amount: 2, created_at: ago(90) },
  { code: 'DEMOMARIA2', type: 'stamp', amount: 1, created_at: ago(200) },
  { code: 'DEMOLUCIA2', type: 'redeem', amount: 0, created_at: ago(60 * 26) },
  { code: 'DEMOCARLOS', type: 'join', amount: 0, created_at: ago(60 * 30) },
];
let rewards = 3;

const fail = (status, error, extra = {}) => { const e = new Error(error); e.status = status; e.data = { error, ...extra }; throw e; };
const log = (card, type, amount = 0) => events.unshift({ code: card.code, type, amount, created_at: new Date().toISOString() });
// Un QR cualquiera escaneado en la demostración abre la primera tarjeta de ejemplo
const find = (code) => cards.find((c) => c.code === String(code).toUpperCase()) || cards[0];

export async function demoCall(path, opts = {}) {
  await new Promise((r) => setTimeout(r, 180)); // se siente como una llamada real
  const body = opts.body || {};
  const [route, query = ''] = path.split('?');
  const parts = route.split('/').filter(Boolean);

  if (route === '/login' || route === '/logout') return { ok: true };

  if (route === '/me') {
    const day = Date.now() - 864e5;
    return {
      business,
      stats: {
        customers: cards.length,
        stamps_today: events.filter((e) => e.type === 'stamp' && new Date(e.created_at) > day).reduce((n, e) => n + e.amount, 0),
        ready: cards.filter((c) => c.stamps >= business.stamps_goal).length,
        rewards,
      },
      recent: events.slice(0, 12).map((e) => ({ ...e, customer_name: find(e.code).name })),
    };
  }

  if (route === '/search') {
    const q = decodeURIComponent(new URLSearchParams(query).get('q') || '').trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return { results: cards.filter((c) => c.name.toLowerCase().includes(q) || (digits && c.phone.includes(digits)) || c.code.toLowerCase() === q) };
  }

  if (parts[0] === 'card') {
    const card = find(decodeURIComponent(parts[1]));
    const action = parts[2];
    if (!action) return { card: { ...card }, history: events.filter((e) => e.code === card.code).slice(0, 10) };

    if (action === 'stamp') {
      const n = Math.max(1, Math.min(5, Number(body.count) || 1));
      if (card.last_stamp_at && !body.force && Date.now() - new Date(card.last_stamp_at) < 30e3) {
        fail(409, 'Esta tarjeta recibió un sello hace un momento.', { confirm: true });
      }
      card.stamps += n; card.stamps_total += n; card.last_stamp_at = new Date().toISOString();
      log(card, 'stamp', n);
      return { card: { ...card }, ready: card.stamps >= business.stamps_goal };
    }
    if (action === 'redeem') {
      if (card.stamps < business.stamps_goal) fail(400, `Le faltan ${business.stamps_goal - card.stamps} sellos para canjear.`);
      card.stamps -= business.stamps_goal; card.rewards_redeemed += 1; rewards += 1;
      log(card, 'redeem');
      return { card: { ...card } };
    }
    if (action === 'undo') {
      if (card.stamps < 1) fail(400, 'Esta tarjeta no tiene sellos para quitar.');
      card.stamps -= 1; card.stamps_total -= 1;
      log(card, 'undo', -1);
      return { card: { ...card } };
    }
  }
  fail(404, 'No disponible en la demostración.');
}
