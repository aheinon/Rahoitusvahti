import { createDemoStore, createFirebaseStore } from "./data.js";
import { callLine, DEFAULT_PROFILE } from "./idea-prompt.js";
import { chunk, normName, parseRegister } from "./portfolio.js";

/* ================= Constants and helpers ================= */

// Funder groups shown in filters, legend and colours. EU topics are split by programme.
const SOURCES = {
  horizon: { label: "Horizon Europe", short: "Horizon", color: "var(--src-eu)" },
  erasmus: { label: "Erasmus+", short: "Erasmus+", color: "var(--src-erasmus)" },
  life: { label: "LIFE", short: "LIFE", color: "var(--src-life)" },
  digital: { label: "Digital Europe", short: "Digital", color: "var(--src-digital)" },
  euother: { label: "Other EU programmes", short: "EU", color: "var(--src-euother)" },
  bf: { label: "Business Finland", short: "BF", color: "var(--src-bf)" },
  aka: { label: "Research Council of Finland", short: "RCF", color: "var(--src-aka)" },
  eura: { label: "ERDF / ESF+ / JTF (EURA)", short: "EURA", color: "var(--src-eura)" },
  interreg: { label: "Interreg", short: "Interreg", color: "var(--src-interreg)" },
  cetp: { label: "CETPartnership", short: "CETP", color: "var(--src-cetp)" },
  oph: { label: "EDUFI grants (OPH)", short: "EDUFI", color: "var(--src-oph)" },
  jotpa: { label: "Jotpa", short: "Jotpa", color: "var(--src-jotpa)" },
  gov: { label: "Ministries and agencies", short: "State", color: "var(--src-gov)" },
  maaseutu: { label: "Rural development (CAP, Leader)", short: "CAP", color: "var(--src-maaseutu)" },
  saatiot: { label: "Foundations", short: "Foundation", color: "var(--src-saatiot)" },
  manual: { label: "Added by the team", short: "Own", color: "var(--src-manual)" },
};
const STAGES = [
  ["", "Not reviewed"], ["watching", "Watching"], ["preparing", "Preparing"],
  ["submitted", "Submitted"], ["funded", "Funded"], ["rejected", "Rejected"], ["skip", "Not applying"],
];
const STAGE_LABEL = Object.fromEntries(STAGES);
const ROLE_LABEL = { admin: "Admin", member: "Team member", partner: "Partner (view and comment)" };
const DAY = 864e5;
const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY_ISO = isoDate(today);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseIso(s) { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDate(s) { const d = parseIso(s); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""; }
function daysLeft(s) { const d = parseIso(s); return d ? Math.round((d - today) / DAY) : null; }
function daysText(n) {
  if (n === null) return "";
  if (n < 0) return "closed";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 60) return `${n} days`;
  if (n < 365) return `${Math.round(n / 30)} months`;
  return "over a year";
}
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* optional */ } },
};
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>`;
const STAR_O = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>`;
const EU_GROUPS = ["horizon", "erasmus", "life", "digital", "euother"];
// How the funder filter is grouped
const FUNDER_GROUPS = [
  { key: "intl", label: "EU and international", keys: [...EU_GROUPS, "interreg", "cetp"] },
  { key: "fi", label: "Finland", keys: ["bf", "aka", "eura", "jotpa", "gov", "oph", "maaseutu", "saatiot"] },
  { key: "own", label: "Added by the team", keys: ["manual"] },
];
const SOURCE_SHORT = { eu: "EU", bf: "BF", aka: "RCF", eura: "EURA", interreg: "Interreg", cetp: "CETP", oph: "EDUFI", va: "Haeavustuksia.fi", maaseutu: "Maaseutu.fi", saatiot: "foundations" }; // collector run counts
function groupOf(c) {
  if (c.source === "oph") return /erasmus/i.test(c.programme || "") ? "erasmus" : "oph";
  if (c.source === "va") return c.programme === "Jotpa" ? "jotpa" : "gov";
  if (c.source !== "eu") return SOURCES[c.source] ? c.source : "manual";
  const p = (c.programme || "") + " " + (c.call_id || c.id || "");
  if (/horizon|euratom/i.test(p)) return "horizon";
  if (/erasmus/i.test(p)) return "erasmus";
  if (/\bLIFE\b/.test(p)) return "life";
  if (/digital/i.test(p)) return "digital";
  return "euother";
}
const srcOf = (c) => SOURCES[groupOf(c)];
const DEFAULT_FILTERS = { newOnly: false, showHidden: false, q: "", sources: Object.keys(SOURCES), status: ["open", "forthcoming"], window: "all", minRel: 0, favOnly: false, mineOnly: false, tag: "", idea: "" };

/* ================= State ================= */

// Saved filters from before EU was split by programme had a single "eu" entry.
// Funder groups added after the filters were saved are switched on.
const FIRST_GROUPS = ["horizon", "erasmus", "life", "digital", "euother", "bf", "aka", "eura", "interreg", "manual"];
function migrateFilters(f) {
  if (f.sources.includes("eu")) f.sources = [...f.sources.filter((s) => s !== "eu"), ...EU_GROUPS];
  const known = f.known || FIRST_GROUPS;
  f.sources = [...new Set([...f.sources, ...Object.keys(SOURCES).filter((k) => !known.includes(k))].filter((s) => SOURCES[s]))];
  f.known = Object.keys(SOURCES);
  return f;
}
/** Only http(s) links are rendered, so a manually added call cannot carry a javascript: link. */
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "#");

const S = {
  store: null,
  calls: [], byId: new Map(), meta: {},
  notes: {}, ratings: {}, ideaDocs: {}, cardSearch: {}, pieces: [], net: null, netProjects: [], radar: {},
  netView: { tab: "orgs", mode: LS.get("rv-net-mode", "map"), q: "", type: "", sort: "projects", project: "", show: null }, pieceKind: "", develop: {}, partners: [], allow: [], me: { favorites: [] }, profile: undefined, profileDraft: null,
  view: LS.get("rv-view", "list"),
  filters: migrateFilters(Object.assign({}, DEFAULT_FILTERS, LS.get("rv-filters", {}))),
  sort: LS.get("rv-sort", "deadline"),
  horizon: LS.get("rv-horizon", 183),          // timeline length in days
  showSummaries: LS.get("rv-summaries", false),
  openId: null,
  unsubComments: null,
  idea: { text: LS.get("rv-idea-text", ""), name: LS.get("rv-idea-name", ""), status: "idle", matches: [], strengthen: [], note: "", offline: false, error: "", ctl: null, open: LS.get("rv-idea-open", true) },
};
const fav = (id) => S.me.favorites?.includes(id);
const noteOf = (id) => S.notes[id] || {};
const isMember = () => ["admin", "member"].includes(S.store.user.role);
const isAdmin = () => S.store.user.role === "admin";
const personName = (p) => S.allow.find((a) => a.email === p)?.name || p;
const nextDeadline = (c) => c.deadline || (c.deadlines || []).filter((d) => d >= TODAY_ISO).sort()[0] || null;
const isClosed = (c) => c.status === "closed" || (!c.continuous && nextDeadline(c) === null && (c.deadlines || []).length > 0);
const isNew = (c) => c.firstSeen && (Date.parse(S.meta.lastRun || today) - parseIso(c.firstSeen)) / DAY <= 7;
/** The team's answers to "Is this relevant for us?": {up, mid, down, score, mine}. */
function ratingOf(id) {
  const rs = S.ratings[id] || [];
  const me = S.store.user.email;
  return { list: rs, up: rs.filter((r) => r.v === 1).length, mid: rs.filter((r) => r.v === 0).length,
    down: rs.filter((r) => r.v === -1).length, score: rs.reduce((n, r) => n + (r.v || 0), 0), mine: rs.find((r) => r.email === me) || null };
}
function allTags() {
  const set = new Set();
  Object.values(S.notes).forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b, "en"));
}
function allIdeas() {
  const set = new Set(Object.keys(S.ideaDocs || {}));
  Object.values(S.notes).forEach((n) => n.idea && set.add(n.idea));
  return [...set].sort((a, b) => a.localeCompare(b, "en"));
}

/* ================= Start ================= */

async function boot() {
  const cfg = window.RV_CONFIG || {};
  const demo = !cfg.firebase || new URLSearchParams(location.search).has("demo");
  try {
    S.store = demo ? await createDemoStore() : await createFirebaseStore(cfg.firebase);
  } catch (e) {
    $("#app").innerHTML = `<div class="login"><div class="login-box"><h1>Cannot connect</h1><p>${esc(e.message)}</p><p>Check the Firebase settings in config.js.</p></div></div>`;
    return;
  }
  const res = await S.store.init();
  if (res.state === "signedOut") return renderLogin();
  if (res.state === "denied") return renderDenied(res.email);
  await loadAll();
}

async function loadAll() {
  $("#app").innerHTML = `<div class="empty" style="padding-top:30vh">Loading calls…</div>`;
  const [{ items, meta }, me] = await Promise.all([S.store.loadCalls(), S.store.loadMe()]);
  S.calls = items; S.meta = meta || {}; S.me = { favorites: [], ...me };
  S.byId = new Map(items.map((c) => [c.id, c]));
  S.store.watchNotes((n) => { S.notes = n; refresh(); });
  S.store.watchPartners((p) => { S.partners = p; refresh(); });
  S.store.watchRatings((r) => { S.ratings = r || {}; refresh(); });
  if (isMember()) {
    S.store.watchIdeas((d) => { S.ideaDocs = d || {}; if (S.view === "ideas") refresh(); else if (S.openId) renderDrawerBody(); });
    S.store.watchPieces((p) => { S.pieces = p || []; if (S.view === "ideas") refresh(); });
    S.store.watchNetProjects((p) => { S.netProjects = p || []; if (S.view === "partners") refresh(); else if (S.openId) renderDrawerBody(); });
  }
  S.store.watchAllow((a) => { S.allow = a; refresh(); });
  S.store.watchProfile((p) => { S.profile = p; if (S.view === "profile" && !S.profileDraft) refresh(); });
  renderShell();
}

/* ================= Sign-in ================= */

function loginMark() {
  return `<div class="mark">${["horizon", "bf", "aka", "eura", "interreg"].map((s) => `<i style="background:${SOURCES[s].color}"></i>`).join("")}</div>`;
}
function renderLogin(msg = "") {
  $("#app").innerHTML = `
  <main class="login"><div class="login-box">
    ${loginMark()}
    <h1>${esc(window.RV_CONFIG?.appName || "Rahoitusvahti")}</h1>
    <p>Research and innovation funding calls in one place. Sign in with a link sent to your email.</p>
    <form id="login-form">
      <label class="sr" for="email">Email address</label>
      <input id="email" type="email" required autocomplete="email" placeholder="firstname.lastname@turkuamk.fi">
      <button class="btn" type="submit">Send sign-in link</button>
    </form>
    <div id="login-msg">${msg}</div>
    <p class="note">Only invited addresses can sign in. Ask the administrator for access.</p>
  </div></main>`;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim().toLowerCase();
    const btn = $("#login-form button"); btn.disabled = true;
    try {
      await S.store.sendLink(email);
      $("#login-msg").innerHTML = `<p class="ok">Link sent to <b>${esc(email)}</b>. Open it on this same device.</p>`;
    } catch (err) {
      $("#login-msg").innerHTML = `<p class="ok err">The link could not be sent: ${esc(err.message)}</p>`;
      btn.disabled = false;
    }
  };
}
function renderDenied(email) {
  $("#app").innerHTML = `
  <main class="login"><div class="login-box">${loginMark()}
    <h1>No access yet</h1>
    <p><b>${esc(email)}</b> is not on the user list. Ask the administrator to add it, then sign in again.</p>
    <button class="btn ghost" id="out">Sign out</button>
  </div></main>`;
  $("#out").onclick = () => S.store.signOut();
}

/* ================= Shell ================= */

