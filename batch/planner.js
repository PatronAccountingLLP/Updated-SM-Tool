// ============================================================================
// Patron Accounting — 7-DAY BATCH PLANNER
// Builds the full posting grid for a 7-day batch and attaches, to each cell,
// everything the content+render stages need: platform, day, focus role/area,
// the theme to use, whether it's a carousel, the city (GMB), and any
// date-anchored compliance deadline that falls in the window.
//
// LOCKED SPEC (per day):
//   instagram 5 = 4 single + 1 carousel
//   linkedin  5 = 4 single + 1 carousel
//   facebook  5 = 4 single + 1 carousel
//   pinterest 5 single
//   twitter   5 single
//   gmb       3 = 1 per city (Mumbai, Gurugram, Pune), each localized
//   => 28 posts/day, 196 / 7-day batch.
//
// THEME RULE: a platform's 5 daily images must use 5 DISTINCT themes. The
// carousel occupies one of the 5 slots on IG/LI/FB. We rotate the 5 single
// themes [0..4] with a per-day phase shift so the week stays varied too.
//
// FOCUS ROTATION (ported from LEGACY_FOCUS_ROTATION.txt):
//   cycle C = ["P","P","P","P","S","S","G"], offsets li0 ig1 fb2 gmb3 tw4 pin5
//   role[platform][day] = C[(day + offset) % 7]
// ============================================================================
const fs = require('fs');
const path = require('path');

const FOCUS_AREAS = JSON.parse(fs.readFileSync(path.join(__dirname, 'focus_areas.json'), 'utf8'));
const FOCUS_BY_KEY = Object.fromEntries(FOCUS_AREAS.map(f => [f.key, f]));
const COMPLIANCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'compliance_rows.json'), 'utf8'));

const FOCUS_CYCLE = ['P', 'P', 'P', 'P', 'S', 'S', 'G'];
const FOCUS_OFFSET = { linkedin: 0, instagram: 1, facebook: 2, gmb: 3, twitter: 4, pinterest: 5 };

const THEME_NAMES = ['editorialPhoto', 'vectorBlob', 'documentCloseup', 'colorBlock', 'dataCard'];
const PHOTO_THEMES = new Set([0, 2]); // editorialPhoto, documentCloseup need a photo
const GMB_CITIES = ['pune', 'mumbai', 'delhi', 'gurugram']; // 4 office cities (per the plan)

const POSTS_PER_PLATFORM = {
  instagram: 5, linkedin: 5, facebook: 5, pinterest: 5, twitter: 5, gmb: 4,
};
const CAROUSEL_PLATFORMS = new Set(['instagram', 'linkedin', 'facebook']);

// The 5 daily slot types for non-GMB platforms (from the plan table).
//  compliance -> a date-anchored compliance deadline (GST/ROC/PF etc.)
//  itr        -> an income-tax / ITR / TDS topic (date-anchored when possible)
//  priority   -> the user's chosen Primary / Secondary focus areas
//  trending   -> a varied catalog pick that rotates across the week (freshness)
const SLOT_PLAN = ['compliance', 'itr', 'priority', 'trending', 'priority'];

