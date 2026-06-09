/**
 * Patron Social Studio — backend (open tool, OpenAI-only).
 * No login. Single shared key store (settings.json + env). Uses an OpenAI
 * API key (sk-...) for both caption text and image generation.
 */
const express = require("express");
const path = require("path");
const fs = require("fs");

(function loadEnv() {
  try {
    const p = path.join(__dirname, ".env");
    if (fs.existsSync(p)) for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) { console.warn("env load skipped:", e.message); }
})();

const PORT = process.env.PORT || 3000;
const KEY_NAMES = ["OPENAI_API_KEY", "OPENAI_TEXT_MODEL", "OPENAI_IMAGE_MODEL", "PUBLER_API_KEY", "PUBLER_WORKSPACE_ID", "PUBLER_BASE"];
const SETTINGS_PATH = path.join(__dirname, "settings.json");

let SETTINGS = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
  OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
  PUBLER_API_KEY: process.env.PUBLER_API_KEY || "",
  PUBLER_WORKSPACE_ID: process.env.PUBLER_WORKSPACE_ID || "",
  PUBLER_BASE: process.env.PUBLER_BASE || "https://app.publer.com/api/v1",
};
(function loadSettings() {
  try { if (fs.existsSync(SETTINGS_PATH)) { const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")); for (const k of KEY_NAMES) if (s[k] != null && s[k] !== "") SETTINGS[k] = s[k]; } }
  catch (e) { console.warn("settings load skipped:", e.message); }
})();
function saveSettings() { try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(SETTINGS, null, 2)); } catch (e) { console.warn("settings save failed:", e.message); } }
const S = (k) => SETTINGS[k] || "";

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));
const BATCHES_DIR = path.join(__dirname, "batches");
fs.mkdirSync(BATCHES_DIR, { recursive: true });
app.use("/batches", express.static(BATCHES_DIR));

const json = (res, code, obj) => res.status(code).json(obj);
const need = (v) => v && String(v).trim().length > 0;
const mask = (v) => !v ? "" : (v.length <= 8 ? "****" : v.slice(0, 4) + "…" + v.slice(-4));

app.get("/api/health", (req, res) => {
  json(res, 200, { ok: true, configured: { openai: !!need(S("OPENAI_API_KEY")), publer: !!(need(S("PUBLER_API_KEY")) && need(S("PUBLER_WORKSPACE_ID"))) } });
});

function settingsView() {
  return {
    OPENAI_API_KEY: mask(S("OPENAI_API_KEY")),
    OPENAI_TEXT_MODEL: S("OPENAI_TEXT_MODEL"),
    OPENAI_IMAGE_MODEL: S("OPENAI_IMAGE_MODEL"),
    PUBLER_API_KEY: mask(S("PUBLER_API_KEY")),
    PUBLER_WORKSPACE_ID: S("PUBLER_WORKSPACE_ID"),
    PUBLER_BASE: S("PUBLER_BASE"),
  };
}
app.get("/api/settings", (req, res) => json(res, 200, { ok: true, settings: settingsView(), hasOpenAI: !!need(S("OPENAI_API_KEY")), hasPubler: !!(need(S("PUBLER_API_KEY")) && need(S("PUBLER_WORKSPACE_ID"))) }));
app.post("/api/settings", (req, res) => {
  const b = req.body || {};
  for (const k of KEY_NAMES) if (typeof b[k] === "string" && b[k].trim() !== "" && !b[k].includes("…")) SETTINGS[k] = b[k].trim();
  saveSettings();
  json(res, 200, { ok: true, settings: settingsView(), hasOpenAI: !!need(S("OPENAI_API_KEY")), hasPubler: !!(need(S("PUBLER_API_KEY")) && need(S("PUBLER_WORKSPACE_ID"))) });
});