function renderShell() {
  const u = S.store.user;
  if (S.view === "network") S.view = "partners";
  const tabs = [["list", "Calls"]].concat(isMember() ? [["ideas", "Ideas"], ["partners", "Partners"]] : []).concat([["board", "Pipeline"]]).concat([ ["profile", "Profile"]]).concat(isAdmin() ? [["users", "Users"]] : []);
  if ((S.view === "users" && !isAdmin()) || (["ideas", "network", "partners"].includes(S.view) && !isMember())) S.view = "list";
  $("#app").innerHTML = `
  ${S.store.mode === "demo" ? `<div class="demo-band"><span>Demo with ${S.calls.length} real calls (29 Oct and 2 Nov 2026) and a sample of real CORDIS partner data. Ideas, notes, comments and Claude's results are examples. Changes stay in this browser only; live Claude searches need the real service.</span><button id="demo-reset">Reset demo</button></div>` : ""}
  <header class="top">
    <div class="brand"><b>${esc(window.RV_CONFIG?.appName || "Rahoitusvahti")}</b><span>${esc(window.RV_CONFIG?.orgName || "")}</span></div>
    <nav class="tabs" aria-label="Views">${tabs.map(([k, l]) => `<button data-view="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>
    <div class="spacer"></div>
    <div class="who"><span class="email">${esc(u.name || u.email)}</span><button class="linkbtn" id="signout">Sign out</button></div>
  </header>
  <div id="view"></div>
  <div class="tip" id="tip"></div>`;
  $$(".tabs button").forEach((b) => (b.onclick = () => { S.view = b.dataset.view; LS.set("rv-view", S.view); renderShell(); }));
  $("#signout").onclick = () => S.store.signOut();
  $("#demo-reset") && ($("#demo-reset").onclick = () => S.store.reset());
  refresh();
}

function refresh() {
  const v = $("#view");
  if (!v) return;
  if (S.view === "list") renderListView(v);
  else if (S.view === "board") renderBoard(v);
  else if (S.view === "ideas") renderIdeas(v);
  else if (S.view === "partners") renderPartnersPage(v);
  else if (S.view === "users") renderUsers(v);
  else if (S.view === "profile") renderProfile(v);
  if (S.openId) renderDrawerBody();
}

/* ================= Filtering ================= */

/* ================= Calls we can't apply to ================= */

// Regions of Finland grouped into the four structural fund areas (EURA "alue")
const FUND_AREAS = {
  "Etelä-Suomi": ["Uusimaa", "Kanta-Häme", "Päijät-Häme", "Kymenlaakso", "Etelä-Karjala"],
  "Länsi-Suomi": ["Varsinais-Suomi", "Satakunta", "Pirkanmaa", "Keski-Suomi", "Pohjanmaa", "Etelä-Pohjanmaa"],
  "Itä-Suomi": ["Etelä-Savo", "Pohjois-Savo", "Pohjois-Karjala"],
  "Pohjois-Suomi": ["Keski-Pohjanmaa", "Pohjois-Pohjanmaa", "Kainuu", "Lappi"],
};
const REGIONS = Object.values(FUND_AREAS).flat().sort((a, b) => a.localeCompare(b, "fi"));
const homeRegion = () => S.profile?.homeRegion || DEFAULT_PROFILE.homeRegion || "Varsinais-Suomi";

const HIDDEN_LABEL = {
  region: "Other region",
  country: "Finland not eligible",
  ineligible: "Not eligible (Claude)",
  skip: "Not applying",
};

/** Why a call is hidden by default, or null when it is shown. */
function hiddenReason(c) {
  if (noteOf(c.id).stage === "skip") return "skip";
  if ((c.source === "eura" || c.source === "maaseutu") && c.region) {
    const home = homeRegion();
    const parts = c.region.split(",").map((s) => s.trim());
    const national = parts.some((p) => /^(national|valtakunnallinen)$/i.test(p));
    const area = parts.length === 1 && FUND_AREAS[parts[0]];            // whole fund area, no regions listed
    if (!national && !parts.includes(home) && !(area && area.includes(home))) return "region";
  }
  if (c.source === "interreg" && c.region && !/finland/i.test(c.region) && !(c.auto_tags || []).includes("Finland eligible")) return "country";
  if (/^(no|ei)\b/i.test(String(c.aiEligible || "").trim())) return "ineligible";
  return null;
}

function filtered() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const maxDate = f.window === "all" ? null : isoDate(new Date(today.getTime() + Number(f.window) * DAY));
  const me = S.store.user.email;
  return S.calls.filter((c) => {
    if (!f.sources.includes(groupOf(c))) return false;
    if (!f.showHidden && hiddenReason(c)) return false;
    const st = isClosed(c) ? "closed" : c.status;
    if (!f.status.includes(st)) return false;
    if (f.favOnly && !fav(c.id)) return false;
    if (f.newOnly && !isNew(c)) return false;
    const n = noteOf(c.id);
    if (f.mineOnly && !(n.people || []).includes(me)) return false;
    if (f.tag && !(n.tags || []).includes(f.tag)) return false;
    if (f.idea && n.idea !== f.idea) return false;
    if ((c.relevance ?? 0) < f.minRel) return false;
    if (maxDate) { const d = nextDeadline(c); if (!d || d > maxDate) return false; }
    if (q) {
      const hay = [c.title, c.summary, c.programme, c.funder, c.call_id, c.region, n.idea, ...(c.auto_tags || []), ...(c.aiTags || []), ...(n.tags || [])].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
function sorted(list) {
  const by = {
    deadline: (a, b) => (nextDeadline(a) || "9999").localeCompare(nextDeadline(b) || "9999") || (b.relevance ?? 0) - (a.relevance ?? 0),
    relevance: (a, b) => (b.relevance ?? 0) - (a.relevance ?? 0),
    new: (a, b) => (b.firstSeen || "").localeCompare(a.firstSeen || "") || (b.relevance ?? 0) - (a.relevance ?? 0),
    team: (a, b) => ratingOf(b.id).score - ratingOf(a.id).score || ratingOf(b.id).list.length - ratingOf(a.id).list.length || (b.relevance ?? 0) - (a.relevance ?? 0),
  }[S.sort] || ((a, b) => 0);
  return [...list].sort(by);
}
function saveFilters() { LS.set("rv-filters", S.filters); }

/* ================= Call list + timeline ================= */

function renderListView(v) {
  const list = sorted(filtered());
  const f = S.filters;
  const countBy = (s) => S.calls.filter((c) => groupOf(c) === s && !isClosed(c) && (f.showHidden || !hiddenReason(c))).length;
  const tags = allTags();
  const ideas = allIdeas();
  const focusId = document.activeElement?.id;
  const sel = focusId && ["q"].includes(focusId) ? [$("#" + focusId).selectionStart, $("#" + focusId).selectionEnd] : null;
  const hiddenCount = S.calls.filter((c) => f.sources.includes(groupOf(c)) && !isClosed(c) && hiddenReason(c)).length;
  const newCount = S.calls.filter((c) => isNew(c) && !isClosed(c) && f.sources.includes(groupOf(c)) && (f.showHidden || !hiddenReason(c))).length;
  const soon = list.filter((c) => { const d = daysLeft(nextDeadline(c)); return d !== null && d >= 0 && d <= 30; }).length;
  v.innerHTML = `
  <section class="radar" aria-label="Deadlines on a timeline">
    <div class="radar-head">
      <h1>${soon} ${soon === 1 ? "call closes" : "calls close"} within 30 days</h1>
      <p>${list.length} calls shown</p>
      <div class="seg horizon" role="group" aria-label="Timeline length">${[[183, "6 months"], [365, "12 months"], [548, "18 months"]].map(([d, l]) => `<button data-hz="${d}" aria-pressed="${S.horizon === d}">${l}</button>`).join("")}</div>
      <div class="legend">${Object.entries(SOURCES).filter(([k]) => countBy(k)).map(([k, s]) => `<span><i style="background:${s.color}"></i>${s.short}</span>`).join("")}<span><i style="background:transparent;box-shadow:0 0 0 2px var(--sun)"></i>Favourite</span></div>
    </div>
    <div class="track" id="track"></div>
  </section>
  <div class="layout">
    <aside class="filters" id="filters" aria-label="Filters">
      <h2><label for="q">Search</label></h2>
      <input id="q" class="search" type="search" placeholder="e.g. solar, battery, CL5" value="${esc(f.q)}">
      <h2>Funder</h2>
      ${FUNDER_GROUPS.map((g) => {
        const keys = g.keys.filter((k) => countBy(k) || (k !== "manual" && !EU_GROUPS.includes(k)));
        if (!keys.length) return "";
        const on = keys.filter((k) => f.sources.includes(k)).length;
        const total = keys.reduce((n, k) => n + countBy(k), 0);
        const single = keys.length === 1 && g.key === "own";
        return `<div class="fgroup">
          <label class="check fhead"><input type="checkbox" data-fgroup="${g.key}" ${on === keys.length ? "checked" : ""} ${on && on < keys.length ? 'data-mixed="1"' : ""}>${g.label}<span class="n">${total}</span></label>
          ${single ? "" : keys.map((k) => `<label class="check sub"><input type="checkbox" data-src="${k}" ${f.sources.includes(k) ? "checked" : ""}><i style="background:${SOURCES[k].color}"></i>${SOURCES[k].label}<span class="n">${countBy(k)}</span></label>`).join("")}
        </div>`;
      }).join("")}
      <h2>Status</h2>
      ${[["open", "Open"], ["forthcoming", "Upcoming"], ["closed", "Closed"]].map(([k, l]) => `<label class="check"><input type="checkbox" data-status="${k}" ${f.status.includes(k) ? "checked" : ""}>${l}</label>`).join("")}
      <h2>Deadline within</h2>
      <div class="seg">${[["30", "30 days"], ["90", "3 months"], ["180", "6 months"], ["365", "12 months"], ["548", "18 months"], ["all", "Any time"]].map(([k, l]) => `<button data-win="${k}" aria-pressed="${f.window === k}">${l}</button>`).join("")}</div>
      <h2><label for="minrel">Relevance at least <b id="minrel-v">${f.minRel}</b></label></h2>
      <input id="minrel" type="range" min="0" max="90" step="10" value="${f.minRel}">
      <h2>Show only</h2>
      <label class="check"><input type="checkbox" id="newonly" ${f.newOnly ? "checked" : ""}>New this week<span class="n">${newCount}</span></label>
      <label class="check"><input type="checkbox" id="favonly" ${f.favOnly ? "checked" : ""}>My favourites</label>
      <label class="check"><input type="checkbox" id="mineonly" ${f.mineOnly ? "checked" : ""}>Calls I am involved in</label>
      ${ideas.length ? `<h2><label for="ideaf">Project idea</label></h2><select id="ideaf" class="sel" style="width:100%"><option value="">All ideas</option>${ideas.map((t) => `<option ${f.idea === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
      ${tags.length ? `<h2><label for="tagf">Tag</label></h2><select id="tagf" class="sel" style="width:100%"><option value="">All tags</option>${tags.map((t) => `<option ${f.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
      <button class="btn ghost reset" id="reset-f">Clear filters</button>
    </aside>
    <main class="main">
      ${f.newOnly ? `<div class="new-band" role="status"><span class="tag new">New</span><span>Showing the ${list.length} ${list.length === 1 ? "call" : "calls"} that appeared in the last 7 days.</span><button class="linkbtn" id="new-off">Show all calls</button></div>` : ""}
      <div class="bar">
        <button class="btn ghost mobile-filters" id="toggle-f">Filters</button>
        <span class="count">${list.length} calls</span>
        ${newCount && !f.newOnly ? `<button class="tag new newbtn" id="new-on" title="Show only calls that appeared in the last 7 days">${newCount} new this week</button>` : ""}
        ${hiddenCount ? `<button class="linkbtn hidden-toggle" id="showhidden" aria-pressed="${f.showHidden}" title="Other regions' ERDF calls, Interreg calls without Finland, calls Claude marked not eligible, and calls marked Not applying">${f.showHidden ? `Hide the ${hiddenCount} calls we can't apply to` : `Show ${hiddenCount} calls we can't apply to`}</button>` : ""}
        <span class="spacer"></span>
        <label class="check inline"><input type="checkbox" id="showsum" ${S.showSummaries ? "checked" : ""}>Show summaries</label>
        <button class="btn ghost" id="ics" title="Download the deadlines of your favourites as a calendar file">Favourites to calendar</button>
        ${isMember() ? `<button class="btn ghost" id="go-ideas" title="Describe an idea and Claude suggests matching calls">Find calls for an idea →</button><button class="btn" id="add-call">Add a call</button>` : ""}
      </div>
      <div class="sortbar" role="group" aria-label="Sort the list">
        <span>Sort by</span>
        ${[["deadline", "Deadline", "Nearest deadline first"], ["relevance", "Relevance", "Claude's relevance score, highest first"], ["team", "Team rating", "Most 👍 from the team first"], ["new", "Newest", "Most recently found first"]]
          .map(([k, l, t]) => `<button data-sort="${k}" aria-pressed="${S.sort === k}" title="${t}">${l}${S.sort === k ? ` <span aria-hidden="true">${k === "deadline" ? "↑" : "↓"}</span>` : ""}</button>`).join("")}
      </div>
      <div class="list" role="list">${list.length ? list.map(rowHtml).join("") : `<div class="empty"><b>No calls match these filters</b>Widen the deadline window or clear the filters.</div>`}</div>
      ${metaHtml()}
    </main>
  </div>`;
  renderRadar($("#track"), list);
  bindList(v);
  if (sel && $("#" + focusId)) { const el = $("#" + focusId); el.focus(); el.setSelectionRange(sel[0], sel[1]); }
}

function rowHtml(c) {
  const n = noteOf(c.id);
  const dl = nextDeadline(c);
  const dleft = daysLeft(dl);
  const cls = dleft !== null && dleft >= 0 && dleft <= 14 ? "urgent" : dleft !== null && dleft <= 45 ? "soon" : "";
  const src = srcOf(c);
  const rel = c.relevance ?? 0;
  const dlHtml = dl ? `<b>${fmtDate(dl)}</b><span>${daysText(dleft)}${(c.deadlines || []).length > 1 && !c.continuous ? " · 2-stage" : ""}${c.deadline_time ? ` · ${esc(c.deadline_time.split(" ")[0])}` : ""}</span>`
    : c.continuous ? `<b>Rolling</b><span>no deadline</span>`
    : c.deadline_text ? `<b>—</b><span>${esc(c.deadline_text.slice(0, 26))}</span>` : `<b>—</b><span>see funder's page</span>`;
  const opens = c.status === "forthcoming" && c.opens ? `<span>opens ${fmtDate(c.opens)}</span>` : "";
  const region = (c.source === "eura" || c.source === "maaseutu") && c.region ? " · " + esc(c.region.split(",")[0]) + (c.region.includes(",") ? " +" : "") : "";
  return `<div class="row ${isClosed(c) ? "closed" : ""}" role="listitem" data-id="${esc(c.id)}" tabindex="0">
    <span class="src" style="background:${src.color}" title="${esc(src.label)}"></span>
    <button class="star" data-fav="${esc(c.id)}" aria-pressed="${fav(c.id)}" aria-label="${fav(c.id) ? "Remove from favourites" : "Add to favourites"}">${fav(c.id) ? STAR : STAR_O}</button>
    <div>
      <div class="t">${esc(c.title)}</div>
      <div class="m">
        <span class="fund">${esc(src.short)}${c.programme && c.programme !== c.funder && c.programme !== src.label ? " · " + esc(c.programme) : ""}${region}</span>
        ${opens}
        ${isNew(c) ? `<button class="tag new" data-newtag title="Show all calls that are new this week">New</button>` : ""}
        ${teamBadge(c.id)}
        ${hiddenReason(c) ? `<span class="tag hiddenr">${HIDDEN_LABEL[hiddenReason(c)]}</span>` : ""}
        ${n.idea ? `<span class="tag idea" title="Project idea">${esc(n.idea)}</span>` : ""}
        ${n.stage ? `<span class="tag stage">${esc(STAGE_LABEL[n.stage])}</span>` : ""}
        ${(n.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
        ${(n.people || []).slice(0, 2).map((p) => `<span class="tag person">${esc(personName(p).split(" ")[0])}</span>`).join("")}
        ${n.commentCount ? `<span class="cc" title="Comments">${n.commentCount} ${n.commentCount === 1 ? "comment" : "comments"}</span>` : ""}
      </div>
      ${S.showSummaries && (c.aiSummary || c.summary) ? `<p class="rs">${esc(c.aiSummary || c.summary)}</p>` : ""}
    </div>
    <div class="rel ${c.aiScore != null ? "ai" : ""}" title="${c.aiScore != null ? "Claude's assessment" : "Keyword score"}"><span class="meter"><i style="width:${rel}%"></i></span>${rel || "–"}</div>
    <div class="dl ${cls}">${dlHtml}</div>
  </div>`;
}

function teamBadge(id) {
  const r = ratingOf(id);
  if (!r.list.length) return "";
  const who = r.list.map((x) => `${x.name.split(" ")[0]} ${x.v === 1 ? "👍" : x.v === -1 ? "👎" : "🤷"}`).join(", ");
  return `<span class="tag team ${r.score > 0 ? "up" : r.score < 0 ? "down" : ""}" title="Team: ${esc(who)}">${r.up ? `👍${r.up}` : ""}${r.mid ? ` 🤷${r.mid}` : ""}${r.down ? ` 👎${r.down}` : ""}</span>`;
}

function metaHtml() {
  const m = S.meta;
  if (!m.lastRun) return "";
  const when = new Date(m.lastRun);
  const counts = Object.entries(m.counts || {}).map(([k, n]) => `${SOURCE_SHORT[k] || k} ${n}`).join(", ");
  const errs = Object.keys(m.errors || {});
  return `<p class="foot-meta">Calls updated ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} at ${when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. From: ${esc(counts)}.${errs.length ? ` The update failed for ${esc(errs.join(", "))}; showing the previous data.` : ""}</p>`;
}

function renderRadar(el, list) {
  const start = new Date(today.getTime() - 6 * DAY);
  const end = new Date(today.getTime() + S.horizon * DAY);
  const span = end - start;
  const x = (d) => ((d - start) / span) * 100;
  let html = `<div class="zone" style="left:${x(today)}%;width:${x(new Date(today.getTime() + 14 * DAY)) - x(today)}%"></div>`;
  // label every month when there is room, otherwise every 2nd or 3rd (January always, with the year)
  const pxPerMonth = (el.clientWidth || 800) * 30.4 / (span / DAY);
  const step = Math.max(1, Math.ceil(52 / pxPerMonth));
  let i = 0;
  for (let m = new Date(start.getFullYear(), start.getMonth() + 1, 1); m < end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1), i++) {
    const label = m.getMonth() === 0 || i % step === 0;
    html += `<div class="month" style="left:${x(m)}%">${label ? `<span>${m.toLocaleDateString("en-GB", { month: "short" })}${m.getMonth() === 0 ? " " + m.getFullYear() : ""}</span>` : ""}</div>`;
  }
  html += `<div class="today" style="left:${x(today)}%"><span>Today</span></div>`;
  const stacks = new Map();
  const highlight = new Set(S.idea.status === "done" ? S.idea.matches.map((m) => m.id) : []);
  const pts = list.map((c) => ({ c, d: parseIso(nextDeadline(c)) })).filter((p) => p.d && p.d >= start && p.d <= end)
    .sort((a, b) => (highlight.has(b.c.id) - highlight.has(a.c.id)) || (b.c.relevance ?? 0) - (a.c.relevance ?? 0));
  const maxStack = el.clientHeight > 120 ? 6 : 5;
  for (const { c, d } of pts) {
    const px = x(d);
    const bucket = Math.round(px / (S.horizon > 300 ? 0.8 : 1.1));
    const k = stacks.get(bucket) || 0;
    if (k >= maxStack) continue;
    stacks.set(bucket, k + 1);
    const size = 9 + Math.round(((c.relevance ?? 0) / 100) * 9);
    html += `<button class="dot ${fav(c.id) ? "fav" : ""} ${highlight.has(c.id) ? "hit" : ""}" data-id="${esc(c.id)}" aria-label="${esc(c.title)}, deadline ${fmtDate(nextDeadline(c))}"
      style="left:${px}%;bottom:${28 + k * 15}px;width:${size}px;height:${size}px;background:${srcOf(c).color}"
      data-tip="${esc(`${fmtDate(nextDeadline(c))} · ${c.title}`)}"></button>`;
  }
  el.innerHTML = html;
  const tip = $("#tip");
  $$(".dot", el).forEach((b) => {
    b.onclick = () => openDrawer(b.dataset.id);
    const show = () => {
      tip.textContent = b.dataset.tip; tip.style.display = "block";
      const r = b.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 10, Math.max(10, r.left - 20)) + "px";
      tip.style.top = (r.top - tip.offsetHeight - 8) + "px";
    };
    b.onmouseenter = show; b.onfocus = show;
    b.onmouseleave = b.onblur = () => (tip.style.display = "none");
  });
}

function bindList(v) {
  const f = S.filters;
  const upd = () => { saveFilters(); refresh(); };
  $("#q").oninput = (e) => { f.q = e.target.value; clearTimeout(bindList._t); bindList._t = setTimeout(upd, 160); };
  $$("[data-src]", v).forEach((i) => (i.onchange = () => {
    const shown = $$("[data-src]", v).map((x) => x.dataset.src);
    f.sources = [...f.sources.filter((s) => !shown.includes(s)), ...$$("[data-src]:checked", v).map((x) => x.dataset.src)];
    upd();
  }));
  $$("[data-fgroup]", v).forEach((i) => {
    i.indeterminate = !!i.dataset.mixed;
    i.onchange = () => {
      const keys = FUNDER_GROUPS.find((g) => g.key === i.dataset.fgroup).keys;
      f.sources = i.checked ? [...new Set([...f.sources, ...keys])] : f.sources.filter((s) => !keys.includes(s));
      upd();
    };
  });
  $$("[data-status]", v).forEach((i) => (i.onchange = () => { f.status = $$("[data-status]:checked", v).map((x) => x.dataset.status); upd(); }));
  $$("[data-win]", v).forEach((b) => (b.onclick = () => { f.window = b.dataset.win; upd(); }));
  $("#minrel").oninput = (e) => { $("#minrel-v").textContent = e.target.value; };
  $("#minrel").onchange = (e) => { f.minRel = Number(e.target.value); upd(); };
  $("#favonly").onchange = (e) => { f.favOnly = e.target.checked; upd(); };
  $("#mineonly").onchange = (e) => { f.mineOnly = e.target.checked; upd(); };
  $("#showhidden") && ($("#showhidden").onclick = () => { f.showHidden = !f.showHidden; upd(); });
  $("#tagf") && ($("#tagf").onchange = (e) => { f.tag = e.target.value; upd(); });
  $("#ideaf") && ($("#ideaf").onchange = (e) => { f.idea = e.target.value; upd(); });
  $("#reset-f").onclick = () => { S.filters = { ...DEFAULT_FILTERS, sources: [...DEFAULT_FILTERS.sources], status: [...DEFAULT_FILTERS.status] }; upd(); };
  $("#toggle-f").onclick = () => $("#filters").classList.toggle("open");
  $$("[data-sort]", v).forEach((b) => (b.onclick = () => { S.sort = b.dataset.sort; LS.set("rv-sort", S.sort); refresh(); }));
  $("#newonly").onchange = (e) => { f.newOnly = e.target.checked; upd(); };
  const showNew = (on) => { f.newOnly = on; if (on) { f.status = ["open", "forthcoming"]; } upd(); window.scrollTo({ top: $(".layout")?.offsetTop - 10 || 0, behavior: "smooth" }); };
  $("#new-on") && ($("#new-on").onclick = () => showNew(true));
  $("#new-off") && ($("#new-off").onclick = () => showNew(false));
  $$("[data-newtag]", v).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); showNew(!f.newOnly); }));
  $("#ics").onclick = () => downloadIcs();
  $("#showsum").onchange = (e) => { S.showSummaries = e.target.checked; LS.set("rv-summaries", S.showSummaries); refresh(); };
  $$("[data-hz]", v).forEach((b) => (b.onclick = () => { S.horizon = Number(b.dataset.hz); LS.set("rv-horizon", S.horizon); refresh(); }));
  $("#add-call") && ($("#add-call").onclick = openAddCall);
  $("#go-ideas") && ($("#go-ideas").onclick = () => { S.view = "ideas"; LS.set("rv-view", "ideas"); S.idea.open = true; renderShell(); setTimeout(() => $("#idea-text")?.focus(), 50); });
  $$(".list .row", v).forEach((r) => {
    r.onclick = (e) => { if (!e.target.closest(".star, [data-newtag]")) openDrawer(r.dataset.id); };
    r.onkeydown = (e) => { if (e.key === "Enter") openDrawer(r.dataset.id); };
  });
  $$(".list [data-fav]", v).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleFav(b.dataset.fav); }));
}

async function toggleFav(id) {
  const favs = new Set(S.me.favorites || []);
  favs.has(id) ? favs.delete(id) : favs.add(id);
  S.me.favorites = [...favs];
  refresh();
  await S.store.saveMe({ favorites: S.me.favorites });
}

/* ================= Idea search ================= */

function activeCalls() { return S.calls.filter((c) => !isClosed(c)); }

