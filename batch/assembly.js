// ============================================================================
// Patron Accounting — ASSEMBLY
// Ties the whole batch together:
//   buildBatch() -> for each post: generateContent (Gemini text)
//                   -> generateImage (Gemini text-free photo) when needed
//                   -> render PNG (theme painter or carousel painter)
//                   -> write image + caption into an organized output tree
//   then zip the tree and emit a manifest + a captions sheet.
//
// Offline-safe: with no GEMINI_API_KEY (or opts.mock), content comes from the
// mock generator and photo-themes fall back to a prepared city photo, so a full
// 196-post batch can be produced and inspected without a live key. On the user's
// Render/n8n box (open internet + key set) the same code calls Gemini for real.
// ============================================================================
const fs = require('fs');
const path = require('path');

const B = require('./brand'); B.ensureFonts();
const { renderCarousel } = require('./carousel');
const content = require('./content');
const { buildBatch, GMB_CITIES } = require('./planner');
// NEW: database compositor (zero image API). Replaces theme/photo image generation.
const DB = require('./db_compositor');
// NEW: title-aware rotation engine (in-memory uniqueness, no Redis).
const { createRotation } = require('./rotation');
let _rotation = null;
function rotation() {
  if (!_rotation) {
    const c = DB.catalog();
    _rotation = createRotation({
      chars: c.chars, backgrounds: c.bgs,
      decor: c.decor || [], scenes: c.scenes || [], icons: c.icons || [],
    });
  }
  return _rotation;
}

// Map a content block to the database compositor's spec.
function toDbSpec(block, post, opts) {
  const styleRotation = ['human_office','human_solid','illustration'];
  const seed = (post.day * 7 + (post.platformIdx||0) + (post.id ? post.id.length : 0));
  const bullets = block.bullets || block.points || (block.checklist || []);
  return {
    eyebrow: block.eyebrow || block.kicker || (post.focus && post.focus.label) || '',
    headline: block.headline || '',
    accent: block.headline_accent || '',
    bullets: Array.isArray(bullets) ? bullets.slice(0,4) : [],
    dueText: post.deadline ? ('Due ' + post.deadline.house) : (block.cta || ''),
    intent: post.slotIntent || '',
    schemeIdx: post.day % 3,
    seed,
    style: post.imageStyle || styleRotation[seed % styleRotation.length],
  };
}

// Map a content object's per-platform block to a render `spec` for themes.js.
function toThemeSpec(block, photo, illustration, colorIdx) {
  return {
    headline: block.headline || '',
    accent: block.headline_accent || '',
    subtitle: block.subtitle || '',
    description: block.description || '',
    stat: block.stat || deriveStat(block),
    statLabel: block.stat_label || block.subtitle || '',
    photo: photo || null,
    illustration: illustration || null,
    colorIdx: colorIdx || 0,
  };
}
// dataCard wants a short stat; if the model didn't give one, pull a number from
// the did_you_know / subtitle, else a safe generic.
function deriveStat(block) {
  const hay = `${block.did_you_know && block.did_you_know.body || ''} ${block.subtitle || ''} ${block.headline || ''}`;
  const m = hay.match(/₹?\s?\d[\d,]*\s?(?:lakh|crore|%|\/day|days?)?/i);
  return (m && m[0].trim()) || '2026-27';
}

// Map content.carousel (snake_case from the prompt) to the new carousel deck.
// Each slide gets its own fresh person photo (generated upstream in getPhoto).
function toCarouselDeck(car, persons) {
  const pick = (i) => persons[i % persons.length] || null;
  const slides = (car.slides || []).map((s, i) => ({
    n: s.n, eyebrow: s.eyebrow, headline: s.headline, accent: s.accent,
    bullets: s.bullets || [], subline: s.subline, person: pick(i + 1),
  }));
  const total = 1 + slides.length + (car.close ? 1 : 0);
  return {
    total,
    cover: {
      eyebrow: car.cover.eyebrow, headline: car.cover.headline, accent: car.cover.accent,
      subline: car.cover.subline, person: pick(0),
    },
    slides,
    close: car.close ? {
      eyebrow: car.close.eyebrow, headline: car.close.headline, accent: car.close.accent,
      subline: car.close.subline, person: pick(persons.length - 1),
    } : null,
  };
}

