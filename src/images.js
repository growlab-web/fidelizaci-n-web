// Genera las imágenes de la tarjeta: logo, ícono y la franja de sellos.
// La franja se redibuja cada vez que cambia el número de sellos.
const sharp = require('sharp');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// Mezcla un color con blanco/negro (para el tono de los sellos vacíos)
function mix(hex, target, t) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const T = target === 'white' ? 255 : 0;
  const m = (c) => Math.round(c + (T - c) * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function isLight(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

const toBuf = (v) => (v ? Buffer.from(v) : null);

// Logo cuadrado (si el negocio no subió uno, se usan sus iniciales)
async function logoSquare(business, size) {
  const logo = toBuf(business.logo_png);
  if (logo) {
    return sharp(logo).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" rx="${size * 0.22}" fill="${business.color}"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
      font-weight="700" font-size="${size * 0.42}" fill="${business.text_color}">${esc(initials(business.name))}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Logo horizontal para la cabecera del pase de Apple (máx. 160x50 pt)
async function logoWide(business, scale) {
  const h = 50 * scale;
  const logo = toBuf(business.logo_png);
  if (logo) return sharp(logo).resize({ height: h, width: 160 * scale, fit: 'inside' }).png().toBuffer();
  return logoSquare(business, h);
}

// Franja con la grilla de sellos
async function stampStrip(business, stamps, width, height) {
  const goal = business.stamps_goal;
  const cols = goal <= 6 ? goal : Math.ceil(goal / 2);
  const rows = Math.ceil(goal / cols);
  const pad = width * 0.05;
  const cellW = (width - pad * 2) / cols;
  const cellH = (height - pad * 2) / rows;
  const r = Math.min(cellW, cellH) * 0.36;
  const light = isLight(business.color);
  const emptyFill = light ? mix(business.color, 'black', 0.12) : mix(business.color, 'white', 0.18);
  const ink = business.text_color;
  let marks = '';
  for (let i = 0; i < goal; i++) {
    const cx = pad + cellW * (i % cols) + cellW / 2;
    const cy = pad + cellH * Math.floor(i / cols) + cellH / 2;
    const filled = i < stamps;
    const last = i === goal - 1;
    if (filled) {
      marks += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ink}"/>
        <path d="M${cx - r * 0.42} ${cy + r * 0.02} l${r * 0.3} ${r * 0.3} l${r * 0.56} -${r * 0.6}"
          fill="none" stroke="${business.color}" stroke-width="${r * 0.18}" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      marks += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${emptyFill}" stroke="${ink}" stroke-opacity=".55"
        stroke-width="${r * 0.07}" ${last ? `stroke-dasharray="${r * 0.25} ${r * 0.18}"` : ''}/>`;
      if (last) {
        marks += `<text x="${cx}" y="${cy}" dy=".35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
          font-weight="700" font-size="${r * 0.44}" fill="${ink}" fill-opacity=".85">GRATIS</text>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${business.color}"/>${marks}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { logoSquare, logoWide, stampStrip, initials, isLight };
