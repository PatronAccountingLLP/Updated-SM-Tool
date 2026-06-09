const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs'), path = require('path');

const ASSETS = process.env.DB_ASSETS || path.join(__dirname, 'assets_db');
const CHAR_DIR = path.join(ASSETS, 'characters');
const BG_DIR   = path.join(ASSETS, 'backgrounds');
const ILL_DIR  = path.join(ASSETS, 'illustrations');
const LOGO     = path.join(ASSETS, 'logo.png');

const C = { navy:'#0b2147', navy2:'#0f2a55', orange:'#ff5f1b', yellow:'#F6B21B', teal:'#16a89a', white:'#ffffff', cloud:'#eef2f8' };
const SCHEMES = [
  { accent:C.orange, pill:C.yellow, solid:'#0b2147' },
  { accent:C.yellow, pill:C.teal,   solid:'#0f2a55' },
  { accent:C.teal,   pill:C.orange, solid:'#10243f' },
];
// The four post styles
const STYLES = ['human_office','human_solid','illustration'];

const MOOD = {
  warn:   ['Shocked','Worried','Panic','Frozen','Facepalm','Empty_Wallet','Drowning','Overwhelmed','Collar_Tug','Nail_Biting','Stop_Caution','Tax_Bill','Due_Alert','Income_Tax_Notice'],
  howto:  ['Explaining','Explainer','Presenting','Pointing','Holding_Phone','Holding_Documents','Counting','Thinking','Questioning'],
  growth: ['Thumbs_Up','Double_Thumbs','OK_Sign','Confident','Waving','Relieved','Relaxed','Hand_On_Hip','Excited','Pointing_At_Camera'],
  neutral:['Confident','Explaining','Explainer','Pointing','Waving','Presenting','Questioning'],
};
function moodForIntent(intent){ intent=intent||''; const s=String(intent).toLowerCase();
  // TONE first: confidence/empowerment framing wins even when a deadline word is present.
  // e.g. "beat the deadline", "file easily", "we handle it" -> confident, NOT panic.
  if (/beat|easy|simple|made simple|we (handle|file|do)|stress-?free|relax|sorted|covered|with experts|expert|trusted|maximise|maximize|save|grow|benefit|win|confident|easily|hassle-?free/.test(s)) return 'growth';
  if (/deadline|due|warn|penal|notice|last|alert|miss|late|don'?t miss|avoid|mistake|risk|fear/.test(s)) return 'warn';
  if (/how|step|guide|process|file|register|explain|tip|do|checklist|documents/.test(s)) return 'howto';
  if (/trust|why|best/.test(s)) return 'growth';
  return 'neutral'; }

let _fontsReady=false;
function ensureFonts(){ if(_fontsReady)return; const dir=path.join(__dirname,'fonts');
  const reg=(f,fam)=>{try{GlobalFonts.registerFromPath(path.join(dir,f),fam);}catch(e){}};
  reg('Poppins-Bold.ttf','PatronDisplay');reg('Poppins-Medium.ttf','PatronMedium');
  reg('Poppins-Regular.ttf','PatronBody');reg('Poppins-Light.ttf','PatronLight');_fontsReady=true;}

let _cat=null;
function catalog(){ if(_cat)return _cat;
  const r=d=>fs.existsSync(d)?fs.readdirSync(d).filter(f=>/\.png$/i.test(f)):[];
  const ills=r(ILL_DIR);
  _cat={chars:r(CHAR_DIR),bgs:r(BG_DIR),ills,
        vec:ills.filter(f=>f.startsWith('V_')), ico:ills.filter(f=>f.startsWith('I_')), geo:ills.filter(f=>f.startsWith('G_'))};
  return _cat; }
// ---- VARIATION ENGINE ----------------------------------------------------
// Each post gets a unique integer `vseed`. We derive INDEPENDENT indices for
// background, character person, pose, style and illustration using different
// prime strides so they don't move in lockstep (which caused identical posts).
const PRIME = { bg:7, person:3, pose:5, style:1, ill:11, scheme:1 };
function idx(vseed, stride, len){ return len ? ((vseed*stride) % len + len) % len : 0; }

function pickChar(intent, vseed){
  const chars = catalog().chars;
  const keys = MOOD[moodForIntent(intent)] || MOOD.neutral;
  // pool of poses that match the mood
  let pool = chars.filter(f => keys.some(k => f.toLowerCase().includes(k.toLowerCase())));
  if (!pool.length) pool = chars;
  // vary BOTH which person (CHAR_1..5) and which matching pose, independently
  // group pool by person
  const persons = [...new Set(pool.map(f => f.split('__')[0]))];
  const person = persons[idx(vseed, PRIME.person, persons.length)];
  const personPool = pool.filter(f => f.startsWith(person + '__'));
  return personPool[idx(vseed, PRIME.pose, personPool.length)];
}
function pickBg(vseed){ const bgs = catalog().bgs; return bgs[idx(vseed, PRIME.bg, bgs.length)]; }
function pickVec(vseed){ const v = catalog().vec; return v.length ? v[idx(vseed, PRIME.ill, v.length)] : null; }
function pickFrom(arr, vseed){ return arr.length ? arr[idx(vseed, PRIME.ill, arr.length)] : null; }

function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function drawCover(ctx,img,dx,dy,dw,dh){const ir=img.width/img.height,dr=dw/dh;let sw,sh,sx,sy;
  if(ir>dr){sh=img.height;sw=sh*dr;sx=(img.width-sw)/2;sy=0;}else{sw=img.width;sh=sw/dr;sx=0;sy=(img.height-sh)/2;}
  ctx.drawImage(img,sx,sy,sw,sh,dx,dy,dw,dh);}
function trimBox(img){const c=createCanvas(img.width,img.height),x=c.getContext('2d');x.drawImage(img,0,0);
  const d=x.getImageData(0,0,img.width,img.height).data;let t=img.height,b=0,l=img.width,r=0,found=false;
  for(let y=0;y<img.height;y++)for(let X=0;X<img.width;X++){if(d[(y*img.width+X)*4+3]>20){found=true;if(y<t)t=y;if(y>b)b=y;if(X<l)l=X;if(X>r)r=X;}}
  return found?{l,t,w:r-l+1,h:b-t+1}:{l:0,t:0,w:img.width,h:img.height};}
function wrap(ctx,text,maxW){const words=String(text||'').split(/\s+/),lines=[];let line='';
  for(const w of words){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=w;}else line=t;}
  if(line)lines.push(line);return lines;}

