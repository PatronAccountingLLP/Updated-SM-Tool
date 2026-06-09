// ============================================================================
// Patron Accounting — 5 distinct visual THEMES for single-image posts.
// Each day's 5 posts on a platform rotate through these so no two look alike.
// NO CTA text is painted on any image (per spec). Logo + subtle footer only.
//
// Theme index:
//   1 editorialPhoto   - AI/stock photo right, white panel left + painted headline
//   2 vectorBlob       - flat-vector illustration on a color-blob field
//   3 documentCloseup  - certificate/document close-up photo + panel
//   4 colorBlock       - bold navy/orange geometric block, no photo
//   5 dataCard         - big stat number, minimal grid lines
//
// A post spec looks like:
//   { headline, accent, subtitle, description, stat, statLabel,
//     photo (Image), illustration (Image), city }
// ============================================================================
const { createCanvas } = require('@napi-rs/canvas');
const B = require('./brand');

const THEME_NAMES = ['editorialPhoto', 'vectorBlob', 'documentCloseup', 'colorBlock', 'dataCard'];

// Split a headline into [before, accentWord, after] so the accent renders orange.
function splitAccent(headline, accent) {
  if (!accent) return [headline, '', ''];
  const i = headline.toUpperCase().indexOf(String(accent).toUpperCase());
  if (i < 0) return [headline, '', ''];
  return [headline.slice(0, i), headline.slice(i, i + accent.length), headline.slice(i + accent.length)];
}

// Paint the small logo box. dark=true uses the light (transparent) logo on dark bg.
async function logo(ctx, W, dark) {
  const lw = Math.round(W * 0.12), lh = Math.round(lw * 0.552); // smaller logo, aspect ~1.81:1
  await B.drawLogo(ctx, { x: W - lw - Math.round(W * 0.045), y: Math.round(W * 0.04), w: lw, h: lh, dark });
}

// Tiny brand divider (orange + teal dashes) used on panel themes.
function divider(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.fillStyle = B.BRAND.orange; ctx.fillRect(x, y, 70 * scale, 8 * scale);
  ctx.fillStyle = B.BRAND.teal;   ctx.fillRect(x + 84 * scale, y, 34 * scale, 8 * scale);
  ctx.restore();
}

// Headline painter that flows an accent word in orange across wrapped lines.
function paintHeadline(ctx, parts, x, y, maxW, fontPx, lineH, navy) {
  const [before, acc, after] = parts;
  ctx.save();
  ctx.font = `${fontPx}px PatronDisplay`;
  ctx.textBaseline = 'alphabetic';
  // tokenize but keep track of which tokens are the accent
  const seq = [];
  before.trim().split(/\s+/).filter(Boolean).forEach(w => seq.push([w, navy]));
  if (acc) acc.trim().split(/\s+/).filter(Boolean).forEach(w => seq.push([w, B.BRAND.orange]));
  after.trim().split(/\s+/).filter(Boolean).forEach(w => seq.push([w, navy]));
  const space = ctx.measureText(' ').width;
  let cx = x, cy = y;
  for (const [w, col] of seq) {
    const ww = ctx.measureText(w).width;
    if (cx + ww > x + maxW && cx > x) { cx = x; cy += lineH; }
    ctx.fillStyle = col; ctx.fillText(w, cx, cy);
    cx += ww + space;
  }
  ctx.restore();
  return cy; // baseline of last line
}

// ----------------------------------------------------------------------------
// THEME 1 — Editorial photo right, white panel left.
// ----------------------------------------------------------------------------
async function editorialPhoto(spec, size) {
  const { w: W, h: H } = size;
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  // base
  ctx.fillStyle = B.BRAND.white; ctx.fillRect(0, 0, W, H);
  // photo on the right ~52%
  const photoX = Math.round(W * 0.48);
  if (spec.photo) B.drawCover(ctx, spec.photo, photoX, 0, W - photoX, H);
  else { ctx.fillStyle = B.BRAND.offwhite; ctx.fillRect(photoX, 0, W - photoX, H); }
  // white panel with soft fade into the photo
  const grad = ctx.createLinearGradient(0, 0, W * 0.62, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.82, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W * 0.62, H);
  // layout metrics
  const padX = Math.round(W * 0.06);
  const colW = Math.round(W * 0.42) - padX;
  const isWide = W / H > 1.4; // FB/Twitter/GMB landscape
  const hlPx = Math.round((isWide ? 0.05 : 0.058) * W);
  const lineH = Math.round(hlPx * 1.08);
  let y = Math.round(H * (isWide ? 0.24 : 0.2));
  const parts = splitAccent(spec.headline || '', spec.accent);
  y = paintHeadline(ctx, parts, padX, y, colW, hlPx, lineH, B.BRAND.navy);
  // divider
  y += Math.round(hlPx * 0.5);
  divider(ctx, padX, y, isWide ? 0.8 : 1);
  y += Math.round(hlPx * 0.7);
  // subtitle (medium navy)
  if (spec.subtitle) {
    const subPx = Math.round((isWide ? 0.03 : 0.034) * W);
    y = B.drawWrapped(ctx, spec.subtitle, padX, y + subPx, colW, Math.round(subPx * 1.3),
      { font: `${subPx}px PatronMedium`, color: B.BRAND.navy });
    y += Math.round(subPx * 0.6);
  }
  // description (gray body)
  if (spec.description && !isWide) {
    const dPx = Math.round(0.026 * W);
    B.drawWrapped(ctx, spec.description, padX, y + dPx, colW, Math.round(dPx * 1.4),
      { font: `${dPx}px PatronBody`, color: B.BRAND.grayText });
  }
  await logo(ctx, W, false);
  return c.toBuffer('image/png');
}