// ---- key test + model discovery (OpenAI) ----
app.get("/api/settings/test-openai", async (req, res) => {
  const providers = require("./batch/providers");
  const key = (req.query.key && String(req.query.key).trim()) || S("OPENAI_API_KEY");
  const textModel = (req.query.textModel && String(req.query.textModel).trim()) || S("OPENAI_TEXT_MODEL");
  const imageModel = (req.query.imageModel && String(req.query.imageModel).trim()) || S("OPENAI_IMAGE_MODEL");
  if (!need(key)) return json(res, 200, { ok: false, text: false, image: false, error: "No OpenAI key provided" });
  const out = { ok: true, provider: "openai", text: false, image: false, tested: mask(key), errors: {} };
  if (!/^sk-/.test(key)) out.warn = "This doesn't look like an OpenAI key. OpenAI keys start with 'sk-'.";
  const rm = await providers.resolveModels(key, textModel, imageModel);
  out.usingText = rm.textModel; out.usingImage = rm.imageModel;
  try { const t = await providers.generateText(key, rm.textModel, 'Reply with JSON {"ok":"yes"} only.'); out.text = !!t && /\{/.test(t); if (!out.text) out.errors.text = "empty response"; }
  catch (e) { out.errors.text = e.message; }
  try { const img = await providers.generateImage(key, rm.imageModel, "A plain solid blue square, no text."); out.image = !!(img && img.buffer); if (!out.image) out.errors.image = "no image returned (gpt-image-1 needs a verified OpenAI org; text still works, image falls back)"; }
  catch (e) { out.errors.image = e.message; }
  json(res, 200, out);
});
app.get("/api/settings/list-models", async (req, res) => {
  const providers = require("./batch/providers");
  const key = (req.query.key && String(req.query.key).trim()) || S("OPENAI_API_KEY");
  if (!need(key)) return json(res, 200, { ok: false, error: "No OpenAI key provided" });
  try {
    const r = await providers.listModels(key);
    if (!r.ok) return json(res, 200, { ok: false, provider: "openai", error: r.error });
    json(res, 200, { ok: true, provider: "openai", text: r.text, image: r.image, defaultText: providers.pickDefaultText("openai", r.text), defaultImage: providers.pickDefaultImage("openai", r.image) });
  } catch (e) { json(res, 200, { ok: false, error: e.message }); }
});

// ---- batch ----
let _batch = null;
function batchLib() { if (!_batch) { const B = require("./batch/brand"); B.ensureFonts(); _batch = { B, assembly: require("./batch/assembly"), planner: require("./batch/planner") }; } return _batch; }

app.get("/api/batch/focus", (req, res) => {
  try { const { planner } = batchLib(); const byGroup = {}; for (const f of planner.FOCUS_AREAS) (byGroup[f.group] = byGroup[f.group] || []).push({ key: f.key, label: f.label }); json(res, 200, { ok: true, groups: byGroup }); }
  catch (e) { json(res, 500, { ok: false, error: e.message }); }
});

app.post("/api/batch", async (req, res) => {
  const { assembly } = batchLib();
  const b = req.body || {};
  const hasKey = need(S("OPENAI_API_KEY"));
  if (!hasKey && !b.allowPreview) return json(res, 400, { ok: false, error: "NO_OPENAI_KEY", message: "No OpenAI API key set. Add it in Settings, or tick 'Preview without AI'." });
  const stamp = "batch_" + Date.now();
  const outDir = path.join(BATCHES_DIR, stamp);
  const opts = {
    apiKey: S("OPENAI_API_KEY"), textModel: S("OPENAI_TEXT_MODEL"), imageModel: S("OPENAI_IMAGE_MODEL"),
    mock: !hasKey,
    startDate: need(b.start) ? b.start : undefined,
    focusSel: { primary: b.primary || "", secondary: b.secondary || "", generic: b.generic || "" },
    platforms: Array.isArray(b.platforms) && b.platforms.length ? b.platforms : undefined,
    daysFilter: Array.isArray(b.days) && b.days.length ? b.days.map(Number) : undefined,
    outDir, urlBase: "/batches/" + stamp,
  };
  try { const result = await assembly.runBatch(opts); json(res, 200, { ok: true, batchId: stamp, count: result.count, mock: result.manifestObj.mock, genErrors: result.manifestObj.genErrors || 0, posts: result.manifestObj.posts }); }
  catch (e) { json(res, 500, { ok: false, error: "batch failed: " + e.message }); }
});

app.get("/api/batch/list", (req, res) => {
  try {
    const dirs = fs.readdirSync(BATCHES_DIR).filter(d => d.startsWith("batch_"));
    const out = dirs.map(d => { let posts = 0, generated = null; try { const m = JSON.parse(fs.readFileSync(path.join(BATCHES_DIR, d, "manifest.json"), "utf8")); posts = m.posts.length; generated = m.generated; } catch (_) {} return { batchId: d, posts, generated }; }).sort((a, b) => (b.generated || "").localeCompare(a.generated || ""));
    json(res, 200, { ok: true, batches: out });
  } catch (e) { json(res, 500, { ok: false, error: e.message }); }
});
app.get("/api/batch/:id", (req, res) => {
  try { const m = JSON.parse(fs.readFileSync(path.join(BATCHES_DIR, req.params.id, "manifest.json"), "utf8")); json(res, 200, { ok: true, batchId: req.params.id, posts: m.posts, mock: m.mock }); }
  catch (e) { json(res, 404, { ok: false, error: "batch not found" }); }
});
app.post("/api/batch/:id/regenerate", async (req, res) => {
  const { assembly } = batchLib();
  const mPath = path.join(BATCHES_DIR, req.params.id, "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(mPath, "utf8"));
    const idx = manifest.posts.findIndex(p => p.id === (req.body && req.body.postId));
    if (idx < 0) return json(res, 404, { ok: false, error: "post not found" });
    const updated = await assembly.regenerateOne({ apiKey: S("OPENAI_API_KEY"), textModel: S("OPENAI_TEXT_MODEL"), imageModel: S("OPENAI_IMAGE_MODEL"), mock: !need(S("OPENAI_API_KEY")), outDir: path.join(BATCHES_DIR, req.params.id), urlBase: "/batches/" + req.params.id, post: manifest.posts[idx] });
    manifest.posts[idx] = updated; fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
    json(res, 200, { ok: true, post: updated });
  } catch (e) { json(res, 500, { ok: false, error: "regenerate failed: " + e.message }); }
});

// ---- publer ----
function publerHeaders() { return { "Content-Type": "application/json", Authorization: "Bearer-API " + S("PUBLER_API_KEY"), "Publer-Workspace-Id": S("PUBLER_WORKSPACE_ID") }; }
function publerBase() { return S("PUBLER_BASE") || "https://app.publer.com/api/v1"; }

app.get("/api/publer/accounts", async (req, res) => {
  if (!need(S("PUBLER_API_KEY"))) return json(res, 400, { ok: false, error: "PUBLER_API_KEY not set" });
  try { const r = await fetch(`${publerBase()}/accounts`, { headers: publerHeaders() }); const data = await r.json(); if (!r.ok) throw new Error(data.error || ("Publer HTTP " + r.status)); const accounts = (Array.isArray(data) ? data : data.accounts || []).map(a => ({ id: a.id, name: a.name || a.username, provider: a.provider || a.type })); json(res, 200, { ok: true, accounts }); }
  catch (e) { json(res, 502, { ok: false, error: e.message }); }
});
async function publerUploadMedia(imageUrl) {
  const r = await fetch(`${publerBase()}/media/from-url`, { method: "POST", headers: publerHeaders(), body: JSON.stringify({ media: [{ url: imageUrl }], type: "single", direct_upload: false, in_library: false }) });
  const data = await r.json();
  if (!r.ok) throw new Error("media upload: " + (data.error || JSON.stringify(data)));
  const jobId = data.job_id || data.id;
  if (!jobId) { const m = (data.media && data.media[0]) || (data.data && data.data.media && data.data.media[0]); if (m && m.id) return m.id; throw new Error("media upload returned no job/id"); }
  for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 1200)); const jr = await fetch(`${publerBase()}/job_status/${jobId}`, { headers: publerHeaders() }); const jd = await jr.json(); const status = jd.status || (jd.data && jd.data.status); const payload = jd.payload || (jd.result && jd.result.payload) || (jd.data && jd.data.result && jd.data.result.payload); if (status === "complete" || status === "completed") { const media = (payload && (payload.media || payload.medias)) || []; const id = Array.isArray(media) ? (media[0] && (media[0].id || media[0]._id)) : (media.id); if (id) return id; if (payload && Array.isArray(payload.ids) && payload.ids[0]) return payload.ids[0]; throw new Error("media job complete but no id"); } if (status === "failed" || (payload && payload.failures)) throw new Error("media job failed"); }
  throw new Error("media upload timed out");
}
app.post("/api/publer/schedule", async (req, res) => {
  if (!need(S("PUBLER_API_KEY"))) return json(res, 400, { ok: false, error: "PUBLER_API_KEY not set" });
  const { accountId, provider, text, imageUrl, scheduledAt } = req.body || {};
  if (!need(accountId)) return json(res, 400, { ok: false, error: "accountId required" });
  if (!need(text)) return json(res, 400, { ok: false, error: "text required" });
  const net = (provider || "default").toLowerCase();
  const imageRequired = ["instagram", "pinterest"].includes(net);
  try {
    let mediaId = null, mediaErr = null;
    if (imageUrl) { try { mediaId = await publerUploadMedia(imageUrl); } catch (e) { mediaErr = e.message; } }
    if (imageRequired && !mediaId) return json(res, 502, { ok: false, error: "image upload failed for " + net + " (needs an image). " + (mediaErr || "Publer couldn't fetch the image — app must be public + awake.") });
    const network = { type: mediaId ? "photo" : "status", text };
    if (mediaId) network.media = [{ id: mediaId, type: "image" }];
    const account = { id: accountId }; if (scheduledAt) account.scheduled_at = scheduledAt;
    const body = { bulk: { state: scheduledAt ? "scheduled" : "draft" }, posts: [{ networks: { [net]: network }, accounts: [account] }] };
    const r = await fetch(`${publerBase()}/posts/schedule`, { method: "POST", headers: publerHeaders(), body: JSON.stringify(body) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || JSON.stringify(data));
    json(res, 200, { ok: true, job_id: data.job_id || data.id || null, mediaId });
  } catch (e) { json(res, 502, { ok: false, error: e.message }); }
});

app.listen(PORT, "0.0.0.0", () => console.log(`\nPatron Social Studio (OpenAI) running -> http://localhost:${PORT}\n`));
