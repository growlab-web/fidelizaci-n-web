// Lógica de la pantalla del dueño (web/pages/admin.astro).
// $, esc, api, applyBrand, cardHTML y toast vienen de /app.js, compartido con las páginas del cliente.
/* global $, esc, api, applyBrand, cardHTML, toast */

const A = (p) => `/api/admin${p}`;
const VIEWS = ['v-loading', 'v-login', 'v-home', 'v-card'];
const TYPE = { stamp: 'Sello', redeem: 'Premio', join: 'Nuevo', undo: 'Quitado' };
const when = (d) => new Date(d).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const firstName = (c) => c.name.trim().split(/\s+/)[0];

let B = null; // negocio
let card = null; // tarjeta abierta
let count = 1; // sellos a dar
let scanner = null;

function show(view) {
  VIEWS.forEach((id) => ($(`#${id}`).hidden = id !== view));
  window.scrollTo(0, 0);
}

// Llamada al servidor: si la sesión venció vuelve al ingreso; sin internet lo dice claro
async function call(path, opts) {
  try { return await api(A(path), opts); } catch (e) {
    if (!e.status) e.message = 'No hay conexión a internet. Revisa el wifi o los datos y vuelve a intentar.';
    if (e.status === 401 && path !== '/login') showLogin();
    throw e;
  }
}

// ---------- ingreso ----------
function showLogin() {
  closeScanner();
  card = null;
  $('#login-err').hidden = true;
  $('#password').value = '';
  show('v-login');
  ($('#username').value ? $('#password') : $('#username')).focus();
}

$('#toggle-pass').onclick = () => {
  const visible = $('#password').type === 'text';
  $('#password').type = visible ? 'password' : 'text';
  $('#toggle-pass').textContent = visible ? 'Mostrar' : 'Ocultar';
  $('#toggle-pass').setAttribute('aria-pressed', String(!visible));
};

$('#login-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const err = $('#login-err'), btn = $('#login-btn');
  const username = $('#username').value.trim(), password = $('#password').value;
  if (!username || !password) { err.textContent = 'Escribe el usuario y la contraseña.'; err.hidden = false; return; }
  err.hidden = true; btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await call('/login', { method: 'POST', body: { username, password } });
    await loadHome();
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    if (e.status === 401) { $('#password').value = ''; $('#password').focus(); }
  }
  btn.disabled = false; btn.textContent = 'Entrar';
};

$('#logout').onclick = async () => {
  try { await call('/logout', { method: 'POST' }); } catch {}
  showLogin();
};

// ---------- inicio ----------
async function loadHome() {
  const d = await call('/me');
  B = d.business;
  applyBrand(B);
  $('#brand-logo').src = B.logo;
  $('#brand-name').textContent = B.name;
  renderSummary(d);
  const joinUrl = `${location.origin}/c/${B.slug}`;
  $('#poster-qr').src = `/qr.svg?d=${encodeURIComponent(joinUrl)}`;
  $('#join-url').textContent = joinUrl;
  show('v-home');
}

function renderSummary(d) {
  $('#s-customers').textContent = d.stats.customers;
  $('#s-today').textContent = d.stats.stamps_today;
  $('#s-ready').textContent = d.stats.ready;
  $('#s-rewards').textContent = d.stats.rewards;
  $('#recent').innerHTML = d.recent.length
    ? d.recent.map((r) => `<button class="item" data-code="${esc(r.code)}">
        <span class="pill ${esc(r.type)}">${TYPE[r.type] || ''}${r.type === 'stamp' && r.amount > 1 ? ` ×${r.amount}` : ''}</span>
        <span class="name">${esc(r.customer_name)}</span><span class="muted small">${when(r.created_at)}</span></button>`).join('')
    : '<p class="muted small">Aún no hay movimientos.</p>';
}

async function goHome() {
  card = null;
  show('v-home');
  try { renderSummary(await call('/me')); } catch {}
}

