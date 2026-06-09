# DEPLOY GUIDE — Patron Social Studio (read this fully)

NOTE: This build has NO login. The tool is open to anyone with the link and uses ONE shared set of keys (set in Settings or env).

This is a NODE.JS app. If Render ever shows "Rust", "Python", "Go", or "Docker"
as the runtime, that is WRONG — see the fix at the bottom.

================================================================
## A. PUT THE FILES AT THE ROOT OF THE REPO (most important)
================================================================
When you unzip this file you get these items. They must sit at the TOP LEVEL of
your GitHub repo — NOT inside a subfolder.

  server.js          <- must be at the top level
  package.json       <- must be at the top level (Render looks for this!)
  .node-version
  render.yaml
  Procfile
  .gitignore
  BATCH_DEPLOY_GUIDE.md
  public/            (folder)
  batch/             (folder)

CHECK: open your repo on github.com. You must SEE "package.json" and "server.js"
in the file list on the main repo page. If instead you see a single folder name
(like "patron-social-studio-FULL-v3"), the files are nested one level too deep —
that is why Render guessed Rust. Fix it by moving them up (see section D).

================================================================
## B. CREATE THE REPO + UPLOAD (GitHub website)
================================================================
1. github.com -> New repository (no README / .gitignore / license). Create.
2. On the empty repo: "uploading an existing file".
3. Open the unzipped folder on your computer. SELECT THE CONTENTS (server.js,
   package.json, the public folder, the batch folder, etc.) — NOT the outer
   folder itself. Drag those into GitHub.
   - Tip: drag the loose files first, then drag the "public" and "batch" folders.
4. Commit.
5. Confirm: package.json and server.js are visible on the repo main page.

================================================================
## C. DEPLOY ON RENDER
================================================================
Option 1 — Blueprint (uses render.yaml, sets Node automatically):
  Render -> New -> Blueprint -> connect the repo -> Apply.

Option 2 — Web Service (manual):
  Render -> New -> Web Service -> connect the repo, then set EXACTLY:
    Runtime / Language : Node
    Build Command      : npm install
    Start Command      : npm start
  Create Web Service.

Then add Environment variables (Render -> your service -> Environment):
    OPENAI_API_KEY        = your OpenAI key   (REQUIRED for real photos + copy)
    OPENAI_TEXT_MODEL     = gpt-4o-mini
    OPENAI_IMAGE_MODEL    = gpt-image-1
    PUBLER_API_KEY        = your Publer key
    PUBLER_WORKSPACE_ID   = your Publer workspace id
    PUBLER_BASE           = https://app.publer.com/api/v1
Save -> it redeploys. Watch Logs for: "Patron Social Studio (7-Day Batch) running".

================================================================
## D. IF RENDER SHOWS "RUST" (or Python/Go/Docker) — FIX
================================================================
That means Render did NOT find package.json at the repo root.

Quick fix in the same "Update Source" screen you are on:
  - Runtime  -> change to: Node
  - Build Command -> npm install
  - Start Command -> npm start
  - (Branch: main)  -> Deploy

Permanent fix (recommended):
  - Make sure package.json is at the TOP of the repo (section A).
  - If everything is inside a subfolder, either:
      (a) re-upload with the files at the root, OR
      (b) in Render -> Settings -> set "Root Directory" to that subfolder name.
  - Redeploy.

================================================================
## E. USING THE TOOL
================================================================
Open the Render URL. Pick Primary/Secondary/Generic focus areas, a start date,
"Days to render", and platforms. Click "Generate this week". Posts appear in a
gallery grouped by day. Each card has Regenerate (redo that image+caption) and
Schedule. "Schedule Day" queues the whole day to Publer.

FREE PLAN: limited memory + sleeps when idle. Render a few days at a time, or
upgrade to Render Starter ($7/mo) for "All 7 days".

NOTE: Without OPENAI_API_KEY it runs in PREVIEW mode (real layouts, placeholder
captions, abstract backgrounds). With a working key you get real captions and
freshly generated photo backgrounds + carousel people. Rotate exposed keys first.


================================================================
## F. EASIEST WAY TO SET KEYS — IN-APP SETTINGS (no redeploy)
================================================================
You do NOT have to use Render env vars. Once the app is live:
  1. Open the app, click "⚙ Settings" (top-right).
  2. Paste your OpenAI API key (and Publer key + workspace id).
  3. Click "Save keys", then "Test OpenAI key".
     - It tells you if TEXT and IMAGE generation both work.
     - If IMAGE says FAILED, your key cannot generate photos yet — the
       backgrounds will use the abstract fallback until you enable an image
       model (or change OPENAI_IMAGE_MODEL).
Keys saved here persist on the server (settings.json) and take priority over
env vars. NOTE on Render free tier: the disk resets on redeploy/restart, so for
permanence also set them as Render env vars; the in-app panel is best for quick
updates and testing.

IMPORTANT: generation now REQUIRES a working OpenAI key. If none is set, the
tool shows an error and opens Settings instead of silently making placeholder
posts. To intentionally see layouts without a key, tick "Preview without OpenAI".

================================================================
## H. UNIVERSAL API KEY (any provider)
================================================================
Each user pastes ONE AI key in Settings. The tool detects the provider from the
key format and auto-detects the models that key supports:
  - Google OpenAI   -> key starts with "AIzaSy"   (text + image)
  - OpenAI          -> key starts with "sk-" / "sk-proj-"  (text + image: gpt-image-1/DALL·E)
  - Anthropic       -> key starts with "sk-ant-"  (text only; images use the abstract fallback)

Flow: paste key -> "Detect models for this key" -> it shows the provider and
fills the Text/Image model dropdowns with what your key supports, auto-selecting
a sensible default. You can override either model. Then Test, then Save.
Captions and images are generated through whichever provider the key belongs to.
