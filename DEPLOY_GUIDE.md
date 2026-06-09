# Patron Social Studio — Deploy Guide (GitHub → Render)

This app generates branded social posts for Patron Accounting from a **local image
database** (50 characters, 20 backgrounds, 120 illustrations, logo). **No image API.**
Only captions use OpenAI (text, a few cents/month). Publer scheduling is optional.

---

## What you need
- A GitHub account
- A Render account (render.com) — free plan works to start
- An OpenAI API key (for captions) — https://platform.openai.com/api-keys
- (Optional) Publer API key + Workspace ID for scheduling

---

## Step 1 — Put this code on GitHub
From this folder (the one containing `server.js`):

```
git init
git add .
git commit -m "Patron Social Studio v4 — database compositor"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/patron-social-studio.git
git push -u origin main
```
(Create the empty repo on github.com first, then use its URL above.)

> The image database is bundled in `batch/assets_db/` and committed with the code,
> so Render has everything it needs. No separate asset upload.

---

## Step 2 — Deploy on Render
1. render.com → **New** → **Blueprint**.
2. Connect your GitHub and pick the `patron-social-studio` repo.
3. Render reads `render.yaml` and creates the web service automatically.
4. When prompted, paste your secrets:
   - `OPENAI_API_KEY` = your sk-... key  (required for captions)
   - `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID` = only if using Publer
5. Click **Apply**. First build takes a few minutes (installs @napi-rs/canvas).
6. When live, open the Render URL. The app UI loads.

> Free plan note: image rendering runs on the server. The free plan can render a
> few days of posts at a time. For a full batch in one click, change `plan: free`
> to `plan: starter` in `render.yaml`.

---

## Step 3 — Use it
- Open the app URL → pick focus topics / days → **Generate**.
- Images render from the database (4 styles auto-rotate: human-on-office,
  human-on-solid, illustration). Captions come from OpenAI.
- Gallery shows results; regenerate any post; schedule via Publer if configured.

---

## How it works (for whoever maintains it)
- `batch/db_compositor.js` — the image engine. Renders a post from
  background + character/illustration + brand layer (logo, headline, pills).
  Pose matches the **headline tone** (confident vs worried). Styles rotate.
- `batch/assembly.js` — orchestrates planner → caption text → compositor → files.
- `batch/providers.js` — OpenAI **text** (captions). Image generation removed.
- `batch/assets_db/` — the bundled database (characters/backgrounds/illustrations/logo).
- `server.js` — Express API + serves the UI and generated files.

### To add or change images
Drop PNGs into `batch/assets_db/`:
- characters: `CHAR_{1-5}__NN_PoseName.png` (transparent; pose name drives matching)
- backgrounds: any office/scene PNG
- illustrations: `V_*` vectors, `I_*` icons
Commit + push; Render redeploys.

### Env vars (set in Render dashboard)
- `OPENAI_API_KEY` (required, captions)
- `OPENAI_TEXT_MODEL` (default gpt-4o-mini)
- `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`, `PUBLER_BASE` (optional, scheduling)
- `DB_ASSETS` (optional; defaults to bundled batch/assets_db)

---

## Known limitations (honest)
- Logo is the original transparent mark everywhere; it reads faint on dark/solid
  backgrounds (a white-on-dark variant was offered but not enabled).
- Illustration & "text" styles currently use a solid brand background; rendering them
  on the geometric/illustration backgrounds was requested and is not yet built.
- Portrait posts place text to the side opposite the (large) character; this is a
  layout tradeoff, tune in db_compositor.js if you prefer full-width text.
- Caption quality depends on OpenAI; without a key the app falls back to mock text
  (fine for layout, not for publishing).