function ideaPanelHtml() {
  const I = S.idea;
  if (!S.store.ideaSearchAvailable()) {
    return `<section class="idea"><p class="idea-off">Idea search is not set up yet. An administrator can turn it on by deploying the small Cloudflare Worker described in the README.</p></section>`;
  }
  const n = activeCalls().length;
  let results = "";
  if (I.status === "loading") {
    results = `<div class="idea-status" role="status"><span class="pulse" aria-hidden="true"></span>Claude is comparing your idea with ${n} open and upcoming calls. This can take up to a minute.<button class="linkbtn" id="idea-stop">Stop</button></div>`;
  } else if (I.status === "error") {
    results = `<div class="idea-status err" role="alert">${esc(I.error)}</div>`;
  } else if (I.status === "done") {
    const items = I.matches.map((m) => ({ m, c: S.byId.get(m.id) })).filter((x) => x.c);
    const linkable = I.name.trim() && isMember();
    results = `<div class="idea-results">
      <div class="idea-head"><b>${items.length ? `${items.length} suggested ${items.length === 1 ? "call" : "calls"}` : "No good matches"}</b>${I.offline ? `<span class="tag">keyword match</span>` : ""}<span class="spacer"></span>
        ${isMember() ? (I.name.trim() ? `<button class="btn ghost small" id="idea-save">${S.ideaDocs[I.name.trim()] ? `Save results to “${esc(I.name.trim())}”` : `Save as idea “${esc(I.name.trim())}”`}</button>` : `<button class="btn ghost small" id="idea-save-ask">Save as idea…</button>`) : ""}
        <button class="linkbtn" id="idea-clear">Clear results</button></div>
      ${I.note ? `<p class="idea-note">${esc(I.note)}</p>` : ""}
      ${I.strengthen?.length ? `<div class="strengthen"><h3>How to strengthen the idea for these calls</h3><ul>${I.strengthen.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${items.map(({ m, c }) => {
        const dl = nextDeadline(c);
        const linked = noteOf(c.id).idea === I.name.trim();
        return `<div class="match">
          <div class="fit" title="Fit with the idea, 0-100"><b>${m.fit}</b><span>fit</span></div>
          <div class="mbody">
            <button class="mtitle" data-open="${esc(c.id)}">${esc(c.title)}</button>
            <div class="m"><span>${esc(srcOf(c).short)}${c.programme && c.programme !== c.funder ? " · " + esc(c.programme) : ""}</span><span>${dl ? `deadline ${fmtDate(dl)} (${daysText(daysLeft(dl))})` : c.continuous ? "rolling call" : "deadline not known"}</span>${hiddenReason(c) ? `<span class="tag hiddenr">${HIDDEN_LABEL[hiddenReason(c)]}</span>` : ""}</div>
            ${m.why ? `<p>${esc(m.why)}</p>` : ""}
            ${m.angle ? `<p class="angle"><b>Angle:</b> ${esc(m.angle)}</p>` : ""}
          </div>
          <div class="mact">
            <button class="star" data-fav="${esc(c.id)}" aria-pressed="${fav(c.id)}" aria-label="${fav(c.id) ? "Remove from favourites" : "Add to favourites"}">${fav(c.id) ? STAR : STAR_O}</button>
            ${linkable ? (linked ? `<span class="tag idea">Linked</span>` : `<button class="btn ghost small" data-link="${esc(c.id)}">Link to idea</button>`) : ""}
          </div>
        </div>`;
      }).join("")}
      ${items.length && !I.name.trim() && isMember() ? `<p class="idea-note">Give the idea a name to save it and link suggested calls to it.</p>` : ""}
    </div>`;
  }
  return `<section class="idea" aria-labelledby="idea-h">
    <button class="idea-toggle" id="idea-toggle" aria-expanded="${I.open}"><span id="idea-h">Quick idea search</span><span class="chev" aria-hidden="true">${I.open ? "−" : "+"}</span></button>
    ${I.open ? `<p class="idea-intro">Try a thought without creating an idea first. Claude compares it with every open and upcoming call. Give it a name if you want to keep it.</p>` : ""}
    ${I.open ? `<form id="idea-form" class="idea-form">
      <label class="sr" for="idea-text">Describe the idea</label>
      <textarea id="idea-text" rows="3" maxlength="2000" placeholder="Describe a topic or project idea in a few sentences. For example: a pilot where a housing company shares rooftop PV and a battery between apartments, with vocational students doing the installation and monitoring.">${esc(I.text)}</textarea>
      <div class="idea-row">
        <label class="sr" for="idea-name">Idea name</label>
        <input id="idea-name" maxlength="120" placeholder="Idea name, optional (e.g. Housing company PV + storage)" value="${esc(I.name)}" list="idea-names">
        <datalist id="idea-names">${allIdeas().map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
        <button class="btn" type="submit" ${I.status === "loading" ? "disabled" : ""}>Find matching calls</button>
      </div>
    </form>${results}` : ""}
  </section>`;
}

function bindIdeaPanel() {
  const I = S.idea;
  $("#idea-toggle") && ($("#idea-toggle").onclick = () => { I.open = !I.open; LS.set("rv-idea-open", I.open); refresh(); });
  if (!$("#idea-form")) return;
  $("#idea-text").oninput = (e) => { I.text = e.target.value; LS.set("rv-idea-text", I.text); };
  $("#idea-name").oninput = (e) => { I.name = e.target.value; LS.set("rv-idea-name", I.name); };
  $("#idea-name").onchange = () => { if (I.status === "done") refresh(); };
  $("#idea-form").onsubmit = (e) => { e.preventDefault(); runIdeaSearch(); };
  $("#idea-stop") && ($("#idea-stop").onclick = () => I.ctl?.abort());
  $("#idea-clear") && ($("#idea-clear").onclick = () => { I.status = "idle"; I.matches = []; I.strengthen = []; I.note = ""; refresh(); });
  $("#idea-save-ask") && ($("#idea-save-ask").onclick = () => { toast("Give the idea a name first"); $("#idea-name")?.focus(); });
  $("#idea-save") && ($("#idea-save").onclick = async () => {
    const name = I.name.trim();
    const existing = S.ideaDocs[name];
    await S.store.saveIdea(name, { ...(existing ? {} : { status: "raw" }), ...(existing?.description ? {} : { description: I.text.trim() }), search: searchRecord(I) });
    toast(existing ? `Results saved to “${name}”` : `Idea “${name}” saved`);
  });
  $$(".idea [data-open]").forEach((b) => (b.onclick = () => openDrawer(b.dataset.open)));
  $$(".idea [data-fav]").forEach((b) => (b.onclick = () => toggleFav(b.dataset.fav)));
  $$(".idea [data-link]").forEach((b) => (b.onclick = async () => {
    const name = I.name.trim();
    await S.store.saveNote(b.dataset.link, { idea: name });
    // keep the idea's description with it, so Claude can analyse it for each linked call
    if (I.text.trim() && (S.ideaDocs[name]?.description || "") !== I.text.trim()) await S.store.saveIdea(name, I.text.trim());
    toast(`Linked to “${name}”`);
  }));
}

const IDEA_ERRORS = {
  rate_limited: "Too many searches right now. Wait a moment and try again.",
  not_configured: "Idea search is not set up yet.",
  network: "Could not reach the idea search service. Check your connection and try again.",
  refused: "Claude declined this request. Rephrase the idea and try again.",
  invalid_json: "Claude's answer could not be read. Try again.",
  prompt_too_large: "There are too many calls to compare at once. Try again later.",
  session_expired: "Your session has expired. Reload the page and sign in again.",
};

/** What is stored on an idea after a search. */
function searchRecord(r) {
  return { at: new Date().toISOString(), matches: (r.matches || []).slice(0, 8), strengthen: r.strengthen || [], note: r.note || "" };
}

/** Runs the idea search for a saved idea and stores the result on it. */
async function searchForIdea(name) {
  const i = S.ideaDocs[name] || { name };
  const ps = (i.pieces || []).map((id) => S.pieces.find((p) => p.id === id)).filter(Boolean);
  const pref = fundingLine(i) ? `Preferred funding: ${fundingLine(i)}.` : "";
  const text = [i.description || i.name, pref, ps.length ? "Building blocks: " + ps.map((p) => `${KIND_LABEL[p.kind]}: ${p.title}${p.description ? " - " + p.description : ""}`).join("; ") : ""].filter(Boolean).join("\n");
  if (text.length < 15) { toast("Add a description to the idea first"); openIdeaEditor(name); return; }
  S.cardSearch[name] = { status: "loading" }; refresh();
  try {
    const res = await S.store.suggestCalls({ idea: text.slice(0, 2000), ideaName: name, lines: activeCalls().map(callLine) });
    await S.store.saveIdea(name, { search: searchRecord(res) });
    S.cardSearch[name] = { status: "done", open: true };
  } catch (e) {
    S.cardSearch[name] = { status: "error", error: IDEA_ERRORS[e?.code] || e?.message || "The idea search failed. Try again." };
  }
  refresh();
}

async function runIdeaSearch() {
  const I = S.idea;
  const idea = I.text.trim();
  if (idea.length < 15) { toast("Describe the idea in at least one sentence."); $("#idea-text")?.focus(); return; }
  const calls = activeCalls();
  I.ctl = new AbortController();
  I.status = "loading"; I.error = ""; refresh();
  try {
    const res = await S.store.suggestCalls({ idea, ideaName: I.name.trim(), lines: calls.map(callLine), signal: I.ctl.signal });
    I.matches = res.matches || []; I.strengthen = res.strengthen || []; I.note = res.note || ""; I.offline = !!res.offline; I.status = "done";
  } catch (e) {
    if (e?.code === "cancelled") { I.status = "idle"; }
    else { I.status = "error"; I.error = IDEA_ERRORS[e?.code] || e?.message || "The idea search failed. Try again."; }
  }
  refresh();
}

/* ================= Call details (side panel) ================= */

function openDrawer(id) {
  if (!S.byId.has(id)) return;
  S.openId = id;
  S.lastFocus = document.activeElement;
  $("#drawer-root").innerHTML = `<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" id="drawer"></aside>`;
  $("#scrim").onclick = closeDrawer;
  document.addEventListener("keydown", escClose);
  S.comments = [];
  renderDrawerBody();
  S.unsubComments = S.store.watchComments(id, (cs) => { S.comments = cs; renderComments(); });
  loadRadarFor(S.byId.get(id));
  ensureNetwork();
  $("#drawer .close")?.focus();
}
function escClose(e) { if (e.key === "Escape" && !$(".modal")) closeDrawer(); }
function closeDrawer() {
  S.unsubComments?.(); S.unsubComments = null; S.openId = null;
  $("#drawer-root").innerHTML = "";
  document.removeEventListener("keydown", escClose);
  S.lastFocus?.focus?.();
}

function renderDrawerBody() {
  const dr = $("#drawer");
  if (!dr) return;
  const c = S.byId.get(S.openId);
  const n = noteOf(c.id);
  const src = srcOf(c);
  const dl = nextDeadline(c);
  const editable = isMember();
  const keepComposer = $("#cm-text")?.value || "";
  const scroll = dr.scrollTop;
  const facts = [
    ["Funder", c.funder],
    ["Programme", c.programme !== c.funder ? c.programme : ""],
    ["Identifier", c.call_id],
    ["Type of action", c.action_type],
    ["Status", isClosed(c) ? "Closed" : { open: "Open", forthcoming: "Upcoming" }[c.status] || c.status],
    ["Opens", fmtDate(c.opens)],
    [c.continuous && (c.deadlines || []).length ? "Selection periods end" : "Deadline", (c.deadlines || []).length ? c.deadlines.map((d) => `${fmtDate(d)}${d === dl ? ` (${daysText(daysLeft(d))})` : ""}`).join(", ") + (c.deadline_time ? ` · closes ${c.deadline_time}` : "") : c.continuous ? "Rolling call" : c.deadline_text || "Not known – check the funder's page"],
    ["Region / countries", c.region],
    ["First seen", fmtDate(c.firstSeen)],
  ].filter(([, v]) => v);
  dr.innerHTML = `
  <header>
    <div class="srcline"><i style="background:${src.color}"></i>${esc(src.label)}${isNew(c) ? ` <span class="tag new">New</span>` : ""}${hiddenReason(c) ? ` <span class="tag hiddenr">${HIDDEN_LABEL[hiddenReason(c)]}</span>` : ""}</div>
    <h2 id="dr-title">${esc(c.title)}</h2>
    <button class="close" aria-label="Close">×</button>
    <div class="actions">
      <a class="btn" href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">Open funder's page</a>
      <button class="btn ghost" id="dr-fav" aria-pressed="${fav(c.id)}">${fav(c.id) ? "★ Favourite" : "☆ Add to favourites"}</button>
      ${dl ? `<button class="btn ghost" id="dr-ics">Deadline to calendar</button>` : ""}
      ${c.source === "manual" && (isAdmin() || c.createdBy === S.store.user.email) ? `<button class="btn danger" id="dr-del">Delete call</button>` : ""}
    </div>
  </header>
  ${c.aiSummary ? `<section class="ai-sum"><h3>Summary by Claude</h3><p>${esc(c.aiSummary)}</p></section>` : ""}
  <section>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${c.summary ? `<p class="summary">${esc(c.summary)}</p>` : ""}
    ${(c.auto_tags || []).length || (c.aiTags || []).length ? `<div class="chips" style="margin-top:10px">${[...new Set([...(c.aiTags || []), ...(c.auto_tags || [])])].map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  </section>
  <section>
    <h3>Relevance</h3>
    ${c.aiScore != null
      ? `<div class="ai-box"><span class="score">${c.aiScore}/100</span> Claude's assessment${c.aiEligible ? ` · UAS eligible: ${esc(c.aiEligible)}` : ""}<p>${esc(c.aiReason || "")}</p></div>`
      : `<div class="ai-box" style="border-color:var(--line)"><span class="score">${c.relevance ?? 0}/100</span> from keywords<p>Claude assesses the call once an API key is added to the collector.</p></div>`}
    ${ratingHtml(c)}
  </section>
  <section>
    <h3>Team notes</h3>
    <div class="field"><label for="dr-idea">Project idea</label>
      ${editable ? `<input id="dr-idea" list="dr-ideas" maxlength="120" placeholder="Name of the project idea this call could fund" value="${esc(n.idea || "")}">
      <datalist id="dr-ideas">${allIdeas().map((t) => `<option value="${esc(t)}">`).join("")}</datalist>` : `<div>${esc(n.idea || "—")}</div>`}</div>
    <div class="field"><span class="lbl">Stage</span>
      <div class="stages">${STAGES.map(([k, l]) => `<button data-stage="${k}" aria-pressed="${(n.stage || "") === k}" ${editable ? "" : "disabled"}>${l}</button>`).join("")}</div></div>
    <div class="field"><span class="lbl">People involved in preparation</span>${chipEditor("people", (n.people || []).map((p) => [p, personName(p)]), editable, "Add a person…")}</div>
    <div class="field"><span class="lbl">Potential partners</span>${chipEditor("partners", (n.partners || []).map((p) => [p, S.partners.find((x) => x.id === p)?.name || "(deleted)"]), editable, "Add a partner…")}</div>
    <div class="field"><span class="lbl">Tags</span>${chipEditor("tags", (n.tags || []).map((t) => [t, t]), editable, "Add a tag and press Enter")}</div>
  </section>
  ${radarHtml(c)}
  ${developHtml(c, n)}
  <section>
    <h3>Comments</h3>
    <div class="comments" id="comments"></div>
    <form class="composer" id="composer">
      <label class="sr" for="cm-text">Comment</label>
      <textarea id="cm-text" placeholder="Write a comment. Mention someone with @."></textarea>
      <div class="row2"><span>Mentioned people are added to the people involved.</span><button class="btn" type="submit">Post comment</button></div>
    </form>
  </section>`;
  $("#cm-text").value = keepComposer;
  dr.scrollTop = scroll;
  bindDrawer(c, editable);
  renderComments();
}

/* ---- Claude's analysis of a linked project idea for this call ---- */

function developHtml(c, n) {
  if (!S.store.ideaSearchAvailable() && S.store.mode !== "demo") return "";
  if (!n.idea) {
    return `<section class="develop"><h3>Develop an idea for this call</h3>
      <p class="hint">Link this call to a project idea in the team notes${isMember() ? " below" : ""}, and Claude can assess how the idea fits the call: gaps, partners needed, risks and next steps.</p></section>`;
  }
  const D = S.develop[c.id] || {};
  const desc = D.draft ?? S.ideaDocs[n.idea]?.description ?? "";
  const r = D.result;
  const block = (title, items, ordered) => items?.length ? `<h4>${title}</h4><${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>` : "";
  return `<section class="develop" aria-labelledby="dev-h">
    <h3 id="dev-h">Develop “${esc(n.idea)}” for this call</h3>
    ${isMember() ? `<div class="field"><label for="dev-desc">The idea in a few sentences</label>
      <textarea id="dev-desc" rows="3" maxlength="2000" placeholder="What would the project do, with whom, and what would it produce? Shared with the team as the description of this idea.">${esc(desc)}</textarea></div>
      <div class="dev-row"><button class="btn" id="dev-run" ${D.status === "loading" ? "disabled" : ""}>${r ? "Analyse again" : "Analyse with Claude"}</button>
      <span class="hint">Claude reads the call text and the team profile. About 1–2 cents per analysis.</span></div>`
      : `<p class="hint">${esc(desc || "No description yet.")}</p>`}
    ${D.status === "loading" ? `<div class="idea-status" role="status"><span class="pulse" aria-hidden="true"></span>Claude is reading the call and assessing the idea. This takes up to a minute.</div>` : ""}
    ${D.status === "error" ? `<div class="idea-status err" role="alert">${esc(D.error)}</div>` : ""}
    ${r ? `<div class="dev-result">
      <div class="dev-head"><div class="fit"><b>${r.fit}</b><span>fit</span></div><p>${esc(r.verdict)}</p></div>
      ${block("What already fits", r.matches)}${block("Gaps to close", r.gaps)}${block("Partners and roles needed", r.consortium)}${block("Risks", r.risks)}${block("Next steps", r.next_steps, true)}
      ${r.hadCallText === false ? `<p class="hint">Based on the call summary only; the full call text is saved on the next nightly run.</p>` : ""}
      <button class="btn ghost small" id="dev-post">Post to comments</button>
    </div>` : ""}
  </section>`;
}

function developText(name, r) {
  const list = (t, xs, ordered) => (xs?.length ? `\n\n${t}:\n${xs.map((x, i) => `${ordered ? i + 1 + "." : "•"} ${x}`).join("\n")}` : "");
  return `Claude's analysis of “${name}” for this call (fit ${r.fit}/100)\n\n${r.verdict}`
    + list("What already fits", r.matches) + list("Gaps to close", r.gaps) + list("Partners and roles needed", r.consortium)
    + list("Risks", r.risks) + list("Next steps", r.next_steps, true);
}

async function runDevelop(c) {
  const n = noteOf(c.id);
  const D = (S.develop[c.id] ||= {});
  const desc = ($("#dev-desc")?.value ?? D.draft ?? S.ideaDocs[n.idea]?.description ?? "").trim();
  D.draft = desc;
  if (desc && desc !== (S.ideaDocs[n.idea]?.description || "")) S.store.saveIdea(n.idea, desc);
  D.status = "loading"; D.error = ""; renderDrawerBody();
  try {
    const dl = (c.deadlines || []).join(", ") || (c.continuous ? "rolling" : c.deadline_text || "-");
    const call = [`${c.title}`, `Funder: ${c.funder}${c.programme && c.programme !== c.funder ? " / " + c.programme : ""}`, c.call_id && `Identifier: ${c.call_id}`,
      c.action_type && `Type of action: ${c.action_type}`, `Opens: ${c.opens || "-"}; deadline(s): ${dl}${c.deadline_time ? " " + c.deadline_time : ""}`,
      c.region && `Region / countries: ${c.region}`, `Summary: ${c.aiSummary || c.summary || "-"}`].filter(Boolean).join("\n");
    D.result = await S.store.developIdea({ callId: c.id, ideaName: n.idea, idea: desc, call, callText: c.summary || "" });
    D.status = "done";
  } catch (e) {
    D.status = "error";
    D.error = IDEA_ERRORS[e?.code] || e?.message || "The analysis failed. Try again.";
  }
  if (S.openId === c.id) renderDrawerBody();
}

const VOTES = [[1, "👍", "Relevant"], [0, "🤷", "Maybe"], [-1, "👎", "Not relevant"]];
function ratingHtml(c) {
  const r = ratingOf(c.id);
  const mine = r.mine;
  return `<div class="rate" id="rate">
    <div class="rate-q"><span id="rate-l">Is this relevant for us?</span>
      <div class="rate-btns" role="group" aria-labelledby="rate-l">${VOTES.map(([v, e, l]) => `<button data-vote="${v}" aria-pressed="${mine?.v === v}" title="${l}">${e} <span>${l}</span></button>`).join("")}</div></div>
    ${mine ? `<div class="rate-why"><label class="sr" for="rate-reason">Why (optional)</label><input id="rate-reason" maxlength="300" placeholder="Why? e.g. wrong TRL, we can't be a partner, perfect fit for our pilot" value="${esc(mine.reason || "")}"></div>` : ""}
    ${r.list.length ? `<ul class="rate-list">${r.list.map((x) => `<li>${x.v === 1 ? "👍" : x.v === -1 ? "👎" : "🤷"} <b>${esc(x.name)}</b>${x.reason ? ` – ${esc(x.reason)}` : ""}</li>`).join("")}</ul>` : ""}
    <p class="hint">The team's answers are shown to Claude as examples when it assesses new calls, and the Profile tab shows how well its scores match.</p>
  </div>`;
}

function chipEditor(kind, items, editable, placeholder) {
  return `<div class="chips" data-kind="${kind}">
    ${items.map(([v, l]) => `<span class="chip">${esc(l)}${editable ? `<button aria-label="Remove ${esc(l)}" data-rm="${esc(v)}">×</button>` : ""}</span>`).join("")}
    ${editable ? `<span class="composer" style="flex:1;min-width:150px"><input class="chip-input" data-add="${kind}" placeholder="${placeholder}" autocomplete="off" aria-label="${placeholder}"></span>` : ""}
  </div>`;
}

function bindDrawer(c, editable) {
  const dr = $("#drawer");
  $(".close", dr).onclick = closeDrawer;
  $("#dr-fav").onclick = () => toggleFav(c.id);
  $$("[data-rmore]", dr).forEach((b) => (b.onclick = () => { const k = c.id + b.dataset.rmore; S.radarOpen = S.radarOpen === k ? null : k; renderDrawerBody(); }));
  $("#dev-desc") && ($("#dev-desc").oninput = (e) => { (S.develop[c.id] ||= {}).draft = e.target.value; });
  $("#dev-run") && ($("#dev-run").onclick = () => runDevelop(c));
  $("#dev-post") && ($("#dev-post").onclick = async () => {
    await S.store.addComment(c.id, developText(noteOf(c.id).idea, S.develop[c.id].result), []);
    toast("Analysis posted to the comments");
  });
  $$("[data-vote]", dr).forEach((b) => (b.onclick = async () => {
    const v = Number(b.dataset.vote);
    const mine = ratingOf(c.id).mine;
    await S.store.saveRating(c.id, mine?.v === v ? null : v, mine?.v === v ? "" : mine?.reason || "");
    if (mine?.v !== v) setTimeout(() => $("#rate-reason")?.focus(), 50);
  }));
  $("#rate-reason") && ($("#rate-reason").onchange = (e) => S.store.saveRating(c.id, ratingOf(c.id).mine?.v ?? 0, e.target.value.trim()));
  $("#rate-reason") && ($("#rate-reason").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); toast("Thanks – noted"); } });
  $("#dr-ics") && ($("#dr-ics").onclick = () => downloadIcs([c]));
  $("#dr-del") && ($("#dr-del").onclick = async () => {
    if (!(await askConfirm("Delete this call you added?"))) return;
    await S.store.deleteManualCall(c.id); closeDrawer(); await reloadCalls(); toast("Call deleted");
  });
  const n = () => noteOf(c.id);
  if (editable) {
    const ideaInput = $("#dr-idea");
    const saveIdea = () => {
      const v = ideaInput.value.trim();
      if (v !== (n().idea || "")) { S.store.saveNote(c.id, { idea: v }); toast(v ? `Project idea set: ${v}` : "Project idea removed"); }
    };
    ideaInput.onchange = saveIdea;
    ideaInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ideaInput.blur(); } };
    $$("[data-stage]", dr).forEach((b) => (b.onclick = () => S.store.saveNote(c.id, { stage: b.dataset.stage })));
    $$(".chips[data-kind]", dr).forEach((box) => {
      const kind = box.dataset.kind;
      $$("[data-rm]", box).forEach((b) => (b.onclick = () => S.store.saveNote(c.id, { [kind]: (n()[kind] || []).filter((x) => x !== b.dataset.rm) })));
      const input = $("[data-add]", box);
      const add = async (val) => {
        if (!val) return;
        const list = n()[kind] || [];
        if (kind === "partners" && val.startsWith("org:")) {
          const o = networkModel().orgs.find((x) => x.key === val.slice(4));
          if (!o) return;
          val = o.doc?.id || await S.store.savePartner({ name: o.name, country: o.country, type: ORG_TYPE[o.type], contact: "", email: "", notes: "", ...(o.id ? { cordisId: o.id } : {}) });
        }
        if (kind === "partners" && val.startsWith("new:")) {
          const name = val.slice(4);
          val = await S.store.savePartner({ name, country: "", type: "", contact: "", email: "", notes: "" });
          toast(`${name} added to the partner list`);
        }
        if (!list.includes(val)) S.store.saveNote(c.id, { [kind]: [...list, val] });
      };
      const options = (q) => {
        q = q.toLowerCase();
        if (kind === "people") {
          const opts = S.allow.filter((a) => !(n().people || []).includes(a.email) && (a.name + a.email).toLowerCase().includes(q)).map((a) => [a.email, a.name || a.email, a.org || ""]);
          if (q && !opts.length) opts.push([input.value.trim(), input.value.trim(), "add as text"]);
          return opts;
        }
        if (kind === "partners") {
          const opts = S.partners.filter((p) => !(n().partners || []).includes(p.id) && p.name.toLowerCase().includes(q)).map((p) => [p.id, p.name, p.country || ""]);
          if (q.length >= 2 && S.net) {
            for (const o of networkModel().orgs) {
              if (opts.length >= 12) break;
              if (!o.doc && o.name.toLowerCase().includes(q)) opts.push(["org:" + o.key, o.name, `${o.country} · ${REL[o.rel].toLowerCase()}`]);
            }
          }
          if (q && !S.partners.some((p) => p.name.toLowerCase() === q)) opts.push(["new:" + input.value.trim(), `Add new: ${input.value.trim()}`, ""]);
          return opts;
        }
        return allTags().filter((t) => !(n().tags || []).includes(t) && t.toLowerCase().includes(q)).map((t) => [t, t, ""]);
      };
      attachSuggest(input, options, (val) => add(val), kind === "tags");
    });
  }
  $("#composer").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#cm-text").value.trim();
    if (!text) return;
    const mentions = S.allow.filter((a) => a.name && text.includes("@" + a.name)).map((a) => a.email);
    $("#cm-text").value = "";
    await S.store.addComment(c.id, text, mentions);
    if (mentions.length && isMember()) {
      const people = new Set([...(n().people || []), ...mentions]);
      S.store.saveNote(c.id, { people: [...people] });
    }
  };
  attachSuggest($("#cm-text"), (q) => S.allow.filter((a) => (a.name + a.email).toLowerCase().includes(q.toLowerCase())).map((a) => [a.email, a.name || a.email, a.org || ""]),
    (email, ta, range) => {
      const a = S.allow.find((x) => x.email === email);
      const label = "@" + (a?.name || email) + " ";
      ta.value = ta.value.slice(0, range[0]) + label + ta.value.slice(range[1]);
      ta.focus(); ta.setSelectionRange(range[0] + label.length, range[0] + label.length);
    }, false, true);
}

