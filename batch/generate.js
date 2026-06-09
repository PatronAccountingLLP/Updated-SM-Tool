#!/usr/bin/env node
// ============================================================================
// Patron Accounting — batch generator CLI
//
//   node generate.js [options]
//
// Options (all optional):
//   --start=YYYY-MM-DD     batch start date (default: next Monday)
//   --primary=<key>        focus-area catalog key for Primary slots
//   --secondary=<key>      catalog key for Secondary slots
//   --generic=<key>        catalog key for Generic slots
//   --platforms=a,b,c      subset of: instagram,linkedin,facebook,pinterest,twitter,gmb
//   --limit=N              only render the first N posts (smoke test)
//   --mock                 force mock mode (no Gemini calls)
//   --out=/path/dir        output directory
//
// Real generation requires env GEMINI_API_KEY (and optionally GEMINI_TEXT_MODEL,
// GEMINI_IMAGE_MODEL). Without a key it runs in mock mode automatically.
//
// List catalog keys:  node generate.js --list-focus
// ============================================================================
const B = require('./brand'); B.ensureFonts();
const { runBatch } = require('./assembly');
const { FOCUS_AREAS } = require('./planner');

function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
}
const flag = (name) => process.argv.includes(`--${name}`);

if (flag('list-focus')) {
  const byGroup = {};
  for (const f of FOCUS_AREAS) (byGroup[f.group] = byGroup[f.group] || []).push(f);
  for (const g of Object.keys(byGroup)) {
    console.log(`\n== ${g} ==`);
    for (const f of byGroup[g]) console.log(`  ${f.key}\t${f.label}`);
  }
  process.exit(0);
}

(async () => {
  const opts = {
    mock: flag('mock'),
    startDate: arg('start', undefined),
    focusSel: {
      primary: arg('primary', ''),
      secondary: arg('secondary', ''),
      generic: arg('generic', ''),
    },
    platforms: arg('platforms', '') ? arg('platforms', '').split(',') : undefined,
    limit: arg('limit', '') ? parseInt(arg('limit', ''), 10) : undefined,
    outDir: arg('out', undefined),
  };
  const hasKey = !!process.env.GEMINI_API_KEY;
  console.log(`Patron batch generator — ${opts.mock || !hasKey ? 'MOCK mode' : 'LIVE (Gemini)'}`);
  const t = Date.now();
  const r = await runBatch(opts);
  console.log(`\nDone. ${r.count} posts in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log(`Folder: ${r.outDir}`);
  console.log(`Zip:    ${r.zipPath}`);
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