$('#recent').onclick = (ev) => { const el = ev.target.closest('[data-code]'); if (el) openCard(el.dataset.code); };

$('#copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#join-url').textContent); toast('Enlace copiado'); } catch {
    const r = document.createRange(); r.selectNodeContents($('#join-url'));
    getSelection().removeAllRanges(); getSelection().addRange(r);
  }
};

// ---------- buscar ----------
let searchTimer;
$('#q').oninput = (ev) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(ev.target.value), 250); };

async function search(q) {
  if (q.trim().length < 2) { $('#results').innerHTML = ''; return; }
  try {
    const { results } = await call(`/search?q=${encodeURIComponent(q)}`);
    $('#results').innerHTML = results.length
      ? results.map((c) => `<button class="item" data-code="${esc(c.code)}"><strong class="name">${esc(c.name)}</strong>
          <span class="muted small">${esc(c.phone)}</span><span class="pill">${c.stamps}/${B.stamps_goal}</span></button>`).join('')
      : '<p class="muted small">No encontramos a ese cliente. Prueba con su número de celular completo.</p>';
  } catch (e) { toast(e.message, 4000); }
}

$('#results').onclick = (ev) => {
  const el = ev.target.closest('[data-code]'); if (!el) return;
  $('#results').innerHTML = ''; $('#q').value = '';
  openCard(el.dataset.code);
};

// ---------- escáner ----------
async function openScanner() {
  $('#scan-area').hidden = false; $('#scan-btn').hidden = true;
  $('#scan-area').scrollIntoView({ block: 'nearest' });
  try {
    const { Html5Qrcode } = await import('html5-qrcode');
    scanner = new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async (text) => {
      await closeScanner();
      if (navigator.vibrate) navigator.vibrate(60);
      openCard(text.trim().split('/').pop()); // el QR trae el código; si fuera un enlace, el código va al final
    });
  } catch {
    await closeScanner();
    toast('No pudimos usar la cámara. Dale permiso de cámara al navegador o busca al cliente por su celular.', 6000);
    $('#q').focus();
  }
}

async function closeScanner() {
  const s = scanner; scanner = null;
  if (s) { try { await s.stop(); s.clear(); } catch {} }
  $('#scan-area').hidden = true; $('#scan-btn').hidden = false;
}

$('#scan-btn').onclick = openScanner;
$('#scan-cancel').onclick = closeScanner;

// ---------- tarjeta del cliente ----------
// done: { title, text, warn } muestra el aviso grande de lo que se acaba de hacer
async function openCard(code, { done = null, pop = -1 } = {}) {
  try {
    const d = await call(`/card/${encodeURIComponent(code)}`);
    card = d.card;
    renderCard(d.history, done, pop);
    show('v-card');
  } catch (e) { toast(e.message, 5000); }
}

function setCount(v) {
  count = Math.max(1, Math.min(5, v));
  $('#n').textContent = count;
  $('#stamp-more').textContent = `Dar ${plural(count, 'sello', 'sellos')}`;
}

function renderCard(history, done, pop) {
  const ready = card.stamps >= B.stamps_goal;
  $('#card-visual').innerHTML = cardHTML(B, card, pop);
  $('#card-phone').textContent = card.phone;
  $('#card-rewards').textContent = plural(card.rewards_redeemed, 'premio canjeado', 'premios canjeados');

  $('#done').hidden = !done;
  if (done) {
    $('#done').classList.toggle('warn', !!done.warn);
    $('#done-title').textContent = done.title;
    $('#done-text').textContent = done.text;
  }
  $('#confirm').hidden = true;
  $('#more').open = false;
  setCount(2);

  $('#redeem').hidden = !ready;
  $('#redeem').textContent = `Entregar premio: ${B.reward}`;
  // El botón principal es lo que toca hacer ahora: dar el sello, o pasar al siguiente cliente si ya se dio
  const finished = !!done && !done.warn;
  $('#stamp').hidden = finished || ready;
  $('#stamp').disabled = false;
  $('#stamp-more').disabled = false;
  $('#next').classList.toggle('ghost', !finished || ready);
  $('#next').classList.toggle('brand', finished && !ready);
  $('#undo').disabled = card.stamps < 1;

  $('#history').innerHTML = history.map((h) => `<div class="item"><span class="pill ${esc(h.type)}">${TYPE[h.type] || ''}${h.amount > 1 ? ` ×${h.amount}` : ''}</span>
    <span class="spacer"></span><span class="muted">${when(h.created_at)}</span></div>`).join('');
}

