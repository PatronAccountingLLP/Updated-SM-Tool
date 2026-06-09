// ============================================================================
// Patron Accounting — Brand tokens + shared canvas helpers
// Foundation for the 7-day batch image renderer.
// Colors sampled from the real reference posts + logo.
// ============================================================================
const { GlobalFonts, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

// ---- Brand palette (sampled from refs) -------------------------------------
const BRAND = {
  navy:        '#002e6a',   // footer bar + headline navy (sampled)
  navyDeep:    '#0A1F3D',   // darker navy for color-block theme
  orange:      '#ff5f1b',   // logo orange / accent (sampled)
  orangeSoft:  '#E8541E',
  yellow:      '#F6B21B',   // carousel accent yellow
  teal:        '#16a89a',   // small divider accent on single posts
  white:       '#ffffff',
  offwhite:    '#f4f6f9',
  ink:         '#1d1d1f',
  grayText:    '#5b6470',
  panel:       '#ffffff',
};

// Firm constants (for footer — but NOTE: no CTA text is painted on images per spec;
// footer shows website only, kept minimal). Phone/email are NOT painted on images.
const FIRM = {
  website: 'www.patronaccounting.com',
};

// ---- Per-platform canvas sizes ---------------------------------------------
const SIZES = {
  instagram: { w: 1080, h: 1350 },   // 4:5
  linkedin:  { w: 1200, h: 1200 },   // 1:1
  facebook:  { w: 1200, h: 630  },   // 1.91:1
  pinterest: { w: 1000, h: 1500 },   // 2:3
  twitter:   { w: 1200, h: 675  },   // 16:9
  gmb:       { w: 1200, h: 900  },   // 4:3
  carousel:  { w: 1080, h: 1350 },   // IG/FB/LI carousel slides 4:5
};

// ---- Font registration ------------------------------------------------------
// Prefer fonts bundled in ./fonts (works on Render / any host); fall back to the
// system google-fonts path if the bundle is missing (e.g. local dev box).
const BUNDLED_FONT_DIR = path.join(__dirname, 'fonts');
const SYSTEM_FONT_DIR = '/usr/share/fonts/truetype/google-fonts';
let _fontsReady = false;
function ensureFonts() {
  if (_fontsReady) return;
  const reg = (file, family) => {
    const bundled = path.join(BUNDLED_FONT_DIR, file);
    const system = path.join(SYSTEM_FONT_DIR, file);
    try {
      if (fs.existsSync(bundled)) GlobalFonts.registerFromPath(bundled, family);
      else GlobalFonts.registerFromPath(system, family);
    } catch (e) { /* fall back to default */ }
  };
  reg('Poppins-Bold.ttf',    'PatronDisplay');   // headlines, accents
  reg('Poppins-Medium.ttf',  'PatronMedium');    // subtitles
  reg('Poppins-Regular.ttf', 'PatronBody');      // body / description
  reg('Poppins-Light.ttf',   'PatronLight');
  _fontsReady = true;
}

// ---- Asset loading (cached) -------------------------------------------------
const ASSET_DIR = path.join(__dirname, 'assets');
const _assetCache = {};
async function asset(name) {
  if (_assetCache[name]) return _assetCache[name];
  const img = await loadImage(path.join(ASSET_DIR, name));
  _assetCache[name] = img;
  return img;
}
const logoTransparent = () => asset('logo_allwhite.png'); // ALL-WHITE logo — use on DARK bg
const logoWhiteBg     = () => asset('logo_light.png');    // colored logo, transparent — use on LIGHT bg
const cityPhoto = (city) => asset(`city_${city}.jpg`);

// ---- Text helpers -----------------------------------------------------------
// Word-wrap to a max width; returns array of lines.
function wrapLines(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Draw wrapped text, return the y after the last line.
function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, opts = {}) {
  ctx.save();
  if (opts.font) ctx.font = opts.font;
  if (opts.color) ctx.fillStyle = opts.color;
  if (opts.align) ctx.textAlign = opts.align;
  ctx.textBaseline = 'alphabetic';
  const lines = wrapLines(ctx, text, maxWidth);
  let cy = y;
  for (const ln of lines) { ctx.fillText(ln, x, cy); cy += lineHeight; }
  ctx.restore();
  return cy;
}

// Cover-fit an image into a target rect (like CSS background-size: cover).
function drawCover(ctx, img, dx, dy, dw, dh) {
  const ir = img.width / img.height;
  const tr = dw / dh;
  let sx, sy, sw, sh;
  if (ir > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / tr; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Draw the logo into a box (keeps aspect, fits within w/h, top-right by default).
async function drawLogo(ctx, { x, y, w, h, dark = false }) {
  const img = dark ? await logoTransparent() : await logoWhiteBg();
  // logos are square 8000x8000 with lots of padding; fit into the box
  const r = Math.min(w / img.width, h / img.height);
  const dw = img.width * r, dh = img.height * r;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

module.exports = {
  BRAND, FIRM, SIZES,
  ensureFonts, asset, logoTransparent, logoWhiteBg, cityPhoto,
  wrapLines, drawWrapped, drawCover, drawLogo,
};