// Get a background for a post.
//  - GMB posts use the real, clean city photo (authentic + local).
//  - Every other photo-backed image gets a FRESH, text-free Gemini background,
//    generated from this post's own image_prompt (so no two repeat).
//  - If Gemini is unavailable or fails, we fall back to a generated abstract
//    brand-colored background (text-free) — NEVER a stored stock photo that may
//    contain baked-in text (that caused the doubled-headline problem).
async function getPhoto(post, block, opts) {
  const haveKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!opts.mock && haveKey) {
    try {
      const style = block.style_used && /[ABC]/.test(block.style_used) ? block.style_used : 'A';
      // GMB gets a city-flavored prompt; others use the post's image_prompt.
      const prompt = post.city
        ? `A bright, professional editorial photograph evoking ${cap(post.city)}, India business life (clean modern office or recognizable cityscape feel), soft daylight, right-weighted composition, calm space on the left.`
        : block.image_prompt;
      const img = await content.generateImage(prompt, { ...opts, style });
      if (img && img.buffer) return await loadBuffer(img.buffer);
    } catch (e) { /* fall through to abstract fallback */ }
  }
  // text-free abstract fallback (procedurally generated; varies per post).
  // NOTE: we intentionally do NOT use the bundled city JPGs as a fallback because
  // they contain baked-in text that would collide with the painted headline.
  return abstractBackground(post);
}