// Suggestion list: for chip inputs (whole value) and the comment box (@mention at the caret)
function attachSuggest(input, getOptions, onPick, freeText, mentionMode = false) {
  let box = null, opts = [], sel = 0, range = [0, 0];
  const close = () => { box?.remove(); box = null; };
  const show = () => {
    let q = input.value.trim();
    if (mentionMode) {
      const upto = input.value.slice(0, input.selectionStart);
      const m = upto.match(/@([\p{L}\p{N}._-]*)$/u);
      if (!m) return close();
      q = m[1]; range = [input.selectionStart - m[0].length, input.selectionStart];
    }
    opts = getOptions(q).slice(0, 8);
    if (!opts.length || (!q && !mentionMode && document.activeElement !== input)) return close();
    if (!box) { box = document.createElement("div"); box.className = "suggest"; box.setAttribute("role", "listbox"); input.parentElement.appendChild(box); }
    sel = Math.min(sel, opts.length - 1);
    box.innerHTML = opts.map(([v, l, h], i) => `<button type="button" role="option" aria-selected="${i === sel}" data-v="${esc(v)}">${esc(l)}${h ? `<small>${esc(h)}</small>` : ""}</button>`).join("");
    box.style.left = "0"; box.style.top = input.offsetTop + input.offsetHeight + 4 + "px";
    $$("button", box).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(b.dataset.v); }));
  };
  const pick = (v) => { close(); if (!mentionMode) input.value = ""; onPick(v, input, range); };
  input.addEventListener("input", () => { sel = 0; show(); });
  input.addEventListener("focus", () => { if (!mentionMode) show(); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (box && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; show();
    } else if (e.key === "Enter" && !e.shiftKey && (box || (!mentionMode && freeText))) {
      if (mentionMode && !box) return;
      e.preventDefault();
      if (box && opts[sel]) pick(opts[sel][0]);
      else if (freeText && input.value.trim()) pick(input.value.trim());
    } else if (e.key === "Escape" && box) { e.stopPropagation(); close(); }
  });
}

function renderComments() {
  const el = $("#comments");
  if (!el) return;
  const me = S.store.user.email;
  const fmt = (t) => esc(t).replace(/@([\p{L}][\p{L}\p{N}._-]*(?: [\p{L}][\p{L}\p{N}._-]*)?)/gu, (m, name) =>
    S.allow.some((a) => a.name === name) ? `<span class="mention">@${name}</span>` : m);
  el.innerHTML = S.comments.length ? S.comments.map((c) => `
    <div class="comment">
      <div class="h"><b>${esc(c.authorName || c.author)}</b><span>${new Date(c.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      ${c.author === me || isAdmin() ? `<button class="linkbtn del" data-cdel="${esc(c.id)}">Delete</button>` : ""}</div>
      <p>${fmt(c.text)}</p>
    </div>`).join("") : `<p class="summary" style="margin:0">No comments yet.</p>`;
  $$("[data-cdel]", el).forEach((b) => (b.onclick = async () => { if (await askConfirm("Delete this comment?")) S.store.deleteComment(S.openId, b.dataset.cdel); }));
}

/* ================= Partner network (CORDIS) ================= */

const ORG_TYPE = { HES: "University", REC: "Research organisation", PRC: "Company", PUB: "Public body", OTH: "Other" };
const ORG_TYPE_PL = { HES: "universities", REC: "research organisations", PRC: "companies", PUB: "public bodies", OTH: "others" };
// Rough country centres for partners added by hand without coordinates (CORDIS codes: EL = Greece, UK)
const COUNTRY_XY = { FI: [62.5, 25.5], SE: [60.1, 15.6], NO: [60.5, 8.5], DK: [56.0, 9.5], EE: [58.7, 25.5], LV: [56.9, 24.9], LT: [55.3, 23.9],
  DE: [51.1, 10.4], NL: [52.2, 5.5], BE: [50.6, 4.6], LU: [49.8, 6.1], FR: [46.6, 2.4], ES: [40.3, -3.7], PT: [39.6, -8.0], IT: [42.8, 12.6],
  AT: [47.6, 14.1], CH: [46.8, 8.2], PL: [52.1, 19.4], CZ: [49.8, 15.5], SK: [48.7, 19.7], HU: [47.2, 19.5], SI: [46.1, 14.8], HR: [45.1, 15.2],
  RO: [45.9, 24.9], BG: [42.7, 25.5], EL: [39.1, 22.0], GR: [39.1, 22.0], CY: [35.0, 33.2], MT: [35.9, 14.4], IE: [53.4, -8.0], UK: [54.0, -2.5],
  GB: [54.0, -2.5], IS: [64.9, -18.6], RS: [44.0, 20.9], TR: [39.0, 35.2], UA: [49.0, 31.4], AL: [41.1, 20.0], US: [39.8, -98.6], CA: [56.1, -106.3] };

async function ensureNetwork() {
  if (S.net || S.netLoading || !isMember()) return;
  S.netLoading = true;
  const [net, pf, info] = await Promise.all([
    S.store.loadNetwork().catch((e) => ({ projects: [], orgs: [], error: e.message })),
    S.store.loadPortfolio().catch(() => null),
    S.store.loadOrgInfo().catch(() => ({})),
  ]);
  S.net = net; S.portfolio = pf; S.orgInfo = info || {};
  S.netLoading = false;
  if (S.view === "partners") refresh(); else if (S.openId) renderDrawerBody();
}

const TYPE_CODE = { university: "HES", "university of applied sciences": "HES", "vet provider": "HES", "research institute": "REC", "research organisation": "REC",
  company: "PRC", "public body": "PUB", other: "OTH" };
const typeCode = (t) => (ORG_TYPE[t] ? t : TYPE_CODE[String(t || "").toLowerCase()] || "OTH");
const REL = { nerc: "Worked with us", tuas: "Worked with Turku UAS", potential: "Potential partner" };

/** Every organisation: CORDIS partners, partners of projects added by hand, and the team's partner list. */
function networkModel() {
  const net = S.net || { projects: [], orgs: [] };
  const pf = S.portfolio || { projects: [], orgs: [] };
  const docOf = (id) => S.netProjects.find((x) => x.id === id);
  // NERC's own projects: register projects coordinated by NERC (or ticked), and EU projects ticked or with the same acronym
  const pfNerc = new Set(pf.projects.filter((p) => docOf("pf-" + p.id)?.nerc ?? p.nerc).map((p) => p.id));
  const nercAcr = new Set(pf.projects.filter((p) => pfNerc.has(p.id)).map((p) => normName(p.acronym)));
  const nercPids = new Set(net.projects.filter((p) => docOf("cordis-" + p.pid)?.nerc ?? nercAcr.has(normName(p.acronym))).map((p) => p.pid));
  const closeIds = new Set(S.netProjects.filter((p) => p.kind === "cordis").flatMap((p) => p.close || []));
  const projById = Object.fromEntries(net.projects.map((p) => [p.pid, p]));
  const byName = new Map(), byId = new Map();
  const remember = (o, ...names) => names.forEach((n) => { const k = normName(n); if (k && !byName.has(k)) byName.set(k, o); });
  const orgs = net.orgs.map((o) => {
    const x = { ...o, key: "c:" + o.id, ids: [o.id], nercProjects: o.projects.filter((p) => nercPids.has(p)), manual: [], pf: [], doc: null, aliases: [o.name] };
    remember(x, o.name); byId.set(o.id, x);
    return x;
  });
  const add = (key, base) => { const o = { geo: null, ids: [], projects: [], coordinated: [], nercProjects: [], manual: [], pf: [], doc: null, aliases: [base.name], ...base, key }; orgs.push(o); remember(o, o.name); return o; };
  // candidate names: "Turun yliopisto (University of Turku)" -> itself, "Turun yliopisto", "University of Turku", + register variants
  const pfOrg = new Map(pf.orgs.map((o) => [o.name, o]));
  const candidates = (name) => {
    const r = pfOrg.get(name);
    const inner = (name.match(/\(([^)]+)\)/) || [])[1];
    return [name, name.replace(/\s*\([^)]*\)\s*/g, " ").trim(), inner, ...(r?.variants || [])].filter(Boolean);
  };
  const find = (name) => { for (const c of candidates(name)) { const o = byName.get(normName(c)); if (o) return o; } return null; };
  for (const mp of S.netProjects.filter((p) => p.kind === "manual")) {
    for (const pt of mp.partners || []) {
      if (!normName(pt.name)) continue;
      const o = find(pt.name) || add("m:" + normName(pt.name), { id: "", name: pt.name, country: (pt.country || "").toUpperCase(), city: pt.city || "", type: typeCode(pt.type) });
      o.manual.push({ id: mp.id, name: mp.name, nerc: mp.nerc !== false, programme: mp.programme, close: !!pt.close });
    }
  }
  for (const p of pf.projects) {
    const closeSet = new Set(docOf("pf-" + p.id)?.close || []);
    for (const [name, role] of p.partners) {
      const r = pfOrg.get(name);
      let o = find(name);
      if (!o) o = add("h:" + normName(name), { id: "", name, country: r && !r.intl ? "FI" : "", city: "", type: r?.type || "OTH" });
      if (!o.aliases.includes(name)) { o.aliases.push(name); remember(o, ...candidates(name)); }
      if (r && o.type === "OTH" && r.type !== "OTH") o.type = r.type;
      o.pf.push({ id: p.id, acronym: p.acronym || p.title, title: p.title, instrument: p.instrument, start: p.start, end: p.end, stage: p.stage,
        nerc: pfNerc.has(p.id), role, partnerName: name, close: closeSet.has(normName(name)) });
    }
  }
  for (const d of S.partners) {
    const o = (d.cordisId && byId.get(d.cordisId)) || find(d.name)
      || add("p:" + d.id, { id: "", name: d.name, country: String(d.country || "").toUpperCase().slice(0, 2), city: "", type: typeCode(d.type) });
    o.doc = d;
  }
  // the team's merges: orgInfo/{name}.sameAs = {target name}; the source's projects move to the target
  const gone = new Set();
  for (const [k, inf] of Object.entries(S.orgInfo || {})) {
    if (!inf?.sameAs) continue;
    const src = byName.get(k), dst = byName.get(inf.sameAs);
    if (!src || !dst || src === dst || gone.has(src) || gone.has(dst)) continue;
    for (const f of ["ids", "projects", "coordinated", "nercProjects"]) dst[f] = [...new Set([...dst[f], ...src[f]])];
    dst.manual.push(...src.manual); dst.pf.push(...src.pf.filter((x) => !dst.pf.some((y) => y.id === x.id)));
    dst.merged = [...(dst.merged || []), ...(src.merged || []), { name: src.name, key: k }];
    for (const n of src.aliases) if (!dst.aliases.includes(n)) dst.aliases.push(n);
    dst.doc ||= src.doc; dst.geo ||= src.geo; dst.country ||= src.country; dst.city ||= src.city;
    if (dst.type === "OTH") dst.type = src.type;
    for (const [n, o] of byName) if (o === src) byName.set(n, dst);
    gone.add(src);
  }
  if (gone.size) orgs.splice(0, orgs.length, ...orgs.filter((o) => !gone.has(o)));
  for (const o of orgs) {
    o.label = o.doc?.name || o.name;
    o.info = o.aliases.map((n) => S.orgInfo?.[normName(n)]).find((x) => x && (x.description || x.lat != null || x.notFound)) || null;
    const euAcr = new Set(o.projects.map((p) => normName(projById[p]?.acronym || "")));
    o.pfOnly = o.pf.filter((x) => !euAcr.has(normName(x.acronym)));          // the same EU project is listed once
    o.count = o.projects.length + o.manual.length + o.pfOnly.length;
    o.nercCount = o.nercProjects.length + o.manual.filter((m) => m.nerc).length + o.pfOnly.filter((x) => x.nerc).length;
    o.rel = o.nercCount ? "nerc" : o.count ? "tuas" : "potential";
    o.close = o.ids.some((i) => closeIds.has(i)) || o.manual.some((m) => m.close) || o.pf.some((x) => x.close) || !!o.doc?.close;
    o.nerc = o.rel === "nerc";
    if (!o.country && o.info?.country) o.country = String(o.info.country).toUpperCase();
    if (!o.city && o.info?.city) o.city = o.info.city;
    const h = [...o.name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);   // stable small offset
    const infoGeo = Number.isFinite(o.info?.lat) && Number.isFinite(o.info?.lon) ? [o.info.lat, o.info.lon] : null;
    o.xy = o.geo || infoGeo || (COUNTRY_XY[o.country] ? [COUNTRY_XY[o.country][0] + ((h % 100) / 100 - 0.5) * 0.8, COUNTRY_XY[o.country][1] + (((h >> 8) % 100) / 100 - 0.5) * 1.2] : null);
    o.projectNames = [...o.projects.map((p) => projById[p]?.acronym || p), ...o.manual.map((m) => m.name), ...o.pfOnly.map((x) => x.acronym)];
    o.projectKeys = [...o.projects.map((p) => "c:" + p), ...o.manual.map((m) => "m:" + m.id), ...o.pf.map((x) => "h:" + x.id)];
  }
  return { orgs, projById, nercPids, pfNerc, net, pf, byName };
}

// legal forms and filler words that differ between spellings of the same organisation
const NAME_NOISE = new Set("OY OYJ AB AS ASA APS A S GMBH AG SE SA SAS SARL SL SLU SPA SRL BV NV LTD LIMITED PLC INC LLC KY RY RF SR STICHTING FUNDACION FUNDACIO FONDAZIONE STIFTUNG ASSOCIATION VEREIN EV E V THE OF DE DER DES DEL DI LA LE FUER FUR AND UND ET Y".split(" "));
const SYNONYM = { HOGESCHOOL: "UAS", AMMATTIKORKEAKOULU: "UAS", HOCHSCHULE: "UAS", FACHHOCHSCHULE: "UAS", YRKESHOGSKOLA: "UAS", YLIOPISTO: "UNIVERSITY", UNIVERSITEIT: "UNIVERSITY", UNIVERSITAT: "UNIVERSITY", UNIVERSIDAD: "UNIVERSITY", UNIVERSITA: "UNIVERSITY", UNIVERSITE: "UNIVERSITY", UNIVERSIDADE: "UNIVERSITY", UNIWERSYTET: "UNIVERSITY", KAUPUNKI: "CITY", STAD: "CITY", GEMEENTE: "CITY" };
function nameCore(name) {
  let s = normName(name).replace(/UNIVERSITY OF APPLIED SCIENCES?/g, "UAS");
  return s.split(" ").map((w) => SYNONYM[w] || w).filter((w) => w.length > 2 && !NAME_NOISE.has(w)).sort().join(" ");
}
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Groups of organisations that look like the same one: same name without legal forms, or the same website (from the AI descriptions). */
function duplicateGroups(M) {
  const dismissed = new Set(LS.get("rv-dup-dismissed", []));
  const groups = new Map();
  const put = (k, o) => { if (!k) return; if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(o); };
  for (const o of M.orgs) {
    const core = nameCore(o.name);
    if (core.replace(/ /g, "").length >= 4) put("n:" + core, o);
    const info = o.aliases.map((n) => S.orgInfo?.[normName(n)]).find((x) => x?.website);
    if (info) put("w:" + domainOf(info.website), o);
  }
  const out = [], seen = new Set();
  for (const [, set] of groups) {
    const list = [...set];
    if (list.length < 2 || list.length > 6) continue;
    const id = list.map((o) => o.key).sort().join("|");
    if (seen.has(id) || dismissed.has(id)) continue;
    seen.add(id); out.push({ id, orgs: list.sort((a, b) => (b.key.startsWith("c:") - a.key.startsWith("c:")) || b.count - a.count) });
  }
  return out;
}

async function mergeOrgs(target, others) {
  for (const o of others) await S.store.saveOrgMerge(normName(o.name), normName(target.name));
  S.orgInfo = await S.store.loadOrgInfo();
}

function openDuplicates() {
  const M = networkModel();
  const groups = duplicateGroups(M);
  const row = (o) => `<b>${esc(o.label)}</b> <span class="hint">${esc([o.city, o.country].filter(Boolean).join(", "))} · ${o.count} project${o.count === 1 ? "" : "s"}${o.key.startsWith("c:") ? " · EU" : o.key.startsWith("h:") ? " · register" : ""}</span>`;
  modal(`<h2>Possible duplicates</h2>
    <p class="hint">The same organisation can be spelled differently in the EU data, the partner register and the team's list. These look alike by name or website. <b>Merge</b> keeps the first name; you can undo it on the organisation's card. To merge two organisations not listed here, open one and use <i>Same organisation as…</i></p>
    ${groups.length ? groups.map((g, i) => `<div class="dup-group">${g.orgs.map((o, j) => `<label class="dup-row"><input type="radio" name="dup${i}" value="${esc(o.key)}" ${j === 0 ? "checked" : ""}> ${row(o)}</label>`).join("")}
      <div class="dup-actions"><button class="btn small" data-dmerge="${i}">Merge, keep the selected name</button> <button class="btn ghost small" data-ddismiss="${i}">Not the same</button></div></div>`).join("")
      : `<p>No likely duplicates found.</p>`}
    <div class="modal-actions">${groups.length > 1 ? `<button class="btn" id="dup-all">Merge all ${groups.length}, keeping the selected names</button>` : ""}<button class="btn ghost" data-close>Close</button></div>`);
  $("#dup-all") && ($("#dup-all").onclick = async () => {
    $("#dup-all").disabled = true;
    for (let i = 0; i < groups.length; i++) {
      const sel = $(`input[name="dup${i}"]:checked`); if (!sel) continue;      // dismissed groups are gone
      const target = groups[i].orgs.find((o) => o.key === sel.value);
      for (const o of groups[i].orgs) if (o !== target) await S.store.saveOrgMerge(normName(o.name), normName(target.name));
    }
    S.orgInfo = await S.store.loadOrgInfo(); toast(`Merged ${groups.length} groups`); closeModal(); refresh();
  });
  $$("[data-dmerge]").forEach((b) => (b.onclick = async () => {
    const g = groups[+b.dataset.dmerge];
    const key = $(`input[name="dup${b.dataset.dmerge}"]:checked`).value;
    const target = g.orgs.find((o) => o.key === key);
    b.disabled = true;
    await mergeOrgs(target, g.orgs.filter((o) => o !== target));
    toast(`Merged into ${target.label}`); closeModal(); refresh(); setTimeout(openDuplicates, 300);
  }));
  $$("[data-ddismiss]").forEach((b) => (b.onclick = () => {
    LS.set("rv-dup-dismissed", [...LS.get("rv-dup-dismissed", []), groups[+b.dataset.ddismiss].id]);
    b.closest(".dup-group").remove();
  }));
}

