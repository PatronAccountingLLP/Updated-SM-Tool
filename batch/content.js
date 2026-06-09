// ============================================================================
// Patron Accounting — CONTENT ENGINE
// Ports the full legacy system prompt (the crown-jewel IP) and wires it to
// Gemini with a robust caller + model fallback (the fix for the recurring
// "contents is not specified" Bad Request seen in the n8n build).
//
// Exposes:
//   buildSystemPrompt(brief)          -> the full legacy prompt string for a brief
//   generateContent(brief, opts)      -> per-platform JSON (caption/headline/.../carousel)
//   generateImage(imagePrompt, opts)  -> { dataUrl, buffer } text-free photo (base64 PNG)
//
// A "brief" = {
//   topic, service: {label, slug, themes}, platforms:[...], singlePlatform?,
//   city?, deadline?, slotIntent?  // 'COMPLIANCE'|'ITR'|'SERVICE'|'NEWS'|'CHECKLIST'
// }
//
// NETWORK NOTE: the sandbox cannot reach Gemini. These callers are written for
// the user's Render/n8n environment (open internet). In the sandbox we expose a
// MOCK path (opts.mock=true or no GEMINI_API_KEY) so the planner/assembly can be
// fully tested end-to-end without a live key.
// ============================================================================
const fs = require('fs');
const path = require('path');
const providers = require('./providers');


const FIRM = {
  name: 'Patron Accounting LLP',
  founder: 'CA Sundram Gupta (FCA)',
  website: 'patronaccounting.com',
  phone: '+91 94594 56700',
  email: 'sales@patronaccounting.com',
  tagline: 'Partner You Can Rely On',
  cities: ['Pune', 'Mumbai', 'Delhi', 'Gurugram'],
};

const PLAT_LABELS = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn',
  gmb: 'Google Business Profile', twitter: 'Twitter/X', pinterest: 'Pinterest',
};

// ----------------------------------------------------------------------------
// The legacy system prompt, loaded from disk and parameterised per brief.
// We read LEGACY_SYSTEM_PROMPT.txt and substitute the few runtime tokens it
// references (${singlePlatform}, ${platforms...}, ${brief...}, ${BRAND...}).
// ----------------------------------------------------------------------------
let _legacyRaw = null;
function legacyRaw() {
  if (_legacyRaw == null) {
    _legacyRaw = fs.readFileSync(path.join(__dirname, 'LEGACY_SYSTEM_PROMPT.txt'), 'utf8');
  }
  return _legacyRaw;
}

// Build the per-platform JSON schema block the legacy prompt expects.
function schemaBlock(platforms, singlePlatform) {
  const fields = `{ "caption": "...", "hashtags": ["#..."], "image_prompt": "...", "headline": "...", "headline_accent": "...", "subtitle": "...", "description": "...", "pill_labels": ["...","...","..."], "did_you_know": { "label": "Did you know?", "body": "..." }, "style_used": "A" }`;
  if (singlePlatform) {
    return `{\n  "${singlePlatform}": ${fields}\n}\n\nSINGLE-PLATFORM MODE: this brief is for ONE platform only - ${PLAT_LABELS[singlePlatform] || singlePlatform}. Return JSON with ONLY the "${singlePlatform}" key.`;
  }
  return `{\n${platforms.map(p => `  "${p}": ${fields}`).join(',\n')}\n}`;
}

// Carousel addendum: when the brief needs a carousel, ask for a slides array too.
function carouselSchema(platform) {
  return `

CAROUSEL MODE for ${PLAT_LABELS[platform] || platform}: in addition to the "${platform}" object above, add a "carousel" key with this exact shape (7 slides total: 1 cover + 5 body slides + 1 close). The visual is a bold navy slide with a person photo on the right and a big white headline on the left, where ONE key phrase is highlighted in an orange box.
{
  "carousel": {
    "cover":  { "eyebrow": "short ALL-CAPS label 2-4 words (e.g. TAX REGIME 2026-27)", "headline": "punchy headline 3-7 words, the hook/question", "accent": "1-2 words from headline to highlight in orange", "subline": "sentence-case promise of what the swipe delivers, 6-12 words" },
    "slides": [
      { "n": 1, "eyebrow": "ALL-CAPS micro label", "headline": "3-8 word bold statement", "accent": "1-2 words to highlight orange", "bullets": ["short pill point 2-4 words","short pill point 2-4 words","short pill point 2-4 words"], "subline": "one supporting line 6-12 words" },
      { "n": 2, ... }, { "n": 3, ... }, { "n": 4, ... }, { "n": 5, ... }
    ],
    "close": { "eyebrow": "ALL-CAPS label", "headline": "3-7 word closing line", "accent": "1-2 words orange", "subline": "soft sign-off, 6-12 words" }
  }
}
CAROUSEL CONTENT RULES: same typography + accuracy rules as captions (no em dashes, no markdown, no invented sections/amounts, house date format). The "bullets" are SHORT pill labels (2-4 words each), not sentences, and are optional on slides where a checklist does not fit (use an empty array []). The cover poses the hook; each body slide delivers ONE concrete real point; the close is a soft sign-off. NO phone number, NO email, NO website, NO "DM us", NO fee/discount language anywhere in the carousel (slides carry the logo only).`;
}

