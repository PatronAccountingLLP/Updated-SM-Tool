// ============================================================================
// OpenAI-only AI layer. The tool uses a single OpenAI API key (sk-...).
// Exposes: listModels(key), generateText(...), generateImage(...),
// resolveModels(...), pickDefaultText/Image — same interface the rest of the
// app already calls, so nothing else needs to change.
// ============================================================================

const OPENAI_BASE = "https://api.openai.com/v1";

function detectProvider() { return "openai"; } // always OpenAI now

// ---- model discovery -------------------------------------------------------
async function listModels(key) {
  try {
    const r = await fetch(`${OPENAI_BASE}/models`, { headers: { Authorization: "Bearer " + key } });
    const data = await r.json();
    if (!r.ok) return { ok: false, provider: "openai", error: (data.error && data.error.message) || ("HTTP " + r.status) };
    const ids = (data.data || []).map(m => m.id);
    const image = ids.filter(id => /^(gpt-image|dall-e)/.test(id)).sort();
    const text = ids.filter(id => /^(gpt-4|gpt-4o|gpt-4\.1|o1|o3|o4|gpt-5|chatgpt)/.test(id) && !/audio|realtime|transcribe|tts|embedding/.test(id)).sort();
    return { ok: true, provider: "openai", text, image };
  } catch (e) { return { ok: false, provider: "openai", error: e.message }; }
}

function pickDefaultText(_p, list) {
  if (!list || !list.length) return "gpt-4o-mini";
  for (const re of [/^gpt-4o-mini$/, /^gpt-4o$/, /^gpt-4\.1-mini$/, /gpt-4/, /^o/]) { const m = list.find(x => re.test(x)); if (m) return m; }
  return list[0];
}
function pickDefaultImage(_p, list) {
  if (!list || !list.length) return "gpt-image-1";
  for (const re of [/^gpt-image-1$/, /^dall-e-3$/, /image/]) { const m = list.find(x => re.test(x)); if (m) return m; }
  return list[0];
}

// Validate/normalize saved models (must be OpenAI names). Returns {provider,textModel,imageModel}.
async function resolveModels(key, textModel, imageModel) {
  const looksOpenAI = /^(gpt|dall-e|o\d|chatgpt)/i;
  let tm = (textModel && looksOpenAI.test(textModel)) ? textModel : "";
  let im = (imageModel && looksOpenAI.test(imageModel)) ? imageModel : "";
  if (!tm || !im) {
    try { const r = await listModels(key); if (r.ok) { if (!tm) tm = pickDefaultText("openai", r.text); if (!im) im = pickDefaultImage("openai", r.image); } } catch (_) {}
  }
  if (!tm) tm = "gpt-4o-mini";
  if (!im) im = "gpt-image-1";
  return { provider: "openai", textModel: tm, imageModel: im };
}

// ---- text generation (returns a JSON string the caller parses) -------------
async function generateText(key, model, prompt) {
  const m = model || "gpt-4o-mini";
  const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: m, messages: [{ role: "user", content: prompt }], temperature: 0.7, response_format: { type: "json_object" } }),
  });
  if (!r.ok) {
    // some models reject response_format; retry without it
    const r2 = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: m, messages: [{ role: "user", content: prompt + "\n\nReturn ONLY valid JSON, no markdown." }], temperature: 0.7 }),
    });
    if (!r2.ok) throw new Error(`OpenAI text ${m} HTTP ${r2.status}: ${(await r2.text()).slice(0, 300)}`);
    const d2 = await r2.json();
    return (d2.choices && d2.choices[0] && d2.choices[0].message && d2.choices[0].message.content) || "";
  }
  const d = await r.json();
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
}

// ---- image generation (returns {buffer} or null) ---------------------------
async function generateImage(key, model, prompt) {
  const m = model || "gpt-image-1";
  try {
    const r = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: m, prompt, n: 1, size: "1024x1024" }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const item = d.data && d.data[0];
    if (item && item.b64_json) return { buffer: Buffer.from(item.b64_json, "base64") };
    if (item && item.url) { try { const ir = await fetch(item.url); return { buffer: Buffer.from(await ir.arrayBuffer()) }; } catch (_) {} }
    return null;
  } catch (e) { return null; }
}

module.exports = { detectProvider, listModels, generateText, generateImage, pickDefaultText, pickDefaultImage, resolveModels };