// Per-platform IST posting times (from the plan timetable). Index = slot 0..4.
// GMB uses one time per city slot (4 cities).
const SLOT_TIMES = {
  facebook:  ['09:00', '13:00', '15:00', '19:00', '20:30'],
  instagram: ['09:30', '12:00', '14:00', '19:00', '21:00'],
  linkedin:  ['08:00', '11:30', '13:00', '17:30', '19:00'],
  twitter:   ['09:00', '12:00', '14:00', '18:00', '21:00'],
  pinterest: ['11:00', '13:00', '15:00', '19:30', '21:00'],
  gmb:       ['10:00', '12:00', '14:00', '16:00'],
};
// Build an ISO 8601 timestamp with +05:30 (IST) for a given date + HH:MM.
function istISO(dateObj, hhmm) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${hhmm}:00+05:30`;
}

// Catalog subsets used to give each slot a genuinely different topic.
const IT_GROUPS = new Set(['Income Tax']);
const COMPLIANCE_GROUPS = new Set(['Returns & Compliance', 'Secretarial / Compliance']);
let _itAreas = null, _compAreas = null;
function itAreas() { if (!_itAreas) _itAreas = FOCUS_AREAS_REF().filter(f => IT_GROUPS.has(f.group)); return _itAreas; }
function compAreas() { if (!_compAreas) _compAreas = FOCUS_AREAS_REF().filter(f => COMPLIANCE_GROUPS.has(f.group)); return _compAreas; }
// (FOCUS_AREAS is defined below; this indirection avoids a TDZ issue.)
function FOCUS_AREAS_REF() { return FOCUS_AREAS; }

// Pick a focus area for a given slot type so the 5 daily posts differ.
function focusForSlot(slotType, slotIdx, day, platform, focusSel, upcoming) {
  const salt = `${day}-${platform}-${slotIdx}`;
  if (slotType === 'compliance') {
    const pool = compAreas();
    return pool.length ? pool[Math.abs(hashStr(salt + 'c')) % pool.length] : pickAny(salt);
  }
  if (slotType === 'itr') {
    const pool = itAreas();
    return pool.length ? pool[Math.abs(hashStr(salt + 'i')) % pool.length] : pickAny(salt);
  }
  if (slotType === 'priority') {
    // alternate Primary / Secondary across the two priority slots
    const key = (slotIdx >= 4 ? (focusSel.secondary || focusSel.primary) : focusSel.primary);
    if (key && FOCUS_BY_KEY[key]) return FOCUS_BY_KEY[key];
    return pickAny(salt + 'p');
  }
  // trending: rotate widely through the whole catalog, shifting by day so the
  // week stays fresh and a re-run lands on different areas.
  return pickAny(salt + 'trend-' + day);
}
function pickAny(salt) {
  return FOCUS_AREAS[Math.abs(hashStr(salt)) % FOCUS_AREAS.length];
}

// Pick a deadline for compliance/itr slots from the windows.
function pickDeadlineForSlot(slotType, sameDay, upcoming) {
  const all = (sameDay && sameDay.length ? sameDay : []).concat(upcoming || []);
  if (!all.length) return null;
  const isIT = (d) => /tds|tcs|itr|24q|26q|advance tax|income tax|form 16/i.test(`${d.form} ${d.description}`);
  const wanted = slotType === 'itr' ? all.filter(isIT) : all.filter(d => !isIT(d));
  const pick = (wanted.length ? wanted : all)[0];
  return pick || null;
}

// --- focus role for a (day, platform) ---------------------------------------
function focusRole(dayIdx, platform) {
  const off = FOCUS_OFFSET[platform];
  if (off === undefined) return 'P';
  return FOCUS_CYCLE[(dayIdx + off) % FOCUS_CYCLE.length];
}

// --- compliance date helpers -------------------------------------------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseComplianceDate(s, baseYear) {
  // rows look like "07-Apr" or "30-Apr"; FY 2026-27 spans Apr 2026 .. Mar 2027.
  const m = String(s).match(/(\d{1,2})-([A-Za-z]{3})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  // Apr-Dec => baseYear; Jan-Mar => baseYear+1
  const year = mon >= 3 ? baseYear : baseYear + 1;
  return new Date(year, mon, day);
}
function ordinal(d) {
  const t = d % 100;
  if (t >= 11 && t <= 13) return d + 'th';
  return d + ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
}
const MONTH_LOWER = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function houseDate(date) {
  // house style: "10th may 2026"
  return `${ordinal(date.getDate())} ${MONTH_LOWER[date.getMonth()]} ${date.getFullYear()}`;
}

// Deadlines whose date falls within [start, start+windowDays].
function deadlinesInWindow(startDate, windowDays, baseYear) {
  const end = new Date(startDate); end.setDate(end.getDate() + windowDays);
  const hits = [];
  for (const row of COMPLIANCE) {
    const d = parseComplianceDate(row[0], baseYear);
    if (!d) continue;
    if (d >= startDate && d <= end) {
      hits.push({ date: d, form: row[1], description: row[2], applicableTo: row[3], house: houseDate(d) });
    }
  }
  hits.sort((a, b) => a.date - b.date);
  return hits;
}

// --- theme assignment --------------------------------------------------------
// For a platform on a given day, produce the theme index for each of its posts
// so all are distinct. Carousel posts don't take a single-theme slot (they are
// their own visual), but they still consume one of the 5 daily slots.
function themeForSinglePost(dayIdx, platform, postIdxAmongSingles) {
  // phase the rotation by day + a platform constant so the week varies
  const platConst = (FOCUS_OFFSET[platform] || 0);
  return (postIdxAmongSingles + dayIdx + platConst) % THEME_NAMES.length;
}

// --- map a focus role to a concrete focus area, given the user's selections --
// focusSel = { primary:key, secondary:key, generic:key }
// If a role's key is missing, we fall back to rotating through the catalog group
// implied by the others, or just the whole catalog deterministically.
function resolveFocusArea(role, focusSel, salt) {
  const key = role === 'P' ? focusSel.primary : role === 'S' ? focusSel.secondary : focusSel.generic;
  if (key && FOCUS_BY_KEY[key]) return FOCUS_BY_KEY[key];
  // deterministic fallback so a plan is always renderable even with no selection
  const idx = Math.abs(hashStr(`${role}:${salt}`)) % FOCUS_AREAS.length;
  return FOCUS_AREAS[idx];
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

// --- slot intent inference ---------------------------------------------------
function slotTypeToIntent(slotType, deadline) {
  if (slotType === 'compliance') return 'COMPLIANCE';
  if (slotType === 'itr') return 'ITR';
  if (slotType === 'trending') return 'NEWS';
  return deadline ? 'COMPLIANCE' : 'SERVICE'; // priority
}
function inferSlotIntent(focus, deadline) {
  const g = (focus && focus.group) || '';
  if (deadline) return 'COMPLIANCE';
  if (g === 'Income Tax') return 'ITR';
  if (g === 'Returns & Compliance' || g === 'Secretarial / Compliance') return 'COMPLIANCE';
  if (g === 'Litigation & Appeals') return 'NEWS';
  return 'SERVICE';
}

// ============================================================================
// buildBatch — the main entry. Returns a flat list of post specs + a grid view.
// opts = {
//   startDate: Date (default: next Monday), baseYear: 2026,
//   focusSel: {primary, secondary, generic},   // catalog keys; optional
//   platforms: [...]  // default all 6
// }
// ============================================================================
function buildBatch(opts = {}) {
  const baseYear = opts.baseYear || 2026;
  const startDate = opts.startDate ? new Date(opts.startDate) : nextMonday();
  const platforms = opts.platforms || ['instagram', 'linkedin', 'facebook', 'pinterest', 'twitter', 'gmb'];
  const focusSel = opts.focusSel || { primary: '', secondary: '', generic: '' };

  const posts = [];
  const grid = [];
  const daysFilter = Array.isArray(opts.daysFilter) && opts.daysFilter.length
    ? new Set(opts.daysFilter.map(Number)) : null; // 1-based day numbers to keep

  for (let day = 0; day < 7; day++) {
    if (daysFilter && !daysFilter.has(day + 1)) continue; // skip days not requested
    const dayDate = new Date(startDate); dayDate.setDate(dayDate.getDate() + day);
    const dayDeadlines = deadlinesInWindow(dayDate, 0 /* same-day */, baseYear);
    // Also look 14 days ahead for "calendar utility" framing material.
    const upcoming = deadlinesInWindow(dayDate, 14, baseYear);
    const dayRow = { day, date: dayDate, dateHouse: houseDate(dayDate), cells: [] };

    for (const platform of platforms) {
      const count = POSTS_PER_PLATFORM[platform];
      const role = focusRole(day, platform);

      if (platform === 'gmb') {
        // 1 localized post per office city (4 posts), each anchored on a
        // rotating priority service (per the plan note).
        for (let ci = 0; ci < GMB_CITIES.length; ci++) {
          const city = GMB_CITIES[ci];
          // rotate priority focus across cities + days so each is different
          const focus = focusForSlot('priority', ci, day, 'gmb', focusSel, upcoming)
            || resolveFocusArea(role, focusSel, `${day}-gmb-${city}`);
          const dl = pickDeadline(dayDeadlines, upcoming, focus);
          const themeIdx = themeForSinglePost(day, platform, ci); // distinct themes
          const spec = makeSpec({ platform, day, dayDate, city, role, focus, themeIdx, deadline: dl, isCarousel: false, slotPos: ci, slotType: 'priority' });
          posts.push(spec); dayRow.cells.push(spec);
        }
        continue;
      }

      // non-GMB platforms: 5 posts, each a DIFFERENT slot type per the plan:
      //   Slot 1 Compliance | Slot 2 ITR | Slot 3 Priority | Slot 4 Trending | Slot 5 Priority
      // IG/LI/FB: the last slot (Priority) is delivered as a CAROUSEL.
      let singleIdx = 0;
      for (let i = 0; i < count; i++) {
        const isCarousel = CAROUSEL_PLATFORMS.has(platform) && i === count - 1;
        const slotType = SLOT_PLAN[i] || 'priority';
        // Resolve a DISTINCT focus area for this specific slot so the 5 posts
        // are different topics, not five copies of the same one.
        const focus = focusForSlot(slotType, i, day, platform, focusSel, upcoming);
        // Compliance/ITR slots prefer a real date-anchored deadline.
        const dl = (slotType === 'compliance' || slotType === 'itr')
          ? pickDeadlineForSlot(slotType, dayDeadlines, upcoming)
          : null;
        let themeIdx;
        if (isCarousel) {
          themeIdx = -1; // carousel is its own visual
        } else {
          themeIdx = themeForSinglePost(day, platform, singleIdx);
          singleIdx++;
        }
        const spec = makeSpec({ platform, day, dayDate, role, focus, themeIdx, deadline: dl, isCarousel, slotPos: i, slotType });
        posts.push(spec); dayRow.cells.push(spec);
      }
    }
    grid.push(dayRow);
  }

  return { startDate, posts, grid, counts: summarize(posts) };
}

// Choose a deadline to anchor on: prefer a same-day deadline matching the
// focus group; else the nearest upcoming one that matches; else none.
function pickDeadline(sameDay, upcoming, focus) {
  const grp = (focus && focus.group) || '';
  const groupHint = grp.toLowerCase();
  const match = (d) => {
    const blob = `${d.form} ${d.description} ${d.applicableTo}`.toLowerCase();
    if (groupHint.includes('income tax')) return /tds|itr|24q|26q|advance tax|income tax|tcs/.test(blob);
    if (groupHint.includes('returns') || groupHint.includes('compliance')) return /gstr|gst|roc|aoc|mgt|cmp|annual/.test(blob);
    if (groupHint.includes('payroll')) return /pf|esic|esi|provident|gratuity|payroll/.test(blob);
    return false;
  };
  const sd = sameDay.find(match) || sameDay[0];
  if (sd) return sd;
  const up = upcoming.find(match);
  return up || null;
}

function makeSpec({ platform, day, dayDate, city, role, focus, themeIdx, deadline, isCarousel, slotPos, slotType }) {
  const dateHouse = houseDate(dayDate);
  const slotIntent = slotType ? slotTypeToIntent(slotType, deadline) : inferSlotIntent(focus, deadline);
  // Build a human topic string for the content engine.
  let topic;
  if (deadline) {
    topic = `${deadline.form} due ${deadline.house}: ${deadline.description}`;
  } else {
    topic = `${focus.label} (${focus.themes.split(',')[0].trim()})`;
  }
  if (city) topic += ` — for ${cap(city)} businesses`;

  // scheduled time for this slot from the timetable
  const times = SLOT_TIMES[platform] || [];
  const slotTime = times[slotPos] || times[times.length - 1] || '12:00';
  const scheduledAt = istISO(dayDate, slotTime);

  return {
    id: `d${day + 1}_${platform}${city ? '_' + city : ''}_${slotPos + 1}`,
    platform,
    day,
    date: dayDate,
    dateHouse,
    slotType: slotType || null,
    slotTime,                // "09:30"
    scheduledAt,             // ISO 8601 +05:30
    city: city || null,
    role,
    focus: { key: focus.key, label: focus.label, slug: focus.slug, themes: focus.themes, group: focus.group },
    themeIdx,            // -1 = carousel
    themeName: themeIdx >= 0 ? THEME_NAMES[themeIdx] : 'carousel',
    needsPhoto: themeIdx >= 0 ? PHOTO_THEMES.has(themeIdx) : true, // carousel needs photos too
    isCarousel: !!isCarousel,
    slotIntent,
    deadline: deadline ? { form: deadline.form, house: deadline.house, description: deadline.description, applicableTo: deadline.applicableTo } : null,
    topic,
  };
}

function summarize(posts) {
  const by = {};
  for (const p of posts) by[p.platform] = (by[p.platform] || 0) + 1;
  return { total: posts.length, byPlatform: by, carousels: posts.filter(p => p.isCarousel).length };
}

function nextMonday() {
  const d = new Date();
  const day = d.getDay();
  const add = ((8 - day) % 7) || 7; // always a future Monday
  d.setDate(d.getDate() + add); d.setHours(9, 0, 0, 0);
  return d;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = {
  buildBatch, focusRole, deadlinesInWindow, houseDate, parseComplianceDate,
  FOCUS_AREAS, FOCUS_BY_KEY, THEME_NAMES, GMB_CITIES, POSTS_PER_PLATFORM,
};