// Assemble the full prompt for one brief.
function buildSystemPrompt(brief) {
  const platforms = brief.platforms || ['facebook', 'instagram', 'linkedin', 'gmb', 'twitter', 'pinterest'];
  const singlePlatform = brief.singlePlatform || null;
  const ctaUrl = `${FIRM.website}${(brief.service && brief.service.slug) || ''}`;

  // Runtime lines the legacy prompt interpolates.
  const disclaimerLine = 'Do not give individualised tax advice or promise outcomes; keep everything educational and generally applicable.';
  const deadlineLine = brief.deadline
    ? `This post is date-anchored to a real deadline: ${brief.deadline}. Lead with the date (house format) and what is due.`
    : 'No specific deadline is attached to this post; do not invent one.';

  const head = legacyRaw();

  // The legacy file embeds template markers; we append a concrete CONTEXT block
  // and the resolved SCHEMA so the model gets an unambiguous instruction set.
  const context = `

═══════════════════════════════════════════════════════════════════════════
THIS BRIEF (resolve everything above against these concrete values)
═══════════════════════════════════════════════════════════════════════════
TOPIC: ${brief.topic}
SERVICE / FOCUS AREA: ${(brief.service && brief.service.label) || 'general compliance'} ${(brief.service && brief.service.themes) ? '(' + brief.service.themes + ')' : ''}
SERVICE PAGE SLUG (for the closing line only): ${ctaUrl}
${brief.city ? 'CITY ANCHOR (use naturally, especially for GMB): ' + brief.city : ''}
SLOT INTENT: ${brief.slotIntent || 'SERVICE'}  (apply the matching SLOT_INTENT hook guidance)
PLATFORMS TO WRITE: ${platforms.join(', ')}
${disclaimerLine}
${deadlineLine}

OUTPUT — return ONLY this JSON object, no code fences, no preamble:
${schemaBlock(platforms, singlePlatform)}${brief.carouselPlatform ? carouselSchema(brief.carouselPlatform) : ''}`;

  return head + context;
}