function ask(text, yesLabel, onYes) {
  $('#confirm-text').textContent = text;
  $('#confirm-yes').textContent = yesLabel;
  $('#confirm-yes').onclick = () => { $('#confirm').hidden = true; onYes(); };
  $('#confirm').hidden = false;
  $('#confirm').scrollIntoView({ block: 'center' });
}
$('#confirm-no').onclick = () => { $('#confirm').hidden = true; };

async function stamp(n, force) {
  const before = card.stamps, name = firstName(card);
  $('#stamp').disabled = true; $('#stamp-more').disabled = true;
  try {
    const r = await call(`/card/${card.code}/stamp`, { method: 'POST', body: { count: n, force } });
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
    const last = Math.min(r.card.stamps, B.stamps_goal) - 1;
    await openCard(card.code, {
      pop: last >= before ? last : -1,
      done: r.ready
        ? { title: '¡Tarjeta completa!', text: `${name} ya puede recibir su premio: ${B.reward}.` }
        : { title: n > 1 ? `${n} sellos agregados` : 'Sello agregado', text: `${name} lleva ${r.card.stamps} de ${B.stamps_goal} sellos.` },
    });
  } catch (e) {
    $('#stamp').disabled = false; $('#stamp-more').disabled = false;
    if (e.data && e.data.confirm) ask(`${e.message} ¿Quieres darle otro sello de todas formas?`, 'Sí, dar otro sello', () => stamp(n, true));
    else if (e.status !== 401) toast(e.message, 5000);
  }
}

async function redeem() {
  const name = firstName(card);
  try {
    await call(`/card/${card.code}/redeem`, { method: 'POST' });
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
    await openCard(card.code, { done: { title: 'Premio entregado', text: `La tarjeta de ${name} empezó de nuevo.` } });
  } catch (e) { if (e.status !== 401) toast(e.message, 5000); }
}

async function undo() {
  const name = firstName(card);
  try {
    const r = await call(`/card/${card.code}/undo`, { method: 'POST' });
    await openCard(card.code, { done: { warn: true, title: 'Se quitó 1 sello', text: `${name} ahora tiene ${r.card.stamps} de ${B.stamps_goal} sellos.` } });
  } catch (e) { if (e.status !== 401) toast(e.message, 5000); }
}

$('#stamp').onclick = () => stamp(1, false);
$('#stamp-more').onclick = () => stamp(count, false);
$('#redeem').onclick = () => ask(`¿Ya le entregaste a ${firstName(card)} su premio (${B.reward})? Su tarjeta volverá a empezar.`, 'Sí, premio entregado', redeem);
$('#undo').onclick = undo;
$('#minus').onclick = () => setCount(count - 1);
$('#plus').onclick = () => setCount(count + 1);
$('#back').onclick = goHome;
$('#next').onclick = async () => { await goHome(); openScanner(); };

// ---------- arranque ----------
async function start() {
  $('#retry').hidden = true;
  $('#loading-text').textContent = 'Cargando…';
  show('v-loading');
  try { await loadHome(); } catch (e) {
    if (e.status === 401) return; // call() ya mostró el ingreso
    $('#loading-text').textContent = e.message;
    $('#retry').hidden = false;
  }
}
$('#retry').onclick = start;
start();