// solid brand background with subtle geometric shape accents
function solidBg(ctx,w,h,scheme,seed){
  ctx.fillStyle=scheme.solid; ctx.fillRect(0,0,w,h);
  // subtle diagonal tonal band
  ctx.save(); ctx.globalAlpha=0.5;
  const g=ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'rgba(255,255,255,0.04)'); g.addColorStop(1,'rgba(0,0,0,0.18)');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h); ctx.restore();
  // faint accent ring
  ctx.save(); ctx.globalAlpha=0.10; ctx.strokeStyle=scheme.pill; ctx.lineWidth=Math.max(8,w*0.012);
  ctx.beginPath(); ctx.arc(w*0.86,h*0.18,w*0.22,0,7); ctx.stroke(); ctx.restore();
}

// chooses a style if not explicitly set, rotating evenly using seed
// intent for pose = the post's own headline tone (falls back to spec.intent)
function intentForPost(spec){ return [spec.headline, spec.eyebrow, spec.intent].filter(Boolean).join(' '); }

function resolveStyle(spec, vseed){
  if (spec.style && STYLES.includes(spec.style)) return spec.style;
  if (spec.carousel) return 'human_office'; // carousels keep the photo look by default
  const allow = spec.allowStyles && spec.allowStyles.length ? spec.allowStyles : STYLES;
  return allow[idx(vseed, PRIME.style, allow.length)];
}