// A clean, text-free brand background generated on the fly. Varies LAYOUT and
// COLOR per post so the week looks diverse even without Gemini photos.
const { createCanvas: _cc } = require('@napi-rs/canvas');
function abstractBackground(post) {
  const W = 1200, H = 1500;
  const c = _cc(W, H); const ctx = c.getContext('2d');
  const seed = hashStr(post.id || String(Math.random()));
  const rnd = mulberry32(seed);
  // a palette of brand-true color schemes (navy / teal / orange / plum / green)
  const schemes = [
    { a: '#0b2147', b: '#16406b', accent: '#ff5f1b' },
    { a: '#0A1F3D', b: '#1c4a7e', accent: '#F6B21B' },
    { a: '#0f3b35', b: '#16a89a', accent: '#F6B21B' },   // teal
    { a: '#3a1d5e', b: '#6C4BD8', accent: '#ff5f1b' },   // plum
    { a: '#0e3a24', b: '#1FA463', accent: '#F6B21B' },   // green
    { a: '#7a2f10', b: '#ff5f1b', accent: '#0b2147' },   // orange-forward
  ];
  const s = schemes[seed % schemes.length];
  const layout = seed % 4; // 4 distinct background layouts
  // base
  if (layout === 0) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, s.a); g.addColorStop(1, s.b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (layout === 1) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, s.b); g.addColorStop(1, s.a);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (layout === 2) {
    ctx.fillStyle = s.a; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W * 0.7, H * 0.3, 80, W * 0.7, H * 0.3, H * 0.9);
    rg.addColorStop(0, s.b); rg.addColorStop(1, s.a);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = s.a; ctx.fillRect(0, 0, W, H);
  }
  // a distinct motif per layout (blob / arcs / diagonal / dot-grid)
  ctx.save();
  if (layout === 0) {
    // organic accent blob on one side
    ctx.fillStyle = s.accent; ctx.globalAlpha = 0.92;
    ctx.beginPath();
    const bx = W * (rnd() > 0.5 ? 0.7 : 0.0);
    ctx.moveTo(bx, 0);
    ctx.bezierCurveTo(bx + W * 0.1, H * 0.3, bx - W * 0.05, H * 0.55, bx + W * 0.08, H * 0.8);
    ctx.bezierCurveTo(bx + W * 0.02, H, bx + W * 0.2, H, bx + W * 0.35, H);
    ctx.lineTo(bx + W * 0.4, 0); ctx.closePath(); ctx.fill();
  } else if (layout === 1) {
    // faint concentric arcs
    ctx.globalAlpha = 0.12; ctx.strokeStyle = s.accent; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, 120 + rnd() * 360, 0, Math.PI * 2); ctx.stroke(); }
  } else if (layout === 2) {
    // bold diagonal accent wedge
    ctx.fillStyle = s.accent; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, H * 0.34); ctx.lineTo(W * 0.7, 0); ctx.closePath(); ctx.fill();
  } else {
    // subtle dot grid
    ctx.globalAlpha = 0.10; ctx.fillStyle = s.accent;
    for (let gx = 60; gx < W; gx += 70) for (let gy = 60; gy < H; gy += 70) { ctx.beginPath(); ctx.arc(gx, gy, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  // vignette so painted text reads well
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  return loadBuffer(c.toBuffer('image/png'));
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// A consistent cutout-style PERSON photo for the carousel (like the reference).
// Generated by Gemini; text-free; sits on the right side of a navy slide. If
// Gemini is unavailable, returns null and the carousel renders cleanly (navy +
// text only), still on-brand.
async function getPersonPhoto(post, opts) {
  const haveKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!opts.mock && haveKey) {
    try {
      const prompt = `A professional Indian businessperson in smart business-casual attire, warm confident expression, gesturing naturally as if explaining a point, photographed against a deep navy studio background. Upper body, framed on the RIGHT side with clean navy space on the LEFT. Soft studio lighting, sharp focus, editorial magazine quality. ABSOLUTELY NO text, letters, numbers, logos, watermarks, or signage anywhere in the image.`;
      const img = await content.generateImage(prompt, { ...opts, style: 'A' });
      if (img && img.buffer) return await loadBuffer(img.buffer);
    } catch (e) { /* fall through to no-person */ }
  }
  return null;
}

// @napi-rs/canvas loadImage from a Buffer (write temp, load, cleanup) — simplest
// robust path that works across versions.
const { loadImage } = require('@napi-rs/canvas');
async function loadBuffer(buf) {
  return await loadImage(buf);
}

// Sanitize for filenames.
function safe(s) { return String(s).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80); }

// ============================================================================
// runBatch — produce the full batch into outDir, then zip it.
// opts = { mock, apiKey, startDate, focusSel, platforms, outDir, zipPath, limit }
// `limit` (optional) caps posts for a quick smoke test.
// ============================================================================
async function runBatch(opts = {}) {
  const outDir = opts.outDir || path.join('/tmp', 'patron_batch_' + Date.now());
  fs.mkdirSync(outDir, { recursive: true });

  // Resolve models against the key's provider ONCE (ignore stale defaults from
  // a different provider, e.g. a Gemini model name left over with an OpenAI key).
  if (!opts.mock && opts.apiKey) {
    try {
      const providers = require('./providers');
      const rm = await providers.resolveModels(opts.apiKey, opts.textModel, opts.imageModel);
      opts = { ...opts, textModel: rm.textModel, imageModel: rm.imageModel };
    } catch (_) {}
  }

  const plan = buildBatch(opts);
  let posts = plan.posts;
  if (opts.limit) posts = posts.slice(0, opts.limit);

  // cache content per (day, platform[, city]) so all of a platform's daily posts
  // share one Gemini call (the legacy schema returns all platforms at once, but
  // here we drive per-cell; we still cache by the brief signature to save calls).
  const manifest = [];
  const captions = [];
  let made = 0;

  for (const post of posts) {
    const entry = await renderOnePost(post, outDir, opts.urlBase || '', opts);
    manifest.push(entry);
    captions.push(`### ${post.id}  [${post.platform}${post.city ? '/' + post.city : ''}]  day ${post.day + 1} — ${post.dateHouse}\n${entry.caption}\n`);
    made++;
    if (made % 20 === 0) console.log(`  ...rendered ${made}/${posts.length}`);
  }

  // write a manifest the server/UI reads back
  const manifestObj = {
    generated: new Date().toISOString(),
    startDate: plan.startDate.toISOString(),
    counts: plan.counts,
    mock: !!(opts.mock || !(opts.apiKey || process.env.OPENAI_API_KEY)),
    genErrors: manifest.filter(p => p.genError).length,
    posts: manifest,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifestObj, null, 2));
  fs.writeFileSync(path.join(outDir, 'captions.md'), captions.join('\n'), 'utf8');

  // NO zip — images stay on disk and are served over HTTP for the in-tool gallery.
  return { outDir, count: made, manifest, manifestObj };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Render a single post (content + image + PNG) and return its manifest entry.
// Stores a compact `_spec` so the post can be regenerated later.
async function renderOnePost(post, outDir, urlBase, opts) {
  const dayDir = path.join(outDir, `day_${post.day + 1}`, post.platform);
  fs.mkdirSync(dayDir, { recursive: true });

  const brief = {
    topic: post.topic,
    service: post.focus,
    platforms: [post.platform],
    singlePlatform: post.platform,
    city: post.city ? cap(post.city) : null,
    deadline: post.deadline ? `${post.deadline.form} due ${post.deadline.house}` : null,
    slotIntent: post.slotIntent,
    carouselPlatform: post.isCarousel ? post.platform : null,
  };

  let data, genError = null;
  try { data = await content.generateContent(brief, opts); }
  catch (e) { genError = e.message; data = content.mockContent(brief); }
  const block = data[post.platform] || {};

  const size = post.isCarousel ? B.SIZES.carousel : (B.SIZES[post.platform] || B.SIZES.instagram);
  const toUrl = (f) => urlBase + '/' + path.relative(outDir, f).split(path.sep).join('/') + '?v=' + Date.now();

  let files = [];
  if (post.isCarousel && data.carousel) {
    // Carousel: ONE theme for the whole deck — single scheme, single background,
    // and the SAME person across all slides (only their pose changes per slide).
    const slides = [];
    const car = data.carousel;
    const total = 1 + (car.slides ? car.slides.length : 0) + (car.close ? 1 : 0);
    const deckScheme = post.day % 3;
    const cat = DB.catalog();
    const deckBg = cat.bgs.length ? cat.bgs[(post.day*3) % cat.bgs.length] : undefined;
    // pick one person (CHAR_n) for the whole deck
    const persons = [...new Set(cat.chars.map(f => f.split('__')[0]))];
    const deckPerson = persons.length ? persons[(post.day) % persons.length] : null;
    const poseFor = (intent) => {
      // choose a pose for this person that matches the slide's mood
      const sel = rotation().select(intent || post.slotIntent || '');
      const want = sel.character ? sel.character.split('__').pop() : null;
      // find same fragment on the deck's person; else any pose of that person
      let pool = cat.chars.filter(f => f.startsWith(deckPerson + '__'));
      if (want){ const m = pool.find(f => f.endsWith(want)); if (m) return m; }
      return pool.length ? pool[Math.floor(Math.random()*pool.length)] : (sel.character || undefined);
    };
    let idx = 1;
    const mk = (b, intent) => ({
      eyebrow: b.eyebrow || '', headline: b.headline || '', accent: b.accent || '',
      bullets: b.bullets || [], intent: intent || post.slotIntent || '', schemeIdx: deckScheme,
      carousel: true, seed: post.day*7 + idx,
      style: 'human_office', bgFile: deckBg, charFile: poseFor(intent || post.slotIntent),
    });
    if (car.cover) slides.push(Object.assign(mk(car.cover), { page:{i:idx, n:total} }));
    (car.slides||[]).forEach(s => { idx++; slides.push(Object.assign(mk(s), { page:{i:idx, n:total} })); });
    if (car.close) { idx++; slides.push(Object.assign(mk(car.close,'growth'), { page:{i:idx, n:total} })); }
    for (let i = 0; i < slides.length; i++) {
      const buf = await DB.renderPost(slides[i], B.SIZES.carousel);
      const fn = path.join(dayDir, `${post.id}_slide${i + 1}.png`);
      fs.writeFileSync(fn, buf); files.push(fn);
    }
  } else {
    // Single post: title-aware rotation engine picks style/bg/character to match the
    // headline's mood; pose is derived from the chosen character (no contradictions).
    const title = [block.headline, block.headline_accent, block.eyebrow, (post.focus && post.focus.label)].filter(Boolean).join(' ');
    const sel = rotation().select(title);
    const spec = toDbSpec(block, post, opts);
    spec.intent = sel.intent || spec.intent;
    if (sel.mode === 'illustration') {
      spec.style = 'illustration';
      spec.sceneFile = sel.scene || undefined;
    } else {
      spec.style = 'human_office';
      spec.bgFile = sel.background || undefined;
      spec.charFile = sel.character || undefined;
      spec.anchor = sel.anchor || undefined;   // pointing-aware placement
    }
    const buf = await DB.renderPost(spec, size);
    const fn = path.join(dayDir, `${post.id}.png`);
    fs.writeFileSync(fn, buf); files.push(fn);
  }

  const capTxt = block.caption || '';
  fs.writeFileSync(path.join(dayDir, `${post.id}_caption.txt`), capTxt, 'utf8');

  return {
    id: post.id, day: post.day + 1, date: post.dateHouse, platform: post.platform,
    city: post.city, theme: post.themeName, isCarousel: post.isCarousel,
    slotType: post.slotType, role: post.role,
    slotTime: post.slotTime, scheduledAt: post.scheduledAt,
    focus: post.focus.label, slug: post.focus.slug,
    slotIntent: post.slotIntent, deadline: post.deadline ? post.deadline.house : null,
    headline: block.headline || '',
    images: files.map(toUrl),
    caption: capTxt,
    genError: genError,
    _spec: {            // enough to regenerate this exact post
      platform: post.platform, day: post.day, dateHouse: post.dateHouse,
      city: post.city, themeIdx: post.themeIdx, themeName: post.themeName,
      needsPhoto: post.needsPhoto, isCarousel: post.isCarousel,
      slotIntent: post.slotIntent, slotType: post.slotType, role: post.role,
      topic: post.topic, focus: post.focus, deadline: post.deadline,
    },
  };
}

// Regenerate one post from its stored manifest entry (fresh image + caption).
async function regenerateOne({ outDir, urlBase, post, apiKey, mock, textModel, imageModel }) {
  const spec = post._spec;
  if (!spec) throw new Error('post has no _spec to regenerate from');
  if (!mock && apiKey) {
    try { const providers = require('./providers'); const rm = await providers.resolveModels(apiKey, textModel, imageModel); textModel = rm.textModel; imageModel = rm.imageModel; } catch (_) {}
  }
  // rebuild a planner-shaped post object
  const rebuilt = {
    id: post.id,
    platform: spec.platform, day: spec.day, dateHouse: spec.dateHouse,
    city: spec.city, themeIdx: spec.themeIdx, themeName: spec.themeName,
    needsPhoto: spec.needsPhoto, isCarousel: spec.isCarousel,
    slotIntent: spec.slotIntent, slotType: spec.slotType, role: spec.role,
    topic: spec.topic, focus: spec.focus, deadline: spec.deadline,
  };
  return renderOnePost(rebuilt, outDir, urlBase, { apiKey, mock, textModel, imageModel });
}

module.exports = { runBatch, regenerateOne, renderOnePost, toThemeSpec, toCarouselDeck };