// ----------------------------------------------------------------------------
// THEME 2 — Flat-vector illustration on a color-blob field.
// ----------------------------------------------------------------------------
async function vectorBlob(spec, size) {
  const { w: W, h: H } = size;
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  // color field — alternate navy/yellow vs purple etc. by spec.colorway
  const ways = [
    { bg: B.BRAND.navyDeep, blob: '#F6B21B', text: B.BRAND.white },
    { bg: '#6C4BD8', blob: '#C9B6F5', text: B.BRAND.white },
    { bg: '#1FA463', blob: '#BFE9C9', text: B.BRAND.white },
  ];
  const cw = ways[(spec.colorIdx || 0) % ways.length];
  ctx.fillStyle = cw.bg; ctx.fillRect(0, 0, W, H);
  // organic blob on the right
  ctx.save();
  ctx.fillStyle = cw.blob; ctx.globalAlpha = 0.96;
  ctx.beginPath();
  const bx = W * 0.66;
  ctx.moveTo(bx, 0);
  ctx.bezierCurveTo(W * 0.58, H * 0.28, W * 0.78, H * 0.5, W * 0.62, H * 0.72);
  ctx.bezierCurveTo(W * 0.52, H * 0.9, W * 0.8, H, W, H);
  ctx.lineTo(W, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
  // illustration bottom-right if provided
  if (spec.illustration) {
    const iw = Math.round(W * 0.42), ih = Math.round(iw * (spec.illustration.height / spec.illustration.width));
    ctx.drawImage(spec.illustration, W - iw - Math.round(W * 0.04), H - ih - Math.round(H * 0.06), iw, ih);
  }
  // headline left, on the solid bg
  const padX = Math.round(W * 0.06);
  const colW = Math.round(W * 0.5);
  const isWide = W / H > 1.4;
  const hlPx = Math.round((isWide ? 0.06 : 0.075) * W);
  const parts = splitAccent(spec.headline || '', spec.accent);
  // on dark bg, base text is white, accent stays orange
  let y = Math.round(H * 0.3);
  // custom paint with white base
  y = paintHeadline(ctx, parts, padX, y, colW, hlPx, Math.round(hlPx * 1.06), cw.text);
  y += Math.round(hlPx * 0.5);
  divider(ctx, padX, y, isWide ? 0.8 : 1);
  if (spec.subtitle) {
    const subPx = Math.round((isWide ? 0.03 : 0.034) * W);
    B.drawWrapped(ctx, spec.subtitle, padX, y + Math.round(hlPx * 0.7) + subPx, colW, Math.round(subPx * 1.3),
      { font: `${subPx}px PatronMedium`, color: cw.text });
  }
  await logo(ctx, W, true);
  return c.toBuffer('image/png');
}

// ----------------------------------------------------------------------------
// THEME 3 — Certificate/document close-up photo + panel (variant of 1, panel bottom).
// ----------------------------------------------------------------------------
async function documentCloseup(spec, size) {
  const { w: W, h: H } = size;
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  if (spec.photo) B.drawCover(ctx, spec.photo, 0, 0, W, H);
  else { ctx.fillStyle = B.BRAND.offwhite; ctx.fillRect(0, 0, W, H); }
  // dark scrim bottom for legibility
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(0,17,40,0)');
  g.addColorStop(1, 'rgba(0,17,40,0.86)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const padX = Math.round(W * 0.06);
  const colW = W - padX * 2;
  const isWide = W / H > 1.4;
  const hlPx = Math.round((isWide ? 0.05 : 0.066) * W);
  const parts = splitAccent(spec.headline || '', spec.accent);
  // headline near the bottom, white base + orange accent
  let y = Math.round(H * (isWide ? 0.6 : 0.66));
  y = paintHeadline(ctx, parts, padX, y, colW, hlPx, Math.round(hlPx * 1.06), B.BRAND.white);
  if (spec.subtitle) {
    const subPx = Math.round((isWide ? 0.028 : 0.032) * W);
    B.drawWrapped(ctx, spec.subtitle, padX, y + Math.round(hlPx * 0.55) + subPx, colW, Math.round(subPx * 1.3),
      { font: `${subPx}px PatronMedium`, color: '#dfe7f2' });
  }
  await logo(ctx, W, true);
  return c.toBuffer('image/png');
}

// ----------------------------------------------------------------------------
// THEME 4 — Bold color-block, no photo (navy field, orange geo accents).
// ----------------------------------------------------------------------------
async function colorBlock(spec, size) {
  const { w: W, h: H } = size;
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = B.BRAND.navyDeep; ctx.fillRect(0, 0, W, H);
  // orange corner wedge (kept clear of the top-right logo zone)
  ctx.fillStyle = B.BRAND.orange;
  ctx.beginPath(); ctx.moveTo(W, H * 0.16); ctx.lineTo(W, H * 0.4); ctx.lineTo(W * 0.78, H * 0.16); ctx.closePath(); ctx.fill();
  // thin teal baseline
  ctx.fillStyle = B.BRAND.teal; ctx.fillRect(0, H - Math.round(H * 0.018), W, Math.round(H * 0.018));
  const padX = Math.round(W * 0.07);
  const colW = W - padX * 2;
  const isWide = W / H > 1.4;
  const hlPx = Math.round((isWide ? 0.066 : 0.084) * W);
  const parts = splitAccent(spec.headline || '', spec.accent);
  let y = Math.round(H * 0.34);
  y = paintHeadline(ctx, parts, padX, y, colW, hlPx, Math.round(hlPx * 1.05), B.BRAND.white);
  y += Math.round(hlPx * 0.45);
  divider(ctx, padX, y, isWide ? 0.9 : 1.2);
  if (spec.subtitle) {
    const subPx = Math.round((isWide ? 0.032 : 0.038) * W);
    B.drawWrapped(ctx, spec.subtitle, padX, y + Math.round(hlPx * 0.7) + subPx, colW, Math.round(subPx * 1.3),
      { font: `${subPx}px PatronMedium`, color: '#cdd7e6' });
  }
  await logo(ctx, W, true);
  return c.toBuffer('image/png');
}

// ----------------------------------------------------------------------------
// THEME 5 — Data/stat card: big number, minimal grid.
// ----------------------------------------------------------------------------
async function dataCard(spec, size) {
  const { w: W, h: H } = size;
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = B.BRAND.offwhite; ctx.fillRect(0, 0, W, H);
  // faint grid lines
  ctx.strokeStyle = 'rgba(0,46,106,0.07)'; ctx.lineWidth = 2;
  const step = Math.round(W * 0.08);
  for (let gx = step; gx < W; gx += step) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
  for (let gy = step; gy < H; gy += step) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  // navy left bar
  ctx.fillStyle = B.BRAND.navy; ctx.fillRect(0, 0, Math.round(W * 0.022), H);
  const padX = Math.round(W * 0.08);
  const colW = W - padX * 2;
  const isWide = W / H > 1.4;
  // the big stat
  const stat = spec.stat || '';
  const statPx = Math.round((isWide ? 0.14 : 0.2) * W);
  ctx.save();
  ctx.font = `${statPx}px PatronDisplay`; ctx.fillStyle = B.BRAND.orange;
  ctx.textBaseline = 'alphabetic';
  let y = Math.round(H * (isWide ? 0.42 : 0.34));
  ctx.fillText(stat, padX, y);
  ctx.restore();
  // stat label
  if (spec.statLabel) {
    const lpx = Math.round((isWide ? 0.03 : 0.036) * W);
    y = B.drawWrapped(ctx, spec.statLabel, padX, y + Math.round(lpx * 1.4), colW, Math.round(lpx * 1.3),
      { font: `${lpx}px PatronMedium`, color: B.BRAND.navy });
  }
  // headline below
  const hlPx = Math.round((isWide ? 0.04 : 0.05) * W);
  const parts = splitAccent(spec.headline || '', spec.accent);
  y += Math.round(hlPx * 0.8);
  paintHeadline(ctx, parts, padX, y + hlPx, colW, hlPx, Math.round(hlPx * 1.08), B.BRAND.navy);
  await logo(ctx, W, false);
  return c.toBuffer('image/png');
}

const THEMES = { editorialPhoto, vectorBlob, documentCloseup, colorBlock, dataCard };

// Render by theme index (0-4) — used by the rotation so each of a day's 5 posts differs.
async function renderTheme(themeIdx, spec, size) {
  const name = THEME_NAMES[((themeIdx % 5) + 5) % 5];
  return THEMES[name](spec, size);
}

module.exports = { THEMES, THEME_NAMES, renderTheme };