// Strip stray code fences and parse JSON safely.
function parseJsonLoose(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  // grab the outermost {...}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

// Generate per-platform content for a brief (OpenAI).
async function generateContent(brief, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (opts.mock || !apiKey) return mockContent(brief);
  const prompt = buildSystemPrompt(brief);
  const text = await providers.generateText(apiKey, opts.textModel, prompt);
  return parseJsonLoose(text);
}

// ----------------------------------------------------------------------------
// Image generation — a TEXT-FREE editorial photo per the legacy STYLE A/B/C
// rules. Returns base64 dataUrl + raw buffer. The canvas paints all typography.
// ----------------------------------------------------------------------------
const TEXTFREE_GUARD = 'ABSOLUTE RULE: the image must contain ZERO readable letters, words, numbers, dates, brand names, signage, posters, captions, or watermarks. Any documents or screens are visually blank or filled only with abstract horizontal lines and shape blocks. The image is a real professional editorial photograph (Forbes India / Mint / Bloomberg India feel), sharp edge to edge, no flat-vector, no infographic, no 3D render.';

function fullImagePrompt(imagePrompt, style) {
  const styleNote = {
    A: 'Bright airy editorial composition, subject weighted to the RIGHT 55-65% of the frame, LEFT 35-45% kept calm and light (soft wall, pale wood, window glow) so a white panel can sit over it. f/4-f/5.6, soft daylight, magazine finish.',
    B: 'Wider environmental editorial photograph (office floor, building exterior, workplace), bright natural light, main interest weighted RIGHT, calmer LEFT zone.',
    C: 'Tight close-up detail photograph (hands on a document, pen on contract, seal on certificate, fingertips on a calculator), shallow but clean focus, bright editorial grade.',
  }[style || 'A'];
  return `${imagePrompt}\n\nSTYLE: ${styleNote}\n\n${TEXTFREE_GUARD}`;
}

async function generateImage(imagePrompt, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  const style = opts.style || 'A';
  if (opts.mock || !apiKey) return null; // caller falls back to abstract background
  return providers.generateImage(apiKey, opts.imageModel, fullImagePrompt(imagePrompt, style));
}

// ----------------------------------------------------------------------------
// MOCK content — deterministic, schema-correct, used for offline testing of the
// planner/renderer/assembly. Mirrors the legacy schema closely enough to render.
// ----------------------------------------------------------------------------
function mockContent(brief) {
  const platforms = brief.platforms || ['facebook', 'instagram', 'linkedin', 'gmb', 'twitter', 'pinterest'];
  const label = (brief.service && brief.service.label) || brief.topic;
  const slug = (brief.service && brief.service.slug) || '';
  const out = {};
  const angles = {
    facebook: { headline: `${label.toUpperCase()}: WHAT CHANGES THIS QUARTER`, accent: 'THIS QUARTER' },
    instagram: { headline: `${label.toUpperCase()} GUIDE FOR FY 2026-27`, accent: 'FY 2026-27' },
    linkedin: { headline: `${label.toUpperCase()}: THE COMPLIANCE VIEW`, accent: 'COMPLIANCE VIEW' },
    gmb: { headline: `${label.toUpperCase()} IN ${(brief.city || 'PUNE').toUpperCase()}`, accent: (brief.city || 'PUNE').toUpperCase() },
    twitter: { headline: `${label.toUpperCase()}: ONE THING TO CHECK`, accent: 'CHECK' },
    pinterest: { headline: `${label.toUpperCase()} CHECKLIST 2026`, accent: 'CHECKLIST 2026' },
  };
  for (const p of platforms) {
    const a = angles[p] || { headline: label.toUpperCase(), accent: '' };
    out[p] = {
      caption: `[mock] Insight-led opening about ${brief.topic}. Body explains the rule with one real reference. Patron's team handles ${label} across Pune, Mumbai, Delhi, Gurugram. ${FIRM.website}${slug} #PatronAccounting`,
      hashtags: ['#PatronAccounting', '#IndianTax'],
      image_prompt: `A bright editorial photograph related to ${label}: a clean Indian office desk with blank documents, a calculator and a pen, soft daylight, right-weighted composition.`,
      headline: a.headline,
      headline_accent: a.accent,
      subtitle: `Applies to businesses and professionals dealing with ${label.toLowerCase()} this financial year.`,
      description: `A concrete, topic-anchored fact about ${label.toLowerCase()} that adds professional value beyond the headline.`,
      pill_labels: ['Compliance', label.split(' ')[0], '2026'],
      did_you_know: { label: 'Did you know?', body: `Over nine crore income tax returns are filed in India each year, making timely ${label.toLowerCase()} compliance essential.` },
      style_used: 'A',
    };
  }
  if (brief.carouselPlatform) {
    out.carousel = {
      cover: { eyebrow: (label.toUpperCase() + ' 2026-27').slice(0, 28), headline: `${label.split(' ')[0]}: WHICH IS BETTER?`, accent: 'BETTER', subline: `${5} things to check before your next ${label.toLowerCase()} step.` },
      slides: [1, 2, 3, 4, 5].map(n => ({
        n,
        eyebrow: `POINT ${n}`,
        headline: `KEY POINT ${n} ON ${label.split(' ')[0].toUpperCase()}`,
        accent: `POINT ${n}`,
        bullets: ['Bigger savings', 'Worth the effort', 'Check each year'],
        subline: `A concrete, real point number ${n} about ${label.toLowerCase()}.`,
      })),
      close: { eyebrow: 'YOUR MOVE', headline: 'FOLLOW FOR MORE', accent: 'FOLLOW', subline: 'Follow Patron Accounting LLP for season-long tax wins.' },
    };
  }
  return out;
}

module.exports = {
  FIRM, PLAT_LABELS,
  buildSystemPrompt, schemaBlock, carouselSchema,
  generateContent, generateImage, fullImagePrompt,
  parseJsonLoose, mockContent,
};
