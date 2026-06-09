// rotation.js — title-aware rotation, TWO modes, tiered asset layers, in-memory uniqueness (no Redis).
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
  const priority = ["alarm","authority","positive","explain"];
  let best="explain", bestScore=-1;
  for (const intent of priority){ if (scores[intent] > bestScore){ best=intent; bestScore=scores[intent]; } }
  return { intent:best, matched:true, scores };
}
const BUCKET_POSES = {
  alarm:     ["Frozen_Shock","Empty_Wallet","Nail_Biting","Collar_Tug","Shocked_Tax_Bill",
              "Drowning_In_Paperwork","Hands_On_Head","Panic_Phone","Shocked","Worried_Reading",
              "Stop_Caution","Facepalm_Regret"],
  authority: ["Confident_Arms_Crossed","Confident_Boss","Confident_CEO","Pointing_At_Camera",
              "Hand_On_Hip_Confident","Arms_Crossed_Confident"],
  positive:  ["OK_Sign","Thumbs_Up","Double_Thumbs_Up","Waving_Hello","Excited","Relieved"],
  explain:   ["Both_Hands_Presenting","Questioning","Thinking","Presenting_Product",
              "Holding_Phone","Pointing_Right","Holding_Documents","Pointing_Left",
              "Pointing_Up","Counting_Fingers","Explainer","Explaining"],
};
const ICONS_BY_INTENT = {
  explain:   [3,4,7,8,9,12,13,14,15,17,18,22,23,30],
  authority: [1,5,6,10,11,16,19,20,21,24,25],
  positive:  [2],
  neutral:   [26,27,28,29],
};
function readablePose(charFile){
  const stem = String(charFile).replace(/\.png$/i,"").split("__").pop();
  const parts = stem.split("_"); if (/^\d+$/.test(parts[0])) parts.shift();
  return parts.join(" ");
}
function makeUsedTracker(){
  const used = {};
  return {
    claim(dim, universe){
      if (!universe || !universe.length) return { item:null, reused:false };
      if (!used[dim]) used[dim] = new Set();
      let avail = universe.filter(x => !used[dim].has(x));
      let reused = false;
      if (!avail.length){ used[dim] = new Set(); avail = universe.slice(); reused = true; }
      const item = avail[Math.floor(Math.random()*avail.length)];
      used[dim].add(item);
      return { item, reused };
    },
    reset(){ for (const k of Object.keys(used)) delete used[k]; },
  };
}
function createRotation(pools){
  const tracker = makeUsedTracker();
  let modeFlip = 0;
  const charsByIntent = {};
  for (const [intent, frags] of Object.entries(BUCKET_POSES)){
    charsByIntent[intent] = (pools.chars||[]).filter(f =>
      frags.some(fr => f.toLowerCase().includes(fr.toLowerCase())));
    if (!charsByIntent[intent].length) charsByIntent[intent] = (pools.chars||[]).slice();
  }
  const iconsByIntent = {};
  for (const [intent, nums] of Object.entries(ICONS_BY_INTENT)){
    iconsByIntent[intent] = nums.map(n=>`${n}.png`).filter(f => (pools.icons||[]).includes(f));
  }
  return {
    analyse: analyseTitle,
    select(title, opts={}){
      const a = analyseTitle(title);
      const intent = a.intent;
      let mode = opts.mode;
      if (!mode){ modeFlip = (modeFlip+1)%4; mode = (modeFlip===0) ? "illustration" : "character"; }
      const out = { intent, analysisMatched: a.matched, mode, flags:{} };
      if (mode === "illustration"){
        const scene = tracker.claim("scene", pools.scenes||[]);
        out.scene = scene.item; out.flags.scenePoolReused = scene.reused;
        return out;
      }
      const bg = tracker.claim("bg", pools.backgrounds||[]);
      const ch = tracker.claim("char:"+intent, charsByIntent[intent]||[]);
      out.background = bg.item;
      out.character = ch.item;
      out.expressionPose = ch.item ? readablePose(ch.item) : null;
      out.flags.backgroundPoolReused = bg.reused;
      out.flags.characterPoolReused = ch.reused;
      // anchor side derived from facing/pointing so the character points INWARD toward the text:
      //   points LEFT  -> place on RIGHT   |   points RIGHT -> place on LEFT
      const cf = (ch.item||'').toLowerCase();
      if (/pointing_left/.test(cf)) out.anchor = 'right';
      else if (/pointing_right/.test(cf)) out.anchor = 'left';
      else out.anchor = null; // let renderer alternate for non-directional poses
      return out;
    },
    reset(){ tracker.reset(); },
  };
}
module.exports = { createRotation, analyseTitle };