async function renderPost(spec,size){
  ensureFonts();
  const w=size.w,h=size.h;
  const landscape = w > h*1.2;
  // unique, well-distributed per-post seed (the fix for "all images look the same")
  const vseed = Math.abs((spec.seed||0) * 2654435761 % 1000000) || (spec.seed||0);
  const scheme = SCHEMES[(spec.schemeIdx!=null ? spec.schemeIdx : idx(vseed, PRIME.scheme, SCHEMES.length)) % SCHEMES.length];
  const style = resolveStyle(spec, vseed);
  const canvas=createCanvas(w,h); const ctx=canvas.getContext('2d');
  const pad=Math.round(w*0.05);

  // zones (text vs art) — text_icon uses a larger text zone
  let textZone, artZone;
  if (style==='text_icon'){
    textZone={x:0,y:0,w:w,h:h}; artZone={x:Math.round(w*0.62),y:Math.round(h*0.58),w:Math.round(w*0.34),h:Math.round(h*0.36)};
  } else if (landscape){
    const tw=Math.round(w*0.56); textZone={x:0,y:0,w:tw,h:h}; artZone={x:tw,y:0,w:w-tw,h:h};
  } else {
    const split=Math.round(h*0.50); textZone={x:0,y:0,w:w,h:split}; artZone={x:0,y:split,w:w,h:h-split};
  }

  // ---- BACKGROUND ----
  if (style==='human_office'){
    const bg=await loadImage(path.join(BG_DIR,pickBg(vseed))); drawCover(ctx,bg,0,0,w,h);
  } else {
    solidBg(ctx,w,h,scheme,vseed);
  }

  const anchorRight = (vseed % 2 === 0); // alternate left/right by seed for variety

  // ---- SCRIM (drawn BEFORE the character so the figure stays bright) ----
  if (style==='human_office'){
    if (landscape){
      const g=ctx.createLinearGradient(0,0,textZone.w*1.05,0);
      g.addColorStop(0,'rgba(11,33,71,0.96)');g.addColorStop(0.75,'rgba(11,33,71,0.88)');g.addColorStop(1,'rgba(11,33,71,0)');
      ctx.fillStyle=g;ctx.fillRect(0,0,textZone.w*1.05,h);
    } else {
      // top band for the headline (full width) ...
      const gt=ctx.createLinearGradient(0,0,0,h*0.55);
      gt.addColorStop(0,'rgba(11,33,71,0.95)');gt.addColorStop(0.7,'rgba(11,33,71,0.72)');gt.addColorStop(1,'rgba(11,33,71,0)');
      ctx.fillStyle=gt;ctx.fillRect(0,0,w,h*0.55);
      // ... plus a side band on the TEXT side (opposite the character)
      if (anchorRight){const gs=ctx.createLinearGradient(0,0,w*0.66,0);
        gs.addColorStop(0,'rgba(11,33,71,0.9)');gs.addColorStop(1,'rgba(11,33,71,0)');ctx.fillStyle=gs;ctx.fillRect(0,0,w*0.66,h);}
      else {const gs=ctx.createLinearGradient(w,0,w*0.34,0);
        gs.addColorStop(0,'rgba(11,33,71,0.9)');gs.addColorStop(1,'rgba(11,33,71,0)');ctx.fillStyle=gs;ctx.fillRect(w*0.34,0,w*0.66,h);}
    }
  }

  // ---- FOREGROUND ART (bigger, side-anchored, fills the zone) ----
  let charTopY = null, charLeft = null, charRight = null; // track figure bounds for text exclusion
  if (style==='human_office' || style==='human_solid'){
    const ch=await loadImage(path.join(CHAR_DIR, spec.charFile || pickChar(intentForPost(spec),vseed)));
    const tb=trimBox(ch);
    let dh, dw, dx, dy;
    if (!landscape){
      dh = h * 0.74; dw = dh*(tb.w/tb.h);                 // slightly shorter so head clears text band
      const maxW = w*0.62; if(dw>maxW){dw=maxW;dh=dw*(tb.h/tb.w);}
      dx = anchorRight ? (w - dw - pad*0.1) : (-dw*0.04 + pad*0.1);
      dy = h - dh;
    } else {
      dh = h * 0.98; dw = dh*(tb.w/tb.h);
      const maxW = artZone.w*1.04; if(dw>maxW){dw=maxW;dh=dw*(tb.h/tb.w);}
      dx = w - dw + dw*0.02; dy = h - dh;
    }
    charTopY = dy; charLeft = dx; charRight = dx + dw;
    ctx.save();ctx.globalAlpha=0.16;ctx.fillStyle='#000';
    ctx.beginPath();ctx.ellipse(dx+dw*0.5,h-12,dw*0.32,18,0,0,7);ctx.fill();ctx.restore();
    ctx.drawImage(ch,tb.l,tb.t,tb.w,tb.h,dx,dy,dw,dh);
  } else if (style==='illustration'){
    const ill=await loadImage(path.join(ILL_DIR, pickVec(vseed)));
    const tb=trimBox(ill);
    let dw, dh;
    if (!landscape){
      dw=artZone.w*0.98; dh=dw*(tb.h/tb.w);
      const maxH=artZone.h*1.0; if(dh>maxH){dh=maxH;dw=dh*(tb.w/tb.h);}
    } else {
      dh=artZone.h*0.92; dw=dh*(tb.w/tb.h);
      const maxW=artZone.w*1.02; if(dw>maxW){dw=maxW;dh=dw*(tb.h/tb.w);}
    }
    const dx=artZone.x+(artZone.w-dw)/2, dy=(artZone.y+artZone.h)-dh;
    ctx.drawImage(ill,tb.l,tb.t,tb.w,tb.h,dx,dy,dw,dh);
  }

  // ---- LOGO top-left everywhere ----
  let yCursor=pad;
  try{ const logo=await loadImage(LOGO);
    const lw=w*(landscape?0.16:0.20); const lh=lw*(logo.height/logo.width);
    ctx.drawImage(logo,pad,pad*0.8,lw,lh); yCursor=pad*0.8+lh+pad*0.5;
  }catch(e){}

  // text occupies the top band, full width; the character is grounded lower so its
  // head clears this band. Pills additionally stop before the figure's top edge.
  const humanPortrait = (!landscape && (style==='human_office'||style==='human_solid'));
  if (humanPortrait) yCursor += pad*0.4;
  const tx = pad;
  let textColRight;
  if (landscape && style!=='text_icon'){ textColRight = textZone.w - pad*0.6; }
  else { textColRight = w - pad; }
  const textMaxW = textColRight - tx;

  if(spec.eyebrow){ ctx.font='600 '+Math.round(w*0.024)+'px PatronMedium';ctx.fillStyle=scheme.pill;ctx.textBaseline='top';
    ctx.fillText(String(spec.eyebrow).toUpperCase(),tx,yCursor); yCursor+=Math.round(w*0.024)+pad*0.35; }

  const hl=Math.round(w*((style==='text_icon')?0.075:(landscape?0.05:0.062)));
  ctx.font='700 '+hl+'px PatronDisplay';
  const lines=wrap(ctx,spec.headline,textMaxW); const lineH=hl*1.14;
  lines.forEach((ln,i)=>{ const last=i===lines.length-1;
    if(last&&spec.accentLast!==false){ const words=ln.split(' ');const head=words.slice(0,-1).join(' ');const tail=words[words.length-1];
      let x=tx; if(head){ctx.fillStyle=C.white;ctx.fillText(head+' ',x,yCursor);x+=ctx.measureText(head+' ').width;}
      const tw=ctx.measureText(tail).width;ctx.fillStyle=scheme.accent;rr(ctx,x-8,yCursor-3,tw+16,hl+8,7);ctx.fill();
      ctx.fillStyle=C.white;ctx.fillText(tail,x,yCursor);
    } else {ctx.fillStyle=C.white;ctx.fillText(ln,tx,yCursor);} yCursor+=lineH; });
  yCursor+=pad*0.35;

  const pills=[].concat(spec.bullets||[]); if(spec.dueText)pills.push(spec.dueText);
  ctx.font='600 '+Math.round(w*0.024)+'px PatronMedium';
  const ph=Math.round(w*0.024)+18;

  if (charTopY != null && !landscape){
    // HUMAN PORTRAIT: pills go in the empty navy gap BESIDE the character's torso,
    // on the side opposite the figure. Vertically centered in the lower band.
    const gapIsLeft = anchorRight;                 // char right -> gap on left
    const gapLeft  = gapIsLeft ? pad : (charRight + pad*0.4);
    const gapRight = gapIsLeft ? (charLeft - pad*0.4) : (w - pad);
    const gapW = Math.max(0, gapRight - gapLeft);
    // start pills a bit below the headline band, centered in the torso zone
    let py = Math.max(yCursor + pad*0.2, h*0.46);
    const px = gapLeft;
    for(const p of pills){
      const t=String(p); const tw=ctx.measureText(t).width;
      const pw=Math.min(tw+34, gapW);
      if (pw < 80) break;                          // gap too narrow, skip rest
      if (py+ph > h-pad) break;
      ctx.fillStyle='rgba(11,33,71,0.78)';rr(ctx,px,py,pw,ph,ph/2);ctx.fill();   // solid-ish so it reads over bg
      ctx.fillStyle=scheme.pill;ctx.beginPath();ctx.arc(px+16,py+ph/2,5,0,7);ctx.fill();
      ctx.fillStyle=C.white;ctx.textBaseline='middle';ctx.fillText(t,px+30,py+ph/2+1);ctx.textBaseline='top';
      py+=ph+11;
    }
  } else {
    // non-human (illustration/text) or landscape: pills stack under the headline as before
    let zoneBottom = (charTopY!=null) ? (charTopY - pad*0.5) : (landscape ? (h-pad) : (textZone.y+textZone.h-pad*0.4));
    for(const p of pills){ const t=String(p);const tw=ctx.measureText(t).width;
      const pw=Math.min(tw+34,textMaxW);
      if(yCursor+ph>zoneBottom) break;
      ctx.fillStyle='rgba(255,255,255,0.13)';rr(ctx,tx,yCursor,pw,ph,ph/2);ctx.fill();
      ctx.fillStyle=scheme.pill;ctx.beginPath();ctx.arc(tx+16,yCursor+ph/2,5,0,7);ctx.fill();
      ctx.fillStyle=C.white;ctx.textBaseline='middle';ctx.fillText(t,tx+30,yCursor+ph/2+1);ctx.textBaseline='top';
      yCursor+=ph+11; }
  }

  if(spec.page){ const txt=String(spec.page.i).padStart(2,'0')+'/'+String(spec.page.n).padStart(2,'0');
    ctx.font='700 '+Math.round(w*0.028)+'px PatronDisplay';ctx.textAlign='right';
    ctx.fillStyle='rgba(255,255,255,0.85)';ctx.fillText(txt,w-pad,pad*0.9);ctx.textAlign='left'; }

  return canvas.toBuffer('image/png');
}

module.exports={renderPost,catalog,pickChar,pickBg,STYLES};
