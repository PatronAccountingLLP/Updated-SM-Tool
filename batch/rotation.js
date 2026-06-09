// rotation.js — title-aware, mood-matched image selection with in-memory uniqueness.
// Ported from the Redis rotation-engine, but state is held in-process (no Redis).
// Suitable for batch generation in a single service. Uniqueness holds within a run;
// it resets on process restart (fine for weekly batches). Same honest flags surfaced.

// ---- Title analysis (keyword classifier, offline) --------------------------
const INTENT_KEYWORDS = {
  alarm: ["due","deadline","notice","penalty","late","last date","alert","missed",
          "overdue","fine","warning","urgent","expiry","expire","reminder","act now",
          "demand","scrutiny","default","disallow","interest","prosecution"],
  authority: ["expert","why choose","best","top","trusted","leading","registration",
              "licence","license","certified","authorised","authorized","approved by",
              "ca team","compliance","audit","incorporation","govt"],
  positive: ["benefit","benefits","save","saving","refund","success","easy","fast",
             "quick","done","approved","claim","get","unlock","grow","growth","boost"],
  explain: ["checklist","what is","documents","document","process","step","steps",
            "requirement","requirements","types","type","difference","explained",
            "guide","how to","meaning","procedure","format","list of"],
};
function countKeyword(text, kw){
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, "i").test(text) ? 1 : 0;
}
function analyseTitle(rawTitle){
  const t = (rawTitle||"").toLowerCase();
  const scores = {}; let total = 0;
  for (const [intent, kws] of Object.entries(INTENT_KEYWORDS)){
    scores[intent] = kws.reduce((n,kw)=>n+countKeyword(t,kw),0); total += scores[intent];
  }
  if (total === 0) return { intent:"explain", matched:false, scores };
  const priority = ["alarm","authority","positive","explain"]; // urgency wins ties
  let best="explain", bestScore=-1;
  for (const intent of priority){ if (scores[intent] > bestScore){ best=intent; bestScore=scores[intent]; } }
  return { intent:best, matched:true, scores };
}

// ---- Character mood buckets (real filenames; pose is encoded in the name) ----
// These are pose-name fragments matched against CHAR_{n}__NN_PoseName.png files.
const BUCKET_POSES = {
  alarm:     ["Frozen_Shock","Empty_Wallet","Nail_Biting","Collar_Tug","Shocked_Tax_Bill",
              "Drowning_In_Paperwork","Hands_On_Head","Panic_Phone","Shocked","Worried_Reading","Stop_Caution"],
  authority: ["Confident_Arms_Crossed","Confident_Boss","Confident_CEO","Pointing_At_Camera",
              "Hand_On_Hip_Confident","Arms_Crossed_Confident"],
  positive:  ["OK_Sign","Thumbs_Up","Double_Thumbs_Up","Waving_Hello","Excited","Relieved"],
  explain:   ["Both_Hands_Presenting","Questioning","Facepalm_Regret","Thinking","Presenting_Product",
              "Holding_Phone","Finger_To_Lips","Pointing_Right","Holding_Documents","Pointing_Left",
              "Pointing_Up","Counting_Fingers","Explainer","Explaining"],
};
const STYLE_POOL = ["human_office","human_solid","illustration"];

// ---- In-memory uniqueness: a "used" set per dimension that refills when empty ----
function makeUsedTracker(){
  const used = {}; // dim -> Set of used items
  return {
    claim(dim, universe){
      if (!universe || !universe.length) return { item:null, reused:false };
      if (!used[dim]) used[dim] = new Set();
      let avail = universe.filter(x => !used[dim].has(x));
      let reused = false;
      if (!avail.length){ used[dim] = new Set(); avail = universe.slice(); reused = true; } // refill
      const item = avail[Math.floor(Math.random()*avail.length)];
      used[dim].add(item);
      return { item, reused };
    },
    reset(){ for (const k of Object.keys(used)) delete used[k]; },
  };
}

// poseFragment -> readable label, e.g. "Panic_Phone_Due_Alert" -> "Panic Phone Due Alert"
function readablePose(charFile){
  const stem = String(charFile).replace(/\.png$/i,"").split("__").pop();
  const parts = stem.split("_"); if (/^\d+$/.test(parts[0])) parts.shift();
  return parts.join(" ");
}

// Build a RotationEngine bound to the actual character files available in the catalog.
// `catalogChars` = array of filenames like "CHAR_2__10_Shocked.png".
function createRotation(catalogChars, backgrounds){
  const tracker = makeUsedTracker();
  // map each mood bucket to the real character files that match its pose fragments
  const charsByIntent = {};
  for (const [intent, frags] of Object.entries(BUCKET_POSES)){
    charsByIntent[intent] = (catalogChars||[]).filter(f =>
      frags.some(fr => f.toLowerCase().includes(fr.toLowerCase())));
    if (!charsByIntent[intent].length) charsByIntent[intent] = (catalogChars||[]).slice(); // safety
  }
  return {
    analyse: analyseTitle,
    // title -> full selection spec (character, background, style, pose, flags)
    select(title){
      const a = analyseTitle(title);
      const intent = a.intent;
      const style = tracker.claim("style", STYLE_POOL);
      const bg    = tracker.claim("bg", backgrounds||[]);
      const ch    = tracker.claim("char:"+intent, charsByIntent[intent]||[]);
      return {
        intent,
        analysisMatched: a.matched,
        style: style.item,
        background: bg.item,
        character: ch.item,
        expressionPose: ch.item ? readablePose(ch.item) : null,
        flags: { characterPoolReused: ch.reused, styleReused: style.reused, bgReused: bg.reused },
      };
    },
    reset(){ tracker.reset(); },
  };
}

module.exports = { createRotation, analyseTitle };