const callsOfPartner = (docId) => Object.entries(S.notes).filter(([, n]) => (n.partners || []).includes(docId)).map(([id]) => S.byId.get(id)).filter(Boolean);

function renderPartnersPage(v) {
  ensureNetwork();
  const NV = S.netView;
  NV.show ||= LS.get("rv-net-show", "close");
  const tabsHtml = `<div class="seg" role="tablist" aria-label="Partners page">${[["orgs", "Organisations"], ["projects", "Projects"]].map(([k, l]) => `<button role="tab" data-ptab="${k}" aria-pressed="${(NV.tab || "orgs") === k}">${l}</button>`).join("")}</div>`;
  if (!S.net) { v.innerHTML = `<div class="page net-page"><h1>Partners</h1>${tabsHtml}<p class="summary">${S.netLoading ? "Loading the partner network…" : "Loading…"}</p></div>`; bindPartnerTabs(v); return; }
  const M = networkModel();
  if ((NV.tab || "orgs") === "projects") return renderProjectsTab(v, M, tabsHtml);
  const projOpts = [...M.net.projects.map((p) => ["c:" + p.pid, `${p.acronym} (${(p.start || "").slice(0, 4)})`, M.nercPids.has(p.pid)]),
    ...S.netProjects.filter((p) => p.kind === "manual").map((p) => ["m:" + p.id, p.name, p.nerc !== false]),
    ...M.pf.projects.filter((p) => p.partners.length && !M.net.projects.some((c) => normName(c.acronym) === normName(p.acronym))).map((p) => ["h:" + p.id, `${p.acronym || p.title} (${p.start || "?"})`, M.pfNerc.has(p.id)])]
    .sort((a, b) => b[2] - a[2] || a[1].localeCompare(b[1]));
  const SHOW = [["close", "★ Close partners", (o) => o.close], ["nerc", REL.nerc, (o) => o.rel === "nerc"], ["tuas", REL.tuas, (o) => o.rel === "tuas"],
    ["potential", REL.potential, (o) => o.rel === "potential"], ["all", "All", () => true]];
  if (NV.show === "close" && !M.orgs.some((o) => o.close)) NV.show = "nerc";
  const inRel = M.orgs.filter(SHOW.find((x) => x[0] === NV.show)[2]);
  const q = NV.q.trim().toLowerCase();
  const described = inRel.filter((o) => o.info?.description).length;
  const shown = inRel.filter((o) => (!NV.type || o.type === NV.type) && (!NV.project || o.projectKeys.includes(NV.project)) && (!NV.desc || o.info?.description)
    && (!q || `${o.label} ${o.city} ${o.country} ${o.projectNames.join(" ")} ${o.doc?.contact || ""} ${o.doc?.notes || ""} ${o.info?.description || ""}`.toLowerCase().includes(q)));
  const countries = Object.entries(shown.reduce((m, o) => ((m[o.country || "?"] = (m[o.country || "?"] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const types = Object.entries(shown.reduce((m, o) => ((m[o.type] = (m[o.type] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const maxC = countries[0]?.[1] || 1;
  const updated = M.net.updatedAt ? new Date(M.net.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const sorter = NV.desc ? (a, b) => String(b.info?.editedAt || b.info?.at || "").localeCompare(String(a.info?.editedAt || a.info?.at || "")) || a.label.localeCompare(b.label) : { projects: (a, b) => b.close - a.close || b.nercCount - a.nercCount || b.count - a.count || a.label.localeCompare(b.label), name: (a, b) => a.label.localeCompare(b.label), country: (a, b) => a.country.localeCompare(b.country) || a.label.localeCompare(b.label) }[NV.sort];
  v.innerHTML = `<div class="page net-page">
    <div class="ib-head"><h1>Partners</h1><button class="btn" id="org-add">Add a potential partner</button></div>
    ${tabsHtml}
    <p>Everyone we have worked with or would like to work with. EU projects come from CORDIS (updated weekly${updated ? `, last on ${updated}` : ""}); mark NERC's own projects and add other projects on the Projects tab. Click an organisation to see its projects and the team's notes.</p>
    <div class="net-bar">
      <div class="seg net-show" role="radiogroup" aria-label="Show">${SHOW.map(([k, l, f]) => `<button role="radio" data-show="${k}" aria-checked="${NV.show === k}" aria-pressed="${NV.show === k}">${l} <span class="n">${M.orgs.filter(f).length}</span></button>`).join("")}</div>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="View">${[["map", "Map"], ["list", "List"]].map(([k, l]) => `<button data-mode="${k}" aria-pressed="${NV.mode === k}">${l}</button>`).join("")}</div>
      ${isMember() ? (() => { const n = duplicateGroups(M).length; return n ? `<button class="btn ghost" id="net-dups">Possible duplicates (${n})</button>` : ""; })() : ""}
      <button class="btn ghost" id="net-csv">Download CSV</button>
    </div>
    <div class="net-filters">
      <label class="sr" for="net-q">Search organisations</label>
      <input id="net-q" class="search" type="search" placeholder="Search by name, city, country, project or notes" value="${esc(NV.q)}">
      <label class="sr" for="net-proj">Highlight a project's consortium</label>
      <select id="net-proj" class="sel"><option value="">All projects</option>${projOpts.map(([k, l, ours]) => `<option value="${esc(k)}" ${NV.project === k ? "selected" : ""}>${ours ? "★ " : ""}${esc(l)}</option>`).join("")}</select>
    </div>
    <div class="net-stats">
      <div><b>${shown.length}</b><span>organisations</span></div>
      <div><b>${countries.length}</b><span>countries</span></div>
      <div class="net-types">${types.map(([t, n]) => `<button class="tag ${NV.type === t ? "on" : ""}" data-type="${t}">${n} ${ORG_TYPE_PL[t] || t}</button>`).join("")}${NV.type ? `<button class="linkbtn" data-type="${NV.type}">all types</button>` : ""}${described ? `<button class="tag ${NV.desc ? "on" : ""}" id="net-desc" aria-pressed="${!!NV.desc}" title="Organisations with a description, newest first">With description ${described}</button>` : ""}</div>
    </div>
    ${!M.nercPids.size && !S.netProjects.some((p) => p.kind === "manual") ? `<div class="pf-note warn">No projects are marked as NERC's yet, so “Worked with us” is empty. Mark them on the <button class="linkbtn" data-ptab="projects">Projects</button> tab.</div>` : ""}
    <div class="net-main">
      <div class="net-left">
        ${NV.mode === "map" ? `<div id="net-map" class="net-map" role="region" aria-label="Map of partner organisations"></div>
          <div class="net-legend"><span><i class="lg-close"></i>Close partner</span><span><i class="lg-nerc"></i>${REL.nerc}</span><span><i class="lg-tuas"></i>${REL.tuas}</span><span><i class="lg-pot"></i>${REL.potential}</span><span>Circle size = joint projects</span></div>`
          : `<div class="net-table"><table class="t"><thead><tr>
              <th><button class="linkbtn" data-sort="name">Organisation</button></th><th><button class="linkbtn" data-sort="country">Country</button></th><th>Type</th><th><button class="linkbtn" data-sort="projects">Projects together</button></th></tr></thead><tbody>
              ${[...shown].sort(sorter).map((o) => `<tr class="click" data-org="${esc(o.key)}" tabindex="0"><td><span class="reldot rel-${o.rel}" title="${REL[o.rel]}"></span>${isMember() ? `<button type="button" class="starbtn ${o.close ? "on" : ""}" data-star="${esc(o.key)}" aria-pressed="${!!o.close}" title="${o.close ? "Remove from close partners" : "Add to close partners"}" aria-label="${o.close ? "Remove " + esc(o.label) + " from close partners" : "Add " + esc(o.label) + " to close partners"}">${o.close ? "★" : "☆"}</button>` : o.close ? `<span class="closestar" title="Close partner">★</span>` : ""}<b>${esc(o.label)}</b>${NV.desc && o.info?.description ? `<div class="hint row-desc">${esc(o.info.description)}</div>` : o.doc?.contact ? `<div class="hint">${esc(o.doc.contact)}</div>` : o.city ? `<div class="hint">${esc(o.city)}</div>` : ""}</td>
                <td>${esc(o.country)}</td><td>${esc(ORG_TYPE[o.type] || o.type)}</td><td>${o.projectNames.map(esc).join(", ") || `<span class="hint">none yet</span>`}</td></tr>`).join("")}
            </tbody></table></div>`}
      </div>
      <aside class="net-countries"><h2>By country</h2>${countries.slice(0, 15).map(([c, n]) => `<button class="net-country" data-q="${esc(c)}"><span>${esc(c)}</span><i style="width:${Math.max(4, (n / maxC) * 100)}%"></i><b>${n}</b></button>`).join("")}</aside>
    </div>
  </div>`;
  bindPartnerTabs(v);
  const re = () => refresh();
  $$("[data-show]", v).forEach((b) => (b.onclick = () => { NV.show = b.dataset.show; LS.set("rv-net-show", NV.show); if (NV.show !== "all") NV.project = ""; re(); }));
  $$("[data-mode]", v).forEach((b) => (b.onclick = () => { NV.mode = b.dataset.mode; LS.set("rv-net-mode", NV.mode); re(); }));
  $("#net-desc") && ($("#net-desc").onclick = () => { NV.desc = !NV.desc; if (NV.desc) NV.mode = "list"; re(); });
  $$("[data-type]", v).forEach((b) => (b.onclick = () => { NV.type = NV.type === b.dataset.type ? "" : b.dataset.type; re(); }));
  $$("[data-sort]", v).forEach((b) => (b.onclick = () => { NV.sort = b.dataset.sort; re(); }));
  $$(".net-country", v).forEach((b) => (b.onclick = () => { NV.q = NV.q === b.dataset.q ? "" : b.dataset.q; re(); }));
  $("#net-proj").onchange = (e) => { NV.project = e.target.value; if (NV.project) NV.show = "all"; re(); };
  $("#net-q").oninput = (e) => { NV.q = e.target.value; clearTimeout(renderPartnersPage._t); renderPartnersPage._t = setTimeout(() => { const pos = e.target.selectionStart; re(); const i = $("#net-q"); i?.focus(); i?.setSelectionRange(pos, pos); }, 250); };
  $$("tr[data-org]", v).forEach((r) => { r.onclick = () => openOrg(r.dataset.org); r.onkeydown = (e) => e.target === r && e.key === "Enter" && openOrg(r.dataset.org); });
  $$("[data-star]", v).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation(); b.disabled = true;
    const o = M.orgs.find((x) => x.key === b.dataset.star);
    if (o) await toggleClose(o);
  }));
  $("#net-csv").onclick = () => downloadNetworkCsv(shown);
  $("#net-dups") && ($("#net-dups").onclick = openDuplicates);
  $("#org-add").onclick = () => openOrg(null);
  if (NV.mode === "map") drawNetworkMap($("#net-map"), shown, NV.project);
}

function bindPartnerTabs(v) {
  $$("[data-ptab]", v).forEach((b) => (b.onclick = () => { S.netView.tab = b.dataset.ptab; refresh(); }));
}

function renderProjectsTab(v, M, tabsHtml) {
  v.innerHTML = `<div class="page net-page">
    <div class="ib-head"><h1>Partners</h1><button class="btn ghost" id="pf-import">Import partner register…</button><input type="file" id="pf-file" accept=".xlsx,.xls" hidden><button class="btn" id="np-add">Add a project by hand</button></div>
    ${tabsHtml}
    <p>Tick the EU projects NERC took part in: their partners become “Worked with us”. Then open a project's partners and tick the ones you actually worked closely with (★ close partners). Add other projects (Erasmus+, Interreg, ERDF, Business Finland …) by hand with their partners. Turku UAS's EU projects come from CORDIS automatically.</p>
    <div class="net-table" style="max-height:none"><table class="t"><thead><tr><th>NERC</th><th>Project</th><th>Programme</th><th>Years</th><th>Partners</th></tr></thead><tbody>
      ${S.netProjects.filter((p) => p.kind === "manual").map((p) => `<tr><td><input type="checkbox" data-nercm="${esc(p.id)}" ${p.nerc !== false ? "checked" : ""} aria-label="NERC took part in ${esc(p.name)}"></td>
        <td><b>${esc(p.name)}</b> <span class="tag">added by hand</span></td><td>${esc(p.programme || "")}</td><td>${esc(p.start || "")}${p.end ? "–" + esc(p.end) : ""}</td>
        <td><button class="linkbtn" data-pexp="m:${esc(p.id)}" aria-expanded="${S.netView.exp === "m:" + p.id}">${(p.partners || []).length} partners${(p.partners || []).some((x) => x.close) ? ` · ★ ${(p.partners || []).filter((x) => x.close).length}` : ""}</button> · <button class="linkbtn" data-npedit="${esc(p.id)}">Edit</button></td></tr>
        ${S.netView.exp === "m:" + p.id ? closeListRow((p.partners || []).map((x, i) => ({ key: String(i), name: x.name, country: x.country, type: x.type, close: !!x.close })), "m:" + p.id) : ""}`).join("")}
      ${M.net.projects.map((p) => `<tr><td><input type="checkbox" data-nerc="${esc(p.pid)}" ${M.nercPids.has(p.pid) ? "checked" : ""} aria-label="NERC took part in ${esc(p.acronym)}"></td>
        <td><a href="https://cordis.europa.eu/project/id/${esc(p.pid)}" target="_blank" rel="noopener noreferrer"><b>${esc(p.acronym)}</b></a>${p.tuasCoordinator ? ` <span class="tag">coordinator</span>` : ""}<div class="hint">${esc(p.title)}</div></td>
        <td>${esc(p.programme)}<div class="hint">${esc(p.topic)}</div></td><td>${esc((p.start || "").slice(0, 4))}–${esc((p.end || "").slice(0, 4))}</td>
        <td>${(() => { const cl = (S.netProjects.find((x) => x.id === "cordis-" + p.pid)?.close || []).length; return `<button class="linkbtn" data-pexp="c:${esc(p.pid)}" aria-expanded="${S.netView.exp === "c:" + p.pid}">${p.partners} partners${cl ? ` · ★ ${cl}` : ""}</button>`; })()}</td></tr>
        ${S.netView.exp === "c:" + p.pid ? closeListRow(M.orgs.filter((o) => o.projects.includes(p.pid)).map((o) => ({ key: o.id, name: o.name, country: o.country, type: o.type, close: (S.netProjects.find((x) => x.id === "cordis-" + p.pid)?.close || []).some((i) => o.ids.includes(i)), coord: (o.coordinated || []).includes(p.pid) })), "c:" + p.pid) : ""}`).join("")}
    </tbody></table></div>
    ${portfolioSectionHtml(M)}
  </div>`;
  bindPartnerTabs(v);
  $("#pf-import").onclick = () => $("#pf-file").click();
  $("#pf-file").onchange = (e) => e.target.files[0] && importRegister(e.target.files[0]);
  $("#pf-q") && ($("#pf-q").oninput = (e) => { S.netView.pfq = e.target.value; clearTimeout(renderProjectsTab._t); renderProjectsTab._t = setTimeout(() => { const pos = e.target.selectionStart; refresh(); const i = $("#pf-q"); i?.focus(); i?.setSelectionRange(pos, pos); }, 250); });
  $("#pf-all") && ($("#pf-all").onchange = (e) => { S.netView.pfAll = e.target.checked; refresh(); });
  $$("[data-nercp]", v).forEach((c) => (c.onchange = () => S.store.saveNetProject({ id: "pf-" + c.dataset.nercp, kind: "portfolio", pid: c.dataset.nercp, nerc: c.checked })));
  $$("[data-nerc]", v).forEach((c) => (c.onchange = () => S.store.saveNetProject({ id: "cordis-" + c.dataset.nerc, kind: "cordis", pid: c.dataset.nerc, nerc: c.checked })));
  $$("[data-nercm]", v).forEach((c) => (c.onchange = () => S.store.saveNetProject({ id: c.dataset.nercm, nerc: c.checked })));
  $$("[data-npedit]", v).forEach((b) => (b.onclick = () => openNetProject(b.dataset.npedit)));
  $("#np-add").onclick = () => openNetProject(null);
  $$("[data-pexp]", v).forEach((b) => (b.onclick = () => { S.netView.exp = S.netView.exp === b.dataset.pexp ? "" : b.dataset.pexp; refresh(); }));
  $$("[data-close-org]", v).forEach((c) => (c.onchange = () => {
    const [kind, pid] = [c.dataset.proj.slice(0, 1), c.dataset.proj.slice(2)];
    if (kind === "c") {
      const doc = S.netProjects.find((x) => x.id === "cordis-" + pid) || {};
      const set = new Set(doc.close || []);
      c.checked ? set.add(c.dataset.closeOrg) : set.delete(c.dataset.closeOrg);
      S.store.saveNetProject({ id: "cordis-" + pid, kind: "cordis", pid, close: [...set] });
    } else if (kind === "h") {
      const doc = S.netProjects.find((x) => x.id === "pf-" + pid) || {};
      const set = new Set(doc.close || []);
      c.checked ? set.add(c.dataset.closeOrg) : set.delete(c.dataset.closeOrg);
      S.store.saveNetProject({ id: "pf-" + pid, kind: "portfolio", pid, close: [...set] });
    } else {
      const doc = S.netProjects.find((x) => x.id === pid);
      const partners = (doc.partners || []).map((x, i) => (String(i) === c.dataset.closeOrg ? { ...x, close: c.checked } : x));
      S.store.saveNetProject({ id: pid, partners });
    }
  }));
}

/** The imported partner register's projects: NERC's first, all with a search. */
function portfolioSectionHtml(M) {
  const NV = S.netView;
  if (!M.pf.meta) return `<section class="ib-block"><h2>Turku UAS project portfolio</h2>
    <p class="hint">Import the partner register made from the Hypergene portfolio (TUAS_kumppanirekisteri.xlsx) with <b>Import partner register…</b>. Its projects and partners are stored for the team only (not in the code repository), and NERC's projects are recognised by the coordinating research group.</p></section>`;
  const q = (NV.pfq || "").trim().toLowerCase();
  const list = M.pf.projects.filter((p) => (NV.pfAll || q || M.pfNerc.has(p.id)) && (!q || `${p.acronym} ${p.title} ${p.instrument} ${p.group}`.toLowerCase().includes(q)))
    .sort((a, b) => M.pfNerc.has(b.id) - M.pfNerc.has(a.id) || (b.start || 0) - (a.start || 0));
  const meta = M.pf.meta;
  return `<section class="ib-block">
    <h2>Turku UAS project portfolio <span>${M.pf.projects.length}</span></h2>
    <p class="hint">From the partner register (${esc(meta.file || "")}, imported ${esc(fmtDate(String(meta.importedAt || "").slice(0, 10)))}${meta.importedBy ? " by " + esc(personName(meta.importedBy)) : ""}). NERC's projects (coordinating group “${esc(meta.nercPattern || "New Energy")}”) are ticked; untick or tick others if needed. EU projects that are also in CORDIS are listed once on the map.</p>
    <div class="net-filters"><input id="pf-q" class="search" type="search" placeholder="Search the portfolio" value="${esc(NV.pfq || "")}">
      <label class="check"><input type="checkbox" id="pf-all" ${NV.pfAll ? "checked" : ""}>Show all Turku UAS projects</label></div>
    <div class="net-table" style="max-height:640px"><table class="t"><thead><tr><th>NERC</th><th>Project</th><th>Instrument</th><th>Years</th><th>Partners</th></tr></thead><tbody>
      ${list.slice(0, 300).map((p) => {
        const cl = (S.netProjects.find((x) => x.id === "pf-" + p.id)?.close || []).length;
        return `<tr><td><input type="checkbox" data-nercp="${esc(p.id)}" ${M.pfNerc.has(p.id) ? "checked" : ""} aria-label="NERC took part in ${esc(p.acronym)}"></td>
        <td><b>${esc(p.acronym || p.title)}</b>${p.role === "Coordinator" ? ` <span class="tag">coordinator</span>` : ""}<div class="hint">${esc(p.title !== p.acronym ? p.title : "")}${p.stage ? ` · ${esc(p.stage)}` : ""}</div></td>
        <td>${esc(p.instrument)}<div class="hint">${esc(p.group)}</div></td><td>${esc(p.start || "")}${p.end && p.end !== p.start ? "–" + esc(p.end) : ""}</td>
        <td>${p.partners.length ? `<button class="linkbtn" data-pexp="h:${esc(p.id)}" aria-expanded="${NV.exp === "h:" + p.id}">${p.partners.length} partners${cl ? ` · ★ ${cl}` : ""}</button>` : `<span class="hint">none</span>`}</td></tr>
        ${NV.exp === "h:" + p.id ? closeListRow(p.partners.map(([name, role]) => { const o = M.orgs.find((x) => x.aliases?.includes(name)); return { key: normName(name), name, country: o?.country || "", type: o?.type || "", close: (S.netProjects.find((x) => x.id === "pf-" + p.id)?.close || []).includes(normName(name)), coord: /coordinator/i.test(role) }; }), "h:" + p.id) : ""}`;
      }).join("")}
    </tbody></table></div>
    ${list.length > 300 ? `<p class="hint">Showing 300 of ${list.length}. Search to narrow down.</p>` : ""}
  </section>`;
}

let _xlsx = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  _xlsx ||= new Promise((resolve, reject) => {
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    js.onload = () => resolve(window.XLSX); js.onerror = () => reject(new Error("the Excel reader could not load"));
    document.head.appendChild(js);
  });
  return _xlsx;
}

async function importRegister(file) {
  let XLSX, wb;
  try {
    XLSX = await loadXlsx();
    wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  } catch (e) { return toast(`The file could not be read: ${e.message}`); }
  const run = (pattern) => parseRegister(XLSX, wb, pattern);
  let res;
  try { res = run(S.portfolio?.meta?.nercPattern || "New Energy"); } catch (e) { return toast(e.message); }
  modal(`<h2>Import partner register</h2>
    <p>${esc(file.name)}: <b>${res.summary.projects}</b> projects with partners, <b>${res.summary.orgs}</b> partner organisations, ${res.summary.links} project–partner links.</p>
    <div class="field"><label for="pf-pat">NERC's projects are those whose coordinating research group contains</label><input id="pf-pat" value="${esc(S.portfolio?.meta?.nercPattern || "New Energy")}">
      <p class="hint" id="pf-n">${res.summary.nerc} projects match.</p></div>
    <p class="hint">This replaces the previously imported register. Ticks and close partners you have marked are kept. The data is stored in the team's database, visible to team members only.</p>
    <div class="foot"><span style="flex:1"></span><button class="btn ghost" data-close>Cancel</button><button class="btn" id="pf-go">Import</button></div>`);
  $("#pf-pat").oninput = (e) => { try { res = run(e.target.value || "New Energy"); $("#pf-n").textContent = `${res.summary.nerc} projects match.`; } catch { /* invalid pattern while typing */ } };
  $("#pf-go").onclick = async () => {
    $("#pf-go").disabled = true;
    try {
      await S.store.savePortfolio({ projectChunks: chunk(res.projects), orgChunks: chunk(res.orgs), meta: { file: file.name, nercPattern: $("#pf-pat").value || "New Energy", ...res.summary } });
      S.portfolio = await S.store.loadPortfolio();
      closeModal(); refresh(); toast(`Imported ${res.summary.projects} projects and ${res.summary.orgs} partners`);
    } catch (e) { $("#pf-go").disabled = false; toast(`Import failed: ${e.message}`); }
  };
}

/** Checklist of a project's partners for marking the close ones. */
function closeListRow(list, projKey) {
  list = [...list].sort((a, b) => a.name.localeCompare(b.name));   // stable order: ticking must not move rows
  return `<tr class="close-row"><td></td><td colspan="4">
    <p class="hint">Tick the partners you worked closely with in this project (same work package, regular contact).</p>
    <div class="close-list">${list.map((o) => `<label class="check"><input type="checkbox" data-close-org="${esc(o.key)}" data-proj="${esc(projKey)}" ${o.close ? "checked" : ""}>
      <span>${esc(o.name)} <small>${esc([o.country, ORG_TYPE[o.type] || o.type].filter(Boolean).join(" · "))}${o.coord ? " · coordinator" : ""}</small></span></label>`).join("")}</div>
  </td></tr>`;
}

/** Adds an organisation to close partners (via the partner list) or removes it everywhere it is ticked. */
async function toggleClose(o) {
  const d = o.doc || {};
  if (!o.close) {
    if (d.id) await S.store.savePartner({ id: d.id, close: true });
    else await S.store.savePartner({ name: o.name, country: o.country, type: ORG_TYPE[o.type], contact: "", email: "", notes: "", close: true, ...(o.id ? { cordisId: o.id } : {}) });
    toast(`${o.label} added to close partners`);
    return;
  }
  if (d.id) await S.store.savePartner({ id: d.id, close: false });
  const keys = new Set((o.aliases || [o.name]).map(normName));
  for (const np of S.netProjects) {
    if (np.kind === "cordis" && (np.close || []).some((x) => o.ids.includes(x))) await S.store.saveNetProject({ id: np.id, close: np.close.filter((x) => !o.ids.includes(x)) });
    if (np.kind === "portfolio" && (np.close || []).some((x) => keys.has(x))) await S.store.saveNetProject({ id: np.id, close: np.close.filter((x) => !keys.has(x)) });
    if (np.kind === "manual" && (np.partners || []).some((x) => x.close && keys.has(normName(x.name))))
      await S.store.saveNetProject({ id: np.id, partners: np.partners.map((x) => (keys.has(normName(x.name)) ? { ...x, close: false } : x)) });
  }
  toast(`${o.label} removed from close partners`);
}

/** Organisation card: projects together (automatic) + the team's notes (partner list). key null = new potential partner. */
function openOrg(key) {
  const M = networkModel();
  const o = key ? M.orgs.find((x) => x.key === key) : null;
  const d = o?.doc || {};
  const calls = d.id ? callsOfPartner(d.id) : [];
  const editable = isMember();
  const projects = o ? [...o.projects.map((pid) => ({ pid, p: M.projById[pid], coord: (o.coordinated || []).includes(pid), ours: M.nercPids.has(pid) })), ...o.manual.map((m) => ({ manual: m })),
    ...o.pfOnly.sort((a, b) => (b.start || 0) - (a.start || 0)).map((x) => ({ pf: x }))] : [];
  const info = o?.info;
  modal(`<h2>${o ? esc(o.label) : "Add a potential partner"}</h2>
    ${o ? `<p class="hint org-sub"><span class="reldot rel-${o.rel}"></span>${o.close ? "★ Close partner · " : ""}${REL[o.rel]} · ${esc([o.city, o.country].filter(Boolean).join(", "))} · ${esc(ORG_TYPE[o.type] || o.type)}</p>` : ""}
    ${o && isMember() ? `<div class="org-close"><button type="button" class="btn ${o.close ? "ghost" : ""} small" id="og-close">${o.close ? "Remove from close partners" : "★ Add to close partners"}</button>
      <button type="button" class="btn ghost small" id="og-same">Same organisation as…</button></div>
      <div id="og-same-box" class="og-same" hidden><input id="og-same-q" type="search" placeholder="Type part of the other name" aria-label="Find the same organisation under another name" autocomplete="off"><div id="og-same-list" class="og-same-list"></div></div>` : ""}
    ${o?.merged?.length ? `<p class="hint">Also listed as: ${o.merged.map((m) => `${esc(m.name)}${isMember() ? ` <button class="linkbtn" data-unmerge="${esc(m.key)}">undo</button>` : ""}`).join(" · ")}</p>` : ""}
    ${info?.description ? `<div class="org-desc"><p>${esc(info.description)}</p>
      <p class="hint">${info.website ? `<a href="${esc(safeUrl(info.website))}" target="_blank" rel="noopener noreferrer">${esc(info.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a> · ` : ""}${info.editedBy ? "Edited by the team" : `Written by Claude from web sources${info.at ? " on " + esc(fmtDate(String(info.at).slice(0, 10))) : ""}; may contain errors`}${isMember() ? ` · <button class="linkbtn" id="og-desc-edit">Edit</button> · <button class="linkbtn" id="og-ai">Rewrite with Claude</button>` : ""}</p></div>`
      : o && isMember() ? `<p class="hint">${info?.notFound ? "Claude could not identify this organisation from the web." : "No description yet."} <button class="linkbtn" id="og-ai">Write with Claude</button> or <button class="linkbtn" id="og-desc-edit">write one yourself</button>.</p>` : ""}
    ${projects.length ? `<div class="field"><span class="lbl">Projects together <span class="hint">(${projects.length})</span></span><ul class="org-projects">${projects.map((x) => x.pf
      ? `<li><b>${esc(x.pf.acronym)}</b> <span class="hint">${esc(x.pf.instrument || "")} ${esc(x.pf.start || "")}${x.pf.end && x.pf.end !== x.pf.start ? "–" + esc(x.pf.end) : ""}${x.pf.nerc ? " · ours" : " · Turku UAS"}${x.pf.stage && !/ended|archived|implementation/i.test(x.pf.stage) ? " · " + esc(x.pf.stage.toLowerCase()) : ""}</span></li>`
      : x.manual
      ? `<li><b>${esc(x.manual.name)}</b> <span class="hint">${esc(x.manual.programme || "")}${x.manual.nerc ? " · ours" : ""}</span></li>`
      : `<li><a href="https://cordis.europa.eu/project/id/${esc(x.pid)}" target="_blank" rel="noopener noreferrer"><b>${esc(x.p?.acronym || x.pid)}</b></a> <span class="hint">${esc(x.p?.programme || "")} ${esc((x.p?.start || "").slice(0, 4))}${x.ours ? " · ours" : " · Turku UAS"}${x.coord ? " · coordinator" : ""}</span></li>`).join("")}</ul></div>` : ""}
    ${calls.length ? `<div class="field"><span class="lbl">Linked to calls</span>${calls.map((c) => `<div><a href="#" data-open="${esc(c.id)}">${esc(c.title)}</a></div>`).join("")}</div>` : ""}
    <form id="orgform">
      <h3 class="org-h">Team notes</h3>
      <div class="grid2">
        <div class="field"><label for="og-name">Name</label><input id="og-name" name="name" required value="${esc(d.name || o?.name || "")}" ${editable ? "" : "disabled"}></div>
        <div class="field"><label for="og-country">Country</label><input id="og-country" name="country" maxlength="40" value="${esc(d.country || o?.country || "")}" ${editable ? "" : "disabled"}></div>
        <div class="field"><label for="og-type">Type</label><select id="og-type" name="type" class="sel" ${editable ? "" : "disabled"}>${Object.entries(ORG_TYPE).map(([k, l]) => `<option value="${k}" ${typeCode(d.type || o?.type) === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="og-contact">Contact person</label><input id="og-contact" name="contact" maxlength="120" value="${esc(d.contact || "")}" ${editable ? "" : "disabled"}></div>
      </div>
      <div class="field"><label for="og-email">Email</label><input id="og-email" name="email" type="email" value="${esc(d.email || "")}" ${editable ? "" : "disabled"}></div>
      <div class="field"><label for="og-notes">Notes (expertise, how we know them, ideas for cooperation)</label><textarea id="og-notes" name="notes" rows="4" ${editable ? "" : "disabled"}>${esc(d.notes || "")}</textarea></div>
      <div class="foot">${d.id && editable ? `<button type="button" class="btn danger" id="og-del">${o?.count ? "Delete notes" : "Delete"}</button>` : ""}<span style="flex:1"></span>
        <button type="button" class="btn ghost" data-close>Close</button>${editable ? `<button class="btn" type="submit">Save</button>` : ""}</div>
    </form>`);
  $$("[data-open]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); closeModal(); S.view = "list"; renderShell(); openDrawer(a.dataset.open); }));
  if (!editable) return;
  $("#og-desc-edit") && ($("#og-desc-edit").onclick = async () => {
    const box = document.createElement("div");
    box.className = "field";
    box.innerHTML = `<label for="og-desc">Description</label><textarea id="og-desc" rows="4" maxlength="1200">${esc(info?.description || "")}</textarea>
      <div class="dev-row"><input id="og-web" placeholder="Website (https://…)" value="${esc(info?.website || "")}"><button type="button" class="btn small" id="og-desc-save">Save description</button></div>`;
    $("#og-desc-edit").closest("p, .org-desc").replaceWith(box);
    $("#og-desc-save").onclick = async () => {
      const web = $("#og-web").value.trim();
      await S.store.saveOrgInfo(normName(o.name), { description: $("#og-desc").value.trim(), website: /^https?:\/\//i.test(web) ? web : "" });
      S.orgInfo = await S.store.loadOrgInfo(); closeModal(); openOrg(o.key); toast("Description saved");
    };
  });
  $("#og-ai") && ($("#og-ai").onclick = () => {
    const box = document.createElement("div");
    box.className = "field og-ai";
    box.innerHTML = `<p class="hint">Claude searches the web and writes 2-3 sentences, about 10-15 seconds and a few cents. ${info?.description ? "Without new information the result is usually much the same, so give the website or a hint if you can." : "The website or a hint helps Claude find the right organisation."}</p>
      <label for="og-ai-web">Website <span class="hint">(optional; Claude reads it first)</span></label><input id="og-ai-web" type="url" placeholder="https://…" value="${esc(info?.website || "")}">
      <label for="og-ai-hint">Hint <span class="hint">(optional)</span></label><input id="og-ai-hint" maxlength="400" placeholder="e.g. the Dutch university of applied sciences, not the university">
      <div class="dev-row"><button type="button" class="btn small" id="og-ai-go">Write description</button><span id="og-ai-status" class="hint" role="status"></span></div>
      <div id="og-ai-out"></div>`;
    $("#og-ai").closest("p, .org-desc").replaceWith(box);
    let ctrl = null;
    $("#og-ai-go").onclick = async () => {
      const go = $("#og-ai-go");
      if (ctrl) { ctrl.abort(); return; }
      ctrl = new AbortController(); go.textContent = "Cancel"; $("#og-ai-status").textContent = "Writing… about 10-15 seconds"; $("#og-ai-out").innerHTML = "";
      const web = $("#og-ai-web").value.trim();
      try {
        const r = await S.store.describeOrg({ name: o.name, alt: [...new Set([...o.aliases, o.label])].filter((n) => n !== o.name).slice(0, 4),
          country: o.country, type: o.type, projects: o.projectNames.slice(0, 6), website: /^https?:\/\//i.test(web) ? web : "", hint: $("#og-ai-hint").value.trim() }, ctrl.signal);
        if (r.notFound) { $("#og-ai-status").textContent = r.person ? "This looks like a person's name, so no description was written." : "Claude could not identify the organisation. Add its website or a hint and try again."; return; }
        const { usage, ...doc } = r;
        $("#og-ai-status").textContent = "";
        $("#og-ai-out").innerHTML = `<div class="org-desc"><p>${esc(doc.description)}</p><p class="hint">${esc([doc.website, [doc.city, doc.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "))}</p>
          <div class="dev-row"><button type="button" class="btn small" id="og-ai-keep">Keep this</button><button type="button" class="btn ghost small" id="og-ai-drop">Discard</button></div></div>`;
        $("#og-ai-keep").onclick = async () => { await S.store.saveOrgAi(normName(o.name), doc); S.orgInfo = await S.store.loadOrgInfo(); closeModal(); refresh(); openOrg(o.key); toast("Description saved"); };
        $("#og-ai-drop").onclick = () => { closeModal(); openOrg(o.key); };
      } catch (e) {
        $("#og-ai-status").textContent = e.code === "cancelled" ? "Cancelled." : e.code === "not_configured" ? "The Claude service is not set up (see README step 6)." : e.message || "Something went wrong. Try again.";
      } finally { ctrl = null; go.textContent = "Write description"; }
    };
  });
  $("#og-close") && ($("#og-close").onclick = async () => { await toggleClose(o); closeModal(); setTimeout(() => openOrg(o.key), 400); });
  $("#og-same") && ($("#og-same").onclick = () => { $("#og-same-box").hidden = false; $("#og-same-q").focus(); });
  $("#og-same-q") && ($("#og-same-q").oninput = (e) => {
    const q = normName(e.target.value);
    const hits = q.length < 2 ? [] : M.orgs.filter((x) => x !== o && x.aliases.some((n) => normName(n).includes(q))).slice(0, 8);
    $("#og-same-list").innerHTML = hits.map((x) => `<button type="button" class="linkbtn" data-sameas="${esc(x.key)}">${esc(x.label)} <span class="hint">${esc([x.city, x.country].filter(Boolean).join(", "))} · ${x.count} project${x.count === 1 ? "" : "s"}</span></button>`).join("") || (q.length >= 2 ? `<span class="hint">No match</span>` : "");
    $$("[data-sameas]").forEach((b) => (b.onclick = async () => {
      const other = M.orgs.find((x) => x.key === b.dataset.sameas);
      const [target, src] = other.key.startsWith("c:") && !o.key.startsWith("c:") || other.count > o.count ? [other, o] : [o, other];
      await mergeOrgs(target, [src]); toast(`Merged: ${src.label} → ${target.label}`); closeModal(); refresh();
      setTimeout(() => openOrg(target.key), 300);
    }));
  });
  $$("[data-unmerge]").forEach((b) => (b.onclick = async () => {
    await S.store.saveOrgMerge(b.dataset.unmerge, ""); S.orgInfo = await S.store.loadOrgInfo();
    toast("Merge undone"); closeModal(); refresh(); setTimeout(() => openOrg(o.key), 300);
  }));
  $("#orgform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await S.store.savePartner({ ...(d.id ? { id: d.id } : {}), name: f.name.trim(), country: f.country.trim(), type: ORG_TYPE[f.type], contact: f.contact.trim(), email: f.email.trim(), notes: f.notes.trim(), ...(o?.id ? { cordisId: o.id } : {}) });
    closeModal(); toast("Saved");
  };
  $("#og-del") && ($("#og-del").onclick = async () => {
    if (!(await askConfirm(o?.count ? `Delete the team's notes on ${d.name}? Its projects stay.` : `Delete ${d.name} from the partners?`))) return;
    await S.store.deletePartner(d.id); closeModal(); toast("Deleted");
  });
}

let _leaflet = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  _leaflet ||= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => resolve(window.L); js.onerror = () => reject(new Error("map library could not load"));
    document.head.appendChild(js);
  });
  return _leaflet;
}

async function drawNetworkMap(el, orgs, project) {
  if (!el) return;
  let L;
  try { L = await loadLeaflet(); } catch { el.innerHTML = `<p class="summary" style="padding:16px">The map could not load here. Use the List view.</p>`; return; }
  if (!el.isConnected) return;
  const css = getComputedStyle(document.documentElement);
  const col = (k) => css.getPropertyValue(k).trim() || "#2F5DA8";
  const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true }).setView([52, 14], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12, attribution: "© OpenStreetMap contributors" }).addTo(map);
  L.circleMarker([60.45, 22.27], { radius: 8, color: col("--ink"), weight: 2, fillColor: col("--ink"), fillOpacity: 1 }).addTo(map).bindTooltip("Turku UAS");
  const style = {
    nerc: { color: col("--sun"), fillColor: col("--src-bf"), weight: 3, fillOpacity: 0.9 },
    tuas: { color: col("--src-eu"), fillColor: col("--src-eu"), weight: 1, fillOpacity: 0.35 },
    potential: { color: col("--src-cetp"), fillColor: "#ffffff", weight: 2, fillOpacity: 0.9, dashArray: "3 3" },
  };
  const pts = [];
  for (const o of orgs) {
    if (!o.xy) continue;
    const st = o.close ? { ...style.nerc, color: col("--ink"), fillColor: col("--sun"), fillOpacity: 1 } : o.rel === "nerc" ? { ...style.nerc, weight: 1.5, fillOpacity: 0.55 } : style[o.rel];
    const m = L.circleMarker(o.xy, { radius: (o.close ? 7 : 4) + Math.sqrt(o.count || 0.5) * 2.5, ...st }).addTo(map);
    if (o.close) m.bringToFront();
    m.bindTooltip(esc(o.label));
    m.on("click", () => openOrg(o.key));
    pts.push(o.xy);
    if (project) L.polyline([[60.45, 22.27], o.xy], { color: col("--ink-3"), weight: 1, opacity: 0.5 }).addTo(map);
  }
  if (pts.length > 1) map.fitBounds(pts, { padding: [24, 24], maxZoom: 6 });
  else if (pts.length === 1) map.setView(pts[0], 6);
}

function downloadNetworkCsv(orgs) {
  if (window.RV_CONFIG?.noDownloads) return toast(`CSV download (${orgs.length} organisations) works in the deployed service`);
  const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const rows = [["Organisation", "Country", "City", "Type", "Relation", "Projects together", "Number of projects", "Contact person", "Notes"].map(q).join(",")]
    .concat(orgs.map((o) => [o.label, o.country, o.city, ORG_TYPE[o.type] || o.type, REL[o.rel], o.projectNames.join("; "), o.count, o.doc?.contact || "", o.doc?.notes || ""].map(q).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.join("\r\n")], { type: "text/csv" }));
  a.download = "partner-network.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function openNetProject(id) {
  const p = id ? S.netProjects.find((x) => x.id === id) : { name: "", programme: "", start: "", end: "", nerc: true, partners: [] };
  const lines = (p.partners || []).map((x) => [x.name, x.country, x.city, x.type].filter((v, i) => v || i < 1).join("; ")).join("\n");
  modal(`<h2>${id ? "Edit project" : "Add a project"}</h2>
    <form id="npform">
      <div class="field"><label for="np-name">Project name or acronym</label><input id="np-name" name="name" required maxlength="140" value="${esc(p.name)}"></div>
      <div class="grid2">
        <div class="field"><label for="np-prog">Programme</label><input id="np-prog" name="programme" maxlength="80" value="${esc(p.programme || "")}" placeholder="e.g. Erasmus+, Interreg Central Baltic, ERDF"></div>
        <div class="field"><label for="np-years">Years</label><input id="np-years" name="years" maxlength="20" value="${esc([p.start, p.end].filter(Boolean).join("–"))}" placeholder="2024–2027"></div>
      </div>
      <label class="check"><input type="checkbox" name="nerc" ${p.nerc !== false ? "checked" : ""}>NERC took part</label>
      <div class="field"><label for="np-partners">Partners, one per line: name; country code; city; type</label>
        <textarea id="np-partners" name="partners" rows="7" placeholder="Example University; DE; Berlin; HES&#10;Solar Company Ltd; FI; Turku; PRC">${esc(lines)}</textarea>
        <p class="hint">Type: HES university, REC research organisation, PRC company, PUB public body, OTH other. Country and city are optional; partners that match an EU partner by name get its location.</p></div>
      <div class="foot">${id ? `<button type="button" class="btn danger" id="np-del">Delete</button>` : ""}<span style="flex:1"></span>
        <button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div>
    </form>`);
  $("#npform").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const [start, end] = String(d.years || "").split(/[–-]/).map((x) => x.trim());
    const partners = String(d.partners || "").split("\n").map((l) => l.split(";").map((x) => x.trim())).filter((x) => x[0])
      .slice(0, 80).map(([name, country = "", city = "", type = ""]) => ({ name, country: country.toUpperCase().slice(0, 2), city, type: ORG_TYPE[type.toUpperCase()] ? type.toUpperCase() : "OTH" }));
    await S.store.saveNetProject({ ...(id ? { id } : {}), kind: "manual", name: d.name.trim(), programme: d.programme.trim(), start: start || "", end: end || "", nerc: !!d.nerc, partners });
    closeModal(); toast("Project saved");
  };
  $("#np-del") && ($("#np-del").onclick = async () => {
    if (!(await askConfirm(`Delete “${p.name}” and its partner list?`))) return;
    await S.store.deleteNetProject(id); closeModal(); toast("Project deleted");
  });
}

/* ---- Consortium radar: who won similar calls ---- */

async function loadRadarFor(c) {
  if (!c || c.source !== "eu" || !/^eu:HORIZON/.test(c.id) || S.radar[c.id]) return;
  S.radar[c.id] = { loading: true };
  ensureNetwork();
  try { S.radar[c.id] = { items: await S.store.loadRadar(c.id) }; } catch { S.radar[c.id] = { items: [] }; }
  if (S.openId === c.id) renderDrawerBody();
}

function radarHtml(c) {
  if (c.source !== "eu" || !/^eu:HORIZON/.test(c.id)) return "";
  const R = S.radar[c.id];
  if (!R || R.loading) return `<section class="radar-sec"><h3>Who won similar calls</h3><p class="hint">Loading…</p></section>`;
  if (!R.items?.length) return `<section class="radar-sec"><h3>Who won similar calls</h3><p class="hint">No similar funded Horizon Europe projects found yet. The comparison is updated weekly from CORDIS.</p></section>`;
  const M = S.net ? networkModel() : null;
  const known = new Map();
  if (M) for (const o of M.orgs) { known.set(o.id, o); known.set(normName(o.name), o); }
  const partnerNames = new Set(S.partners.map((p) => normName(p.name)));
  const isKnown = (pt) => known.get(pt.id) || known.get(normName(pt.name));
  const all = R.items.flatMap((r) => r.partners);
  const typeCount = all.reduce((m, p) => ((m[p.type] = (m[p.type] || 0) + 1), m), {});
  const avg = Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${(n / R.items.length).toFixed(1).replace(/\.0$/, "")} ${ORG_TYPE_PL[t] || t}`).join(", ");
  const fi = [...new Set(all.filter((p) => p.country === "FI").map((p) => p.name))];
  const knownHits = [...new Map(all.filter((p) => isKnown(p) || partnerNames.has(normName(p.name))).map((p) => [normName(p.name), p])).values()];
  return `<section class="radar-sec">
    <h3>Who won similar calls</h3>
    <p class="hint">Funded Horizon Europe projects closest to this call (CORDIS). On average, the consortia listed here had ${esc(avg)}${fi.length ? `. Finnish partners: ${esc(fi.slice(0, 6).join(", "))}` : ""}.</p>
    ${knownHits.length ? `<p class="radar-known"><b>${knownHits.length} you already know:</b> ${knownHits.slice(0, 8).map((p) => esc(p.name)).join(", ")}</p>` : ""}
    ${R.items.map((r, i) => {
      const open = S.radarOpen === c.id + i;
      const ps = open ? r.partners : r.partners.slice(0, 10);
      return `<div class="radar-item">
        <div class="radar-h"><a href="https://cordis.europa.eu/project/id/${esc(r.pid)}" target="_blank" rel="noopener noreferrer"><b>${esc(r.acronym)}</b></a>
          <span class="hint">${esc(r.year)} · ${esc(r.topic)}${r.sameTopic ? " · same topic" : ""} · ${r.size} partners</span></div>
        <div class="hint radar-t">${esc(r.title)}</div>
        <div class="chips">${ps.map((p) => {
          const k = isKnown(p); const onList = partnerNames.has(normName(p.name));
          const why = k ? (k.nerc ? "Partner in our own projects" : "Partner in Turku UAS projects") + (k.projectNames?.length ? ": " + k.projectNames.join(", ") : "") : onList ? "On our partner list" : "";
          return `<span class="tag pchip ${k || onList ? "known" : ""} ${p.coordinator ? "coord" : ""}" title="${esc([ORG_TYPE[p.type] || p.type, p.country, p.coordinator ? "coordinator" : "", why].filter(Boolean).join(" · "))}">${p.coordinator ? "★ " : ""}${esc(p.name.length > 42 ? p.name.slice(0, 40) + "…" : p.name)} <small>${esc(p.country)}</small></span>`;
        }).join("")}${r.partners.length > 10 ? `<button class="linkbtn" data-rmore="${i}">${open ? "Show fewer" : `+${r.partners.length - 10} more`}</button>` : ""}</div>
      </div>`;
    }).join("")}
    <p class="hint">★ coordinator · highlighted = an organisation you have worked with or have on your partner list.</p>
  </section>`;
}

const IDEA_STATUS = [["raw", "Raw idea"], ["developing", "Developing"], ["ready", "Ready to apply"], ["parked", "Parked"]];
const PIECE_KINDS = [["site", "Pilot site"], ["need", "Need or challenge"], ["resource", "Resource"], ["expertise", "Expertise"], ["partner", "Partner"], ["other", "Other"]];
const KIND_LABEL = Object.fromEntries(PIECE_KINDS);
const SCOPES = [["", "Not decided"], ["national", "National"], ["international", "International"], ["both", "National or international"]];
const SCOPE_LABEL = Object.fromEntries(SCOPES);
const FUNDER_OPTS = () => Object.keys(SOURCES).filter((k) => k !== "manual");
/** "International · Horizon Europe, Erasmus+ · Kone Foundation" */
function fundingLine(i) {
  const names = [...(i.funders || []).map((k) => SOURCES[k]?.label).filter(Boolean), ...(i.otherFunder ? [i.otherFunder] : [])];
  return [i.scope ? SCOPE_LABEL[i.scope] : "", names.join(", ")].filter(Boolean).join(" · ");
}
const STATUS_LABEL = Object.fromEntries(IDEA_STATUS);

function renderIdeas(v) {
  const fid = document.activeElement?.id;
  const keep = ["idea-text", "idea-name"].includes(fid) ? [fid, $("#" + fid).selectionStart, $("#" + fid).selectionEnd] : null;
  const ideas = allIdeas().map((name) => ({ name, ...(S.ideaDocs[name] || {}) }));
  const callsOf = (name) => Object.entries(S.notes).filter(([, n]) => n.idea === name).map(([id]) => S.byId.get(id)).filter(Boolean);
  const ideasUsing = (pid) => ideas.filter((i) => (i.pieces || []).includes(pid)).map((i) => i.name);
  const pieces = [...S.pieces].filter((p) => !S.pieceKind || p.kind === S.pieceKind)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const order = Object.fromEntries(IDEA_STATUS.map(([k], i) => [k, i]));
  ideas.sort((a, b) => (order[a.status || "raw"] - order[b.status || "raw"]) || a.name.localeCompare(b.name, "en"));
  v.innerHTML = `<div class="page ideas-page">
    <h1>Ideas</h1>
    <p>Project ideas, and the pieces they could be built from: pilot sites, companies' needs, our equipment and data, expertise and partners. Collect pieces as soon as they come up, even if there is no project yet, and ask Claude which calls they could fit. Only the team sees this page.</p>
    ${ideaPanelHtml()}
    <section class="ib-block">
      <div class="ib-head"><h2>Project ideas <span>${ideas.length}</span></h2><button class="btn" id="new-idea">New idea</button></div>
      ${ideas.length ? `<div class="ib-grid">${ideas.map((i) => {
        const calls = callsOf(i.name);
        const ps = (i.pieces || []).map((id) => S.pieces.find((p) => p.id === id)).filter(Boolean);
        return `<article class="ib-card idea-card" data-idea="${esc(i.name)}">
          <div class="ib-top"><span class="ib-status st-${esc(i.status || "raw")}">${STATUS_LABEL[i.status || "raw"]}</span></div>
          <h3>${esc(i.name)}</h3>
          ${i.description ? `<p>${esc(i.description)}</p>` : `<p class="hint">No description yet.</p>`}
          ${fundingLine(i) ? `<p class="ib-fund"><b>Funding:</b> ${esc(fundingLine(i))}</p>` : ""}
          ${ps.length ? `<div class="chips">${ps.map((p) => `<span class="tag kind-${esc(p.kind)}" title="${esc(KIND_LABEL[p.kind] || "")}">${esc(p.title)}</span>`).join("")}</div>` : ""}
          ${calls.length ? `<div class="ib-calls"><span class="lbl">Linked calls</span>${calls.map((c) => `<button class="linkbtn" data-open="${esc(c.id)}">${esc(c.title)}</button>`).join("")}</div>` : `<p class="hint">No calls linked yet.</p>`}
          ${cardSearchHtml(i)}
          <div class="ib-actions"><button class="btn ghost small" data-find-idea="${esc(i.name)}" ${S.cardSearch[i.name]?.status === "loading" ? "disabled" : ""}>${i.search ? "Find calls again" : "Find calls"}</button><button class="btn ghost small" data-edit-idea="${esc(i.name)}">Edit</button></div>
        </article>`;
      }).join("")}</div>` : `<div class="empty"><b>No ideas yet</b>Add one with New idea, or give an idea a name in the idea search on the Calls page.</div>`}
    </section>
    <section class="ib-block">
      <div class="ib-head"><h2>Pieces <span>${S.pieces.length}</span></h2><button class="btn" id="new-piece">New piece</button></div>
      <div class="seg ib-kinds" role="group" aria-label="Show pieces of type"><button data-kind="" aria-pressed="${!S.pieceKind}">All</button>${PIECE_KINDS.map(([k, l]) => `<button data-kind="${k}" aria-pressed="${S.pieceKind === k}">${l} <span class="n">${S.pieces.filter((p) => p.kind === k).length}</span></button>`).join("")}</div>
      ${pieces.length ? `<div class="ib-grid">${pieces.map((p) => {
        const used = ideasUsing(p.id);
        return `<article class="ib-card piece-card kind-${esc(p.kind)}">
          <div class="ib-top"><span class="ib-kind">${esc(KIND_LABEL[p.kind] || "Piece")}</span><span class="hint">${esc(personName(p.broughtBy || "").split(" ")[0] || "")}</span></div>
          <h3>${esc(p.title)}</h3>
          ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          ${p.contact ? `<p class="hint">Contact: ${esc(p.contact)}</p>` : ""}
          ${(p.tags || []).length ? `<div class="chips">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          ${used.length ? `<p class="hint">Used in: ${used.map(esc).join(", ")}</p>` : ""}
          <div class="ib-actions"><button class="btn ghost small" data-find-piece="${esc(p.id)}">Find calls</button><button class="btn ghost small" data-edit-piece="${esc(p.id)}">Edit</button></div>
        </article>`;
      }).join("")}</div>` : `<div class="empty"><b>No pieces ${S.pieceKind ? "of this type " : ""}yet</b>A piece can be a possible pilot site, a company's problem, a device or dataset we have, or a partner's expertise.</div>`}
    </section>
  </div>`;
  $("#new-idea").onclick = () => openIdeaEditor(null);
  $("#new-piece").onclick = () => openPieceEditor(null);
  $$("[data-edit-idea]", v).forEach((b) => (b.onclick = () => openIdeaEditor(b.dataset.editIdea)));
  $$("[data-edit-piece]", v).forEach((b) => (b.onclick = () => openPieceEditor(b.dataset.editPiece)));
  $$("[data-open]", v).forEach((b) => (b.onclick = () => openDrawer(b.dataset.open)));
  $$("[data-kind]", v).forEach((b) => (b.onclick = () => { S.pieceKind = b.dataset.kind; refresh(); }));
  $$("[data-find-idea]", v).forEach((b) => (b.onclick = () => {
    if (!S.store.ideaSearchAvailable()) return toast("Idea search is not set up yet");
    searchForIdea(b.dataset.findIdea);
  }));
  $$("details.ib-sugg", v).forEach((d) => (d.ontoggle = () => { (S.cardSearch[d.dataset.idea] ||= {}).open = d.open; }));
  $$("[data-clink]", v).forEach((b) => (b.onclick = async () => { await S.store.saveNote(b.dataset.clink, { idea: b.dataset.cidea }); toast(`Linked to “${b.dataset.cidea}”`); }));
  bindIdeaPanel();
  $$("[data-find-piece]", v).forEach((b) => (b.onclick = () => {
    const p = S.pieces.find((x) => x.id === b.dataset.findPiece);
    findCallsFor(`${KIND_LABEL[p.kind]} that a project could be built around: ${p.title}. ${p.description || ""}`.trim(), "");
  }));
  if (keep && $("#" + keep[0])) { const el = $("#" + keep[0]); el.focus(); el.setSelectionRange(keep[1], keep[2]); }
}

/** Puts this text in the quick idea search at the top of the Ideas page and runs it. */
function findCallsFor(text, name) {
  Object.assign(S.idea, { text: text.slice(0, 2000), name, open: true });
  LS.set("rv-idea-text", S.idea.text); LS.set("rv-idea-name", name); LS.set("rv-idea-open", true);
  if (S.view !== "ideas") { S.view = "ideas"; LS.set("rv-view", "ideas"); renderShell(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (S.store.ideaSearchAvailable()) runIdeaSearch(); else refresh();
}

/** Saved idea search results on an idea card. */
function cardSearchHtml(i) {
  const st = S.cardSearch[i.name] || {};
  if (st.status === "loading") return `<div class="idea-status" role="status"><span class="pulse" aria-hidden="true"></span>Claude is looking for calls…</div>`;
  const err = st.status === "error" ? `<div class="idea-status err" role="alert">${esc(st.error)}</div>` : "";
  const r = i.search;
  if (!r) return err;
  const items = (r.matches || []).map((m) => ({ m, c: S.byId.get(m.id) })).filter((x) => x.c && !isClosed(x.c));
  const when = new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${err}<details class="ib-sugg" data-idea="${esc(i.name)}" ${st.open ? "open" : ""}>
    <summary>${items.length} suggested ${items.length === 1 ? "call" : "calls"} <span class="hint">· ${esc(when)}</span></summary>
    ${items.map(({ m, c }) => {
      const linked = noteOf(c.id).idea === i.name;
      const dl = nextDeadline(c);
      return `<div class="sugg"><b class="sfit">${m.fit}</b><div><button class="linkbtn" data-open="${esc(c.id)}">${esc(c.title)}</button>
        <div class="hint">${esc(srcOf(c).short)}${dl ? ` · ${fmtDate(dl)}` : c.continuous ? " · rolling" : ""}${m.angle ? ` · ${esc(m.angle)}` : ""}</div></div>
        ${linked ? `<span class="tag idea">Linked</span>` : `<button class="btn ghost small" data-clink="${esc(c.id)}" data-cidea="${esc(i.name)}">Link</button>`}</div>`;
    }).join("")}
    ${(r.strengthen || []).length ? `<div class="strengthen"><h3>How to strengthen it</h3><ul>${r.strengthen.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  </details>`;
}

function openIdeaEditor(name) {
  const i = name ? { name, ...(S.ideaDocs[name] || {}) } : { name: "", description: "", status: "raw", pieces: [] };
  const linked = name ? Object.values(S.notes).filter((n) => n.idea === name).length : 0;
  modal(`<h2>${name ? "Edit idea" : "New idea"}</h2>
    <form id="ideaform">
      <div class="field"><label for="ie-name">Name</label><input id="ie-name" name="name" required maxlength="120" value="${esc(i.name)}" ${name ? "disabled" : ""} placeholder="Short name, e.g. Housing company PV + storage">
        ${name ? `<p class="hint">The name links the idea to its calls, so it cannot be changed here.</p>` : ""}</div>
      <div class="field"><label for="ie-desc">Description</label><textarea id="ie-desc" name="description" rows="4" maxlength="2000" placeholder="What would the project do, with whom, and what would it produce?">${esc(i.description || "")}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="ie-status">Status</label><select id="ie-status" name="status" class="sel">${IDEA_STATUS.map(([k, l]) => `<option value="${k}" ${(i.status || "raw") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="ie-scope">National or international</label><select id="ie-scope" name="scope" class="sel">${SCOPES.map(([k, l]) => `<option value="${k}" ${(i.scope || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      <fieldset class="field ib-pick ib-funders"><legend class="lbl">Possible funders</legend>
        ${FUNDER_OPTS().map((k) => `<label class="check"><input type="checkbox" name="funders" value="${k}" ${(i.funders || []).includes(k) ? "checked" : ""}><i style="background:${SOURCES[k].color}"></i>${esc(SOURCES[k].label)}</label>`).join("")}
      </fieldset>
      <div class="field"><label for="ie-other">Other funder (optional)</label><input id="ie-other" name="otherFunder" maxlength="120" value="${esc(i.otherFunder || "")}" placeholder="e.g. a specific foundation or programme"></div>
      <fieldset class="field ib-pick"><legend class="lbl">Pieces it is built from</legend>
        ${S.pieces.length ? S.pieces.map((p) => `<label class="check"><input type="checkbox" name="pieces" value="${esc(p.id)}" ${(i.pieces || []).includes(p.id) ? "checked" : ""}><span class="ib-kind">${esc(KIND_LABEL[p.kind] || "")}</span>${esc(p.title)}</label>`).join("") : `<p class="hint">No pieces yet. Add them on the Ideas page.</p>`}
      </fieldset>
      <div class="foot">${name ? `<button type="button" class="btn danger" id="ie-del">Delete</button>` : ""}<span style="flex:1"></span>
        <button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div>
    </form>`);
  $("#ideaform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const n = (name || fd.get("name") || "").trim();
    if (!n) return;
    if (!name && S.ideaDocs[n]) { toast("An idea with this name already exists"); return; }
    await S.store.saveIdea(n, { description: String(fd.get("description") || "").trim(), status: fd.get("status"), pieces: fd.getAll("pieces"),
      scope: fd.get("scope") || "", funders: fd.getAll("funders"), otherFunder: String(fd.get("otherFunder") || "").trim() });
    closeModal(); toast("Idea saved");
  };
  $("#ie-del") && ($("#ie-del").onclick = async () => {
    if (!(await askConfirm(linked ? `Delete “${name}”? ${linked} linked ${linked === 1 ? "call keeps" : "calls keep"} the idea name in their notes.` : `Delete “${name}”?`))) return;
    await S.store.deleteIdea(name); closeModal(); toast("Idea deleted");
  });
}

function openPieceEditor(id) {
  const p = id ? S.pieces.find((x) => x.id === id) : { kind: S.pieceKind || "site", title: "", description: "", contact: "", tags: [] };
  modal(`<h2>${id ? "Edit piece" : "New piece"}</h2>
    <form id="pieceform">
      <div class="grid2">
        <div class="field"><label for="pc-kind">Type</label><select id="pc-kind" name="kind" class="sel">${PIECE_KINDS.map(([k, l]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="pc-title">Title</label><input id="pc-title" name="title" required maxlength="140" value="${esc(p.title)}" placeholder="e.g. Solar park in Kemiönsaari"></div>
      </div>
      <div class="field"><label for="pc-desc">Description</label><textarea id="pc-desc" name="description" rows="4" maxlength="1500" placeholder="What is it, what could a project do with it, any timing or conditions">${esc(p.description || "")}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="pc-contact">Contact (optional)</label><input id="pc-contact" name="contact" maxlength="140" value="${esc(p.contact || "")}" placeholder="Who knows more"></div>
        <div class="field"><label for="pc-tags">Tags (comma separated)</label><input id="pc-tags" name="tags" maxlength="200" value="${esc((p.tags || []).join(", "))}" placeholder="PV, battery"></div>
      </div>
      <p class="hint">Contacts are personal data: write only what the team needs, and leave out private details.</p>
      <div class="foot">${id ? `<button type="button" class="btn danger" id="pc-del">Delete</button>` : ""}<span style="flex:1"></span>
        <button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div>
    </form>`);
  $("#pieceform").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await S.store.savePiece({ ...(id ? { id } : {}), kind: d.kind, title: d.title.trim(), description: d.description.trim(), contact: d.contact.trim(),
      tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8) });
    closeModal(); toast("Piece saved");
  };
  $("#pc-del") && ($("#pc-del").onclick = async () => {
    if (!(await askConfirm(`Delete “${p.title}”?`))) return;
    await S.store.deletePiece(id);
    for (const i of Object.values(S.ideaDocs)) if ((i.pieces || []).includes(id)) await S.store.saveIdea(i.name, { pieces: i.pieces.filter((x) => x !== id) });
    closeModal(); toast("Piece deleted");
  });
}

/* ================= Pipeline ================= */

function renderBoard(v) {
  const cols = STAGES.filter(([k]) => k);
  const byStage = Object.fromEntries(cols.map(([k]) => [k, []]));
  for (const [id, n] of Object.entries(S.notes)) if (n.stage && byStage[n.stage] && S.byId.has(id)) byStage[n.stage].push(S.byId.get(id));
  const total = Object.values(byStage).reduce((a, b) => a + b.length, 0);
  v.innerHTML = `<div class="page" style="max-width:none">
    <h1>Pipeline</h1>
    <p>Calls the team has given a stage. Change the stage in the call details.</p>
    ${total ? `<div class="board">${cols.map(([k, l]) => `<div class="col"><h3>${l}<span>${byStage[k].length}</span></h3>
      ${byStage[k].sort((a, b) => (nextDeadline(a) || "9").localeCompare(nextDeadline(b) || "9")).map((c) => {
        const n = noteOf(c.id);
        return `<div class="item" data-id="${esc(c.id)}" tabindex="0" style="border-left-color:${srcOf(c).color}">
          ${n.idea ? `<div class="idea-line">${esc(n.idea)}</div>` : ""}${esc(c.title)}
          <div class="d">${nextDeadline(c) ? `${fmtDate(nextDeadline(c))} · ${daysText(daysLeft(nextDeadline(c)))}` : c.continuous ? "Rolling" : "No deadline"}${(n.people || []).length ? " · " + n.people.map((p) => esc(personName(p).split(" ")[0])).join(", ") : ""}</div>
        </div>`;
      }).join("")}</div>`).join("")}</div>`
      : `<div class="empty"><b>The pipeline is empty</b>Open a call from the list and give it a stage, for example Watching or Preparing.</div>`}
  </div>`;
  $$(".item", v).forEach((i) => { i.onclick = () => openDrawer(i.dataset.id); i.onkeydown = (e) => e.key === "Enter" && openDrawer(i.dataset.id); });
}

/* ================= Relevance profile ================= */

const fmtWeight = (w) => String(Math.round(Number(w) * 10) / 10);

function renderProfile(v) {
  if (S.profileDraft) return renderProfileEditor(v);
  const p = S.profile;
  const when = p?.updatedAt ? new Date(p.updatedAt) : null;
  const chips = (list, cls = "") => (list || []).length
    ? `<div class="kw-chips">${[...list].sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word)).map((k) => `<span class="kw ${cls}">${esc(k.word)}<b>${cls ? "−" : ""}${fmtWeight(Math.abs(k.weight))}</b></span>`).join("")}</div>`
    : `<p class="summary">None.</p>`;
  v.innerHTML = `<div class="page profile">
    <h1>Relevance profile</h1>
    <p>This describes the team to Claude. Claude uses it every night to score how well each call fits and to write the reasons, and the idea search uses it too. The keywords give a quick score for calls that Claude has not assessed yet.</p>
    ${p === undefined ? `<p class="summary">Loading…</p>` : p === null ? `<div class="empty"><b>No profile saved yet</b>${isAdmin() ? "Open the editor to start from the suggested NERC profile, adjust it if needed and save it." : "The collector creates it on its first run, or an admin can save it before that."}</div>` : `
    <section class="pf-block">
      <h2>Team description</h2>
      <p class="pf-org">${esc(p.organisation)}</p>
    </section>
    <section class="pf-block">
      <h2>Home region</h2>
      <p class="pf-org">${esc(p.homeRegion || DEFAULT_PROFILE.homeRegion)}</p>
      <p class="hint">Regional ERDF, ESF+ and JTF calls and rural development (CAP, Leader) funding from other regions are hidden by default. National calls are always shown.</p>
    </section>
    <section class="pf-block">
      <h2>Keywords <span>${(p.keywords || []).length}</span></h2>
      <p class="hint">A call earns the weight when the word appears in its text, and twice the weight when it is in the title.</p>
      ${chips(p.keywords)}
    </section>
    <section class="pf-block">
      <h2>Negative keywords <span>${(p.negative || []).length}</span></h2>
      <p class="hint">These lower the score.</p>
      ${chips(p.negative, "neg")}
    </section>
    ${calibrationHtml()}
    <p class="foot-meta">Last edited${p.updatedBy ? ` by ${esc(p.updatedBy === "config.yaml" ? "the starting settings" : p.updatedBy)}` : ""}${when ? ` on ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.${isAdmin() ? "" : " Only admins can change the profile."}</p>`}
    ${isAdmin() ? `<button class="btn" id="pf-edit">${p ? "Edit profile" : "Start from suggested profile"}</button>` : ""}
  </div>`;
  $$("[data-open]", v).forEach((b) => (b.onclick = () => openDrawer(b.dataset.open)));
  $("#pf-edit") && ($("#pf-edit").onclick = () => {
    const base = S.profile || DEFAULT_PROFILE;
    S.profileDraft = { homeRegion: base.homeRegion || DEFAULT_PROFILE.homeRegion, organisation: base.organisation || "", keywords: (base.keywords || []).map((k) => ({ word: k.word, weight: Math.abs(Number(k.weight) || 1) })), negative: (base.negative || []).map((k) => ({ word: k.word, weight: Math.abs(Number(k.weight) || 1) })) };
    refresh();
  });
}

/** How well Claude's scores agree with the team's 👍 / 👎 answers. */
function calibrationHtml() {
  const rated = Object.keys(S.ratings).map((id) => ({ c: S.byId.get(id), r: ratingOf(id) }))
    .filter((x) => x.c && x.c.aiScore != null && x.r.score !== 0);
  const head = `<section class="pf-block"><h2>Does Claude's relevance score match the team? <span>${rated.length} rated</span></h2>`;
  if (rated.length < 5) {
    return `${head}<p class="hint">Answer “Is this relevant for us?” in the call details for at least 5 calls${rated.length ? ` (${5 - rated.length} more to go)` : ""}. This section then shows how often Claude's score agrees with the team, and the calls where they disagree most. The answers are also given to Claude as examples on the next nightly run.</p></section>`;
  }
  const up = rated.filter((x) => x.r.score > 0), down = rated.filter((x) => x.r.score < 0);
  const upOk = up.filter((x) => x.c.aiScore >= 50).length, downOk = down.filter((x) => x.c.aiScore < 50).length;
  const agree = Math.round(((upOk + downOk) / rated.length) * 100);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const misses = rated.map((x) => ({ ...x, gap: x.r.score > 0 ? 50 - x.c.aiScore : x.c.aiScore - 50 }))
    .filter((x) => x.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 8);
  return `${head}
    <div class="calib">
      <div><b>${agree}%</b><span>agree overall</span></div>
      <div><b>${pct(upOk, up.length)}</b><span>of ${up.length} 👍 calls scored 50 or more</span></div>
      <div><b>${pct(downOk, down.length)}</b><span>of ${down.length} 👎 calls scored under 50</span></div>
    </div>
    ${misses.length ? `<h3 class="calib-h">Biggest disagreements</h3><ul class="calib-list">${misses.map((x) => `<li><button class="linkbtn" data-open="${esc(x.c.id)}">${esc(x.c.title)}</button>
      <span>Team ${x.r.score > 0 ? "👍" : "👎"} · Claude ${x.c.aiScore}</span>${x.r.list.find((r) => r.reason) ? `<small>${esc(x.r.list.find((r) => r.reason).reason)}</small>` : ""}</li>`).join("")}</ul>
      <p class="hint">If the same kind of call keeps coming up here, say it in the team description above (for example the TRL range you work at, or that you are not eligible for company-only calls).</p>` : `<p class="hint">No disagreements so far.</p>`}
  </section>`;
}

function renderProfileEditor(v) {
  const d = S.profileDraft;
  const rows = (kind) => d[kind].map((k, i) => `<div class="kw-row">
      <label class="sr" for="${kind}-w-${i}">Word</label><input id="${kind}-w-${i}" data-kind="${kind}" data-i="${i}" data-f="word" value="${esc(k.word)}" placeholder="word or start of a word">
      <label class="sr" for="${kind}-n-${i}">Weight</label><input id="${kind}-n-${i}" data-kind="${kind}" data-i="${i}" data-f="weight" type="number" min="0.5" max="10" step="0.5" value="${esc(fmtWeight(k.weight))}">
      <button type="button" class="linkbtn" data-rmrow="${kind}:${i}" aria-label="Remove ${esc(k.word || "row")}">Remove</button>
    </div>`).join("");
  const orgChanged = !!S.profile && (d.organisation || "").trim() !== (S.profile.organisation || "").trim();
  v.innerHTML = `<div class="page profile">
    <h1>Edit relevance profile</h1>
    <form id="pf-form">
      <div class="field"><label for="pf-org">Team description for Claude</label>
        <textarea id="pf-org" rows="7" maxlength="3000">${esc(d.organisation)}</textarea>
        <p class="hint">Write it the way you would brief a colleague: who you are, your research themes, how you usually take part in projects (partner, coordinator) and where you are based. Plain sentences work best.</p></div>
      <div class="field"><label for="pf-home">Home region</label>
        <select id="pf-home" class="sel">${REGIONS.map((r) => `<option ${r === (d.homeRegion || DEFAULT_PROFILE.homeRegion) ? "selected" : ""}>${r}</option>`).join("")}</select>
        <p class="hint">Regional ERDF, ESF+ and JTF calls from other regions are hidden by default. National calls are always shown.</p></div>
      <div class="pf-cols">
        <div class="field"><span class="lbl">Keywords and weights</span>${rows("keywords")}<button type="button" class="btn ghost small" data-addrow="keywords">Add keyword</button></div>
        <div class="field"><span class="lbl">Negative keywords and weights</span><p class="hint">Write the weight without a minus sign; these always lower the score.</p>${rows("negative")}<button type="button" class="btn ghost small" data-addrow="negative">Add negative keyword</button></div>
      </div>
      <p class="hint">Keywords match parts of words in Finnish and English, so <i>photovolta</i> also matches photovoltaic and photovoltaics. Weights from 1 (weak) to 4 (strong) work well.</p>
      <div class="pf-note ${orgChanged ? "warn" : ""}" id="pf-note">${orgChanged
        ? "You changed the team description. On the next nightly run Claude will assess every call again with the new description. That costs about $0.25 of API usage."
        : "Keyword changes take effect on the next nightly run and cost nothing."}</div>
      <div class="foot"><button type="button" class="btn ghost" id="pf-cancel">Cancel</button><button class="btn" type="submit">Save profile</button></div>
    </form>
  </div>`;
  $("#pf-org").oninput = (e) => {
    d.organisation = e.target.value;
    const changed = !!S.profile && d.organisation.trim() !== (S.profile.organisation || "").trim();
    const note = $("#pf-note");
    note.classList.toggle("warn", changed);
    note.textContent = changed
      ? "You changed the team description. On the next nightly run Claude will assess every call again with the new description. That costs about $0.25 of API usage."
      : "Keyword changes take effect on the next nightly run and cost nothing.";
  };
  $$("[data-kind]", v).forEach((inp) => (inp.oninput = () => {
    const row = d[inp.dataset.kind][Number(inp.dataset.i)];
    row[inp.dataset.f] = inp.dataset.f === "weight" ? Number(inp.value) : inp.value;
  }));
  $$("[data-addrow]", v).forEach((b) => (b.onclick = () => {
    d[b.dataset.addrow].push({ word: "", weight: 2 });
    refresh();
    const n = d[b.dataset.addrow].length - 1;
    $(`#${b.dataset.addrow}-w-${n}`)?.focus();
  }));
  $$("[data-rmrow]", v).forEach((b) => (b.onclick = () => {
    const [kind, i] = b.dataset.rmrow.split(":");
    d[kind].splice(Number(i), 1);
    refresh();
  }));
  $("#pf-home").onchange = (e) => { d.homeRegion = e.target.value; };
  $("#pf-cancel").onclick = () => { S.profileDraft = null; refresh(); };
  $("#pf-form").onsubmit = async (e) => {
    e.preventDefault();
    const org = d.organisation.trim();
    if (org.length < 40) { toast("Describe the team in at least a couple of sentences."); $("#pf-org").focus(); return; }
    const clean = (list) => {
      const seen = new Set();
      return list.map((k) => ({ word: String(k.word || "").trim().toLowerCase(), weight: Math.min(10, Math.max(0.5, Math.abs(Number(k.weight) || 1))) }))
        .filter((k) => k.word && !seen.has(k.word) && seen.add(k.word));
    };
    const btn = $("#pf-form button[type=submit]"); btn.disabled = true;
    try {
      await S.store.saveProfile({ organisation: org, homeRegion: d.homeRegion || DEFAULT_PROFILE.homeRegion, keywords: clean(d.keywords), negative: clean(d.negative) });
      S.profileDraft = null; refresh(); toast("Profile saved");
    } catch (err) {
      btn.disabled = false;
      toast(`The profile could not be saved: ${err.message || err}`);
    }
  };
}

/* ================= Users (admin) ================= */

function renderUsers(v) {
  v.innerHTML = `<div class="page">
    <h1>Users</h1>
    <p>Only the addresses on this list can use the service. People sign in with a link sent to their email, so external partners need no accounts or passwords. The Partner role can see calls and comment, but cannot change team notes.</p>
    <form class="inline-form" id="uform">
      <label><span class="sr">Email</span><input name="email" type="email" required placeholder="Email address"></label>
      <label><span class="sr">Name</span><input name="name" required placeholder="Name (used in @mentions)"></label>
      <label><span class="sr">Organisation</span><input name="org" placeholder="Organisation"></label>
      <label><span class="sr">Role</span><select name="role">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${k === "member" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <button class="btn" type="submit">Add user</button>
    </form>
    <div style="overflow-x:auto"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th></th></tr></thead><tbody>
      ${[...S.allow].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "en")).map((a) => `<tr>
        <td><b>${esc(a.name)}</b></td><td>${esc(a.email)}</td><td>${esc(a.org)}</td>
        <td><label class="sr" for="r-${esc(a.email)}">Role</label><select class="sel" id="r-${esc(a.email)}" data-role="${esc(a.email)}" ${a.email === S.store.user.email ? "disabled" : ""}>${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${a.role === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td>${a.email === S.store.user.email ? "You" : `<button class="linkbtn" data-udel="${esc(a.email)}">Remove</button>`}</td></tr>`).join("")}
    </tbody></table></div>
  </div>`;
  $("#uform").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await S.store.saveAllow(d.email.trim(), { name: d.name.trim(), org: d.org.trim(), role: d.role });
    toast(`${d.name} added. They can now sign in with ${d.email}.`);
  };
  $$("[data-role]", v).forEach((s) => (s.onchange = () => S.store.saveAllow(s.dataset.role, { role: s.value }).then(() => toast("Role updated"))));
  $$("[data-udel]", v).forEach((b) => (b.onclick = async () => {
    if (!(await askConfirm(`Remove ${b.dataset.udel}? They will no longer be able to sign in.`, "Remove"))) return;
    await S.store.deleteAllow(b.dataset.udel); toast("User removed");
  }));
}

/* ================= Add a call manually ================= */

function openAddCall() {
  modal(`<h2>Add a call</h2>
    <p class="summary" style="margin:-6px 0 14px">For funders the collector does not follow, such as foundations, ministries and regional calls.</p>
    <form id="acform">
      <div class="field"><label for="ac-title">Call name</label><input id="ac-title" name="title" required></div>
      <div class="field"><label for="ac-url">Link to the call</label><input id="ac-url" name="url" type="url" required placeholder="https://"></div>
      <div class="grid2">
        <div class="field"><label for="ac-funder">Funder</label><input id="ac-funder" name="funder" required placeholder="e.g. Kone Foundation"></div>
        <div class="field"><label for="ac-prog">Programme (optional)</label><input id="ac-prog" name="programme"></div>
        <div class="field"><label for="ac-opens">Opens</label><input id="ac-opens" name="opens" type="date"></div>
        <div class="field"><label for="ac-dl">Deadline</label><input id="ac-dl" name="deadline" type="date"></div>
      </div>
      <div class="field"><label for="ac-sum">Short description</label><textarea id="ac-sum" name="summary" rows="3"></textarea></div>
      <div class="foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Add call</button></div>
    </form>`);
  $("#acform").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const status = d.opens && d.opens > TODAY_ISO ? "forthcoming" : "open";
    await S.store.addManualCall({
      title: d.title.trim(), url: d.url.trim(), funder: d.funder.trim(), programme: d.programme.trim(),
      opens: d.opens || null, deadlines: d.deadline ? [d.deadline] : [], deadline: d.deadline || null,
      summary: d.summary.trim(), status, firstSeen: TODAY_ISO, relevance: 50,
    });
    closeModal(); await reloadCalls(); toast("Call added");
  };
}
async function reloadCalls() {
  const { items, meta } = await S.store.loadCalls();
  S.calls = items; S.meta = meta || S.meta; S.byId = new Map(items.map((c) => [c.id, c])); refresh();
}

/* ================= Modal + confirmation ================= */

function modal(html) {
  S.modalFocus = document.activeElement;
  $("#modal-root").innerHTML = `<div class="scrim" style="z-index:50" data-close></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  $$("[data-close]", $("#modal-root")).forEach((b) => (b.onclick = closeModal));
  $(".modal input, .modal button", $("#modal-root"))?.focus();
  $("#modal-root").onkeydown = (e) => { if (e.key === "Escape") closeModal(); };
}
function closeModal() { $("#modal-root").innerHTML = ""; S.modalFocus?.focus?.(); }

function askConfirm(message, okLabel = "Delete") {
  return new Promise((resolve) => {
    const root = document.getElementById("confirm-root");
    const prev = document.activeElement;
    root.innerHTML = `<div class="scrim" style="z-index:80"></div><div class="modal" role="alertdialog" aria-modal="true" style="z-index:81;width:min(420px,calc(100% - 32px))">
      <p style="margin:0 0 16px">${esc(message)}</p>
      <div class="foot"><button class="btn ghost" id="cf-no">Cancel</button><button class="btn" id="cf-yes">${esc(okLabel)}</button></div></div>`;
    const done = (v) => { root.innerHTML = ""; prev?.focus?.(); resolve(v); };
    root.querySelector("#cf-yes").onclick = () => done(true);
    root.querySelector("#cf-no").onclick = () => done(false);
    root.querySelector(".scrim").onclick = () => done(false);
    root.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    root.querySelector("#cf-yes").focus();
  });
}

/* ================= Calendar (ICS) ================= */

function downloadIcs(list) {
  if (!Array.isArray(list)) list = S.calls.filter((c) => fav(c.id));
  const evs = list.filter((c) => nextDeadline(c));
  if (!evs.length) return toast("Your favourites have no deadlines");
  if (window.RV_CONFIG?.noDownloads) return toast(`Calendar download (${evs.length} ${evs.length === 1 ? "deadline" : "deadlines"}) works in the deployed service`);
  const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const fold = (line) => line.match(/.{1,72}/g).join("\r\n ");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rahoitusvahti//EN", "CALSCALE:GREGORIAN"];
  for (const c of evs) {
    const d = nextDeadline(c).replace(/-/g, "");
    const end = isoDate(new Date(parseIso(nextDeadline(c)).getTime() + DAY)).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${c.id.replace(/[^\w.-]/g, "_")}@rahoitusvahti`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`,
      fold(`SUMMARY:${icsEsc("Deadline: " + c.title)}`), fold(`DESCRIPTION:${icsEsc(`${c.funder} ${c.programme || ""}\n${c.url}`)}`),
      fold(`URL:${c.url}`), "BEGIN:VALARM", "TRIGGER:-P7D", "ACTION:DISPLAY", "DESCRIPTION:Deadline in one week", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = evs.length === 1 ? "deadline.ics" : "funding-call-favourites.ics";
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${evs.length} ${evs.length === 1 ? "deadline" : "deadlines"} downloaded as a calendar file`);
}

boot();
