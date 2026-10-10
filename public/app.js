// Utilidades compartidas por las pantallas
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.error || 'Algo falló. Intenta de nuevo.'); e.status = res.status; e.data = data; throw e; }
  return data;
}

function applyBrand(b) {
  document.documentElement.style.setProperty('--brand', b.color);
  document.documentElement.style.setProperty('--brand-ink', b.text_color);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = b.color;
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function dotsHTML(goal, stamps, popIndex = -1) {
  const cols = goal <= 6 ? goal : Math.ceil(goal / 2);
  let h = `<div class="dots" style="--cols:${cols}" role="img" aria-label="${Math.min(stamps, goal)} de ${goal} sellos">`;
  for (let i = 0; i < goal; i++) {
    const on = i < stamps;
    const gift = i === goal - 1 && !on;
    h += `<span class="dot${on ? ' on' : ''}${gift ? ' gift' : ''}${i === popIndex ? ' pop' : ''}">${on ? CHECK : gift ? 'GRATIS' : ''}</span>`;
  }
  return h + '</div>';
}

function cardHTML(b, card, popIndex) {
  const s = card ? card.stamps : 0;
  const ready = s >= b.stamps_goal;
  return `<div class="lcard">
    <div class="top">
      <div><div class="lbl">${esc(b.name)}</div><div style="font-weight:700;margin-top:2px">${esc(card ? card.name : 'Tarjeta de fidelidad')}</div></div>
      <div style="text-align:right"><div class="lbl">Sellos</div><div class="big">${Math.min(s, b.stamps_goal)}/${b.stamps_goal}</div></div>
    </div>
    ${dotsHTML(b.stamps_goal, s, popIndex)}
    <div><div class="lbl">${ready ? 'Premio listo' : 'Tu premio'}</div><div style="font-weight:600">${esc(b.reward)}</div></div>
  </div>`;
}

const platform = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
};

const WALLET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M15 14h3"/></svg>';

function walletButtons(b, code) {
  const p = platform();
  const a = b.wallets.apple ? `<a class="wallet-btn" href="/pass/apple/${code}.pkpass">${WALLET_ICON}Agregar a Apple Wallet</a>` : '';
  const g = b.wallets.google ? `<a class="wallet-btn" href="/pass/google/${code}">${WALLET_ICON}Agregar a Google Wallet</a>` : '';
  if (p === 'ios') return a || '';
  if (p === 'android') return g || '';
  return a + g;
}

function toast(msg, ms = 2600) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms);
}
