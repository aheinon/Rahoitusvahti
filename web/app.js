import { createDemoStore, createFirebaseStore } from "./data.js";
import { callLine } from "./idea-prompt.js";

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
  { key: "intl", label: "EU and international", keys: [...EU_GROUPS, "interreg"] },
  { key: "fi", label: "Finland", keys: ["bf", "aka", "eura"] },
  { key: "own", label: "Added by the team", keys: ["manual"] },
];
const SOURCE_SHORT = { eu: "EU", bf: "BF", aka: "RCF", eura: "EURA", interreg: "Interreg" }; // collector run counts
function groupOf(c) {
  if (c.source !== "eu") return SOURCES[c.source] ? c.source : "manual";
  const p = (c.programme || "") + " " + (c.call_id || c.id || "");
  if (/horizon|euratom/i.test(p)) return "horizon";
  if (/erasmus/i.test(p)) return "erasmus";
  if (/\bLIFE\b/.test(p)) return "life";
  if (/digital/i.test(p)) return "digital";
  return "euother";
}
const srcOf = (c) => SOURCES[groupOf(c)];
const DEFAULT_FILTERS = { q: "", sources: Object.keys(SOURCES), status: ["open", "forthcoming"], window: "all", minRel: 0, favOnly: false, mineOnly: false, tag: "", idea: "" };

/* ================= State ================= */

// Saved filters from before EU was split by programme had a single "eu" entry.
function migrateFilters(f) {
  if (f.sources.includes("eu")) f.sources = [...f.sources.filter((s) => s !== "eu"), ...EU_GROUPS];
  f.sources = [...new Set(f.sources.filter((s) => SOURCES[s]))];
  return f;
}

const S = {
  store: null,
  calls: [], byId: new Map(), meta: {},
  notes: {}, partners: [], allow: [], me: { favorites: [] }, profile: undefined, profileDraft: null,
  view: LS.get("rv-view", "list"),
  filters: migrateFilters(Object.assign({}, DEFAULT_FILTERS, LS.get("rv-filters", {}))),
  sort: LS.get("rv-sort", "deadline"),
  horizon: LS.get("rv-horizon", 183),          // timeline length in days
  showSummaries: LS.get("rv-summaries", false),
  openId: null,
  unsubComments: null,
  idea: { text: LS.get("rv-idea-text", ""), name: LS.get("rv-idea-name", ""), status: "idle", matches: [], note: "", offline: false, error: "", ctl: null, open: LS.get("rv-idea-open", true) },
};
const fav = (id) => S.me.favorites?.includes(id);
const noteOf = (id) => S.notes[id] || {};
const isMember = () => ["admin", "member"].includes(S.store.user.role);
const isAdmin = () => S.store.user.role === "admin";
const personName = (p) => S.allow.find((a) => a.email === p)?.name || p;
const nextDeadline = (c) => c.deadline || (c.deadlines || []).filter((d) => d >= TODAY_ISO).sort()[0] || null;
const isClosed = (c) => c.status === "closed" || (nextDeadline(c) === null && (c.deadlines || []).length > 0);
const isNew = (c) => c.firstSeen && (Date.parse(S.meta.lastRun || today) - parseIso(c.firstSeen)) / DAY <= 7;
function allTags() {
  const set = new Set();
  Object.values(S.notes).forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b, "en"));
}
function allIdeas() {
  const set = new Set();
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
  const tabs = [["list", "Calls"], ["board", "Pipeline"], ["partners", "Partners"], ["profile", "Profile"]].concat(isAdmin() ? [["users", "Users"]] : []);
  if (S.view === "users" && !isAdmin()) S.view = "list";
  $("#app").innerHTML = `
  ${S.store.mode === "demo" ? `<div class="demo-band"><span>Demo: a sample of ${S.calls.length} real calls collected on 29 Oct 2026 (the full service tracks about 450). Your changes are saved in this browser only. AI summaries and reasons on the calls are examples.</span><button id="demo-reset">Reset demo</button></div>` : ""}
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
  else if (S.view === "partners") renderPartners(v);
  else if (S.view === "users") renderUsers(v);
  else if (S.view === "profile") renderProfile(v);
  if (S.openId) renderDrawerBody();
}

/* ================= Filtering ================= */

function filtered() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const maxDate = f.window === "all" ? null : isoDate(new Date(today.getTime() + Number(f.window) * DAY));
  const me = S.store.user.email;
  return S.calls.filter((c) => {
    if (!f.sources.includes(groupOf(c))) return false;
    const st = isClosed(c) ? "closed" : c.status;
    if (!f.status.includes(st)) return false;
    if (f.favOnly && !fav(c.id)) return false;
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
  }[S.sort];
  return [...list].sort(by);
}
function saveFilters() { LS.set("rv-filters", S.filters); }

/* ================= Call list + timeline ================= */

function renderListView(v) {
  const list = sorted(filtered());
  const f = S.filters;
  const countBy = (s) => S.calls.filter((c) => groupOf(c) === s && !isClosed(c)).length;
  const tags = allTags();
  const ideas = allIdeas();
  const focusId = document.activeElement?.id;
  const sel = focusId && ["idea-text", "idea-name", "q"].includes(focusId) ? [$("#" + focusId).selectionStart, $("#" + focusId).selectionEnd] : null;
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
      <label class="check"><input type="checkbox" id="favonly" ${f.favOnly ? "checked" : ""}>My favourites</label>
      <label class="check"><input type="checkbox" id="mineonly" ${f.mineOnly ? "checked" : ""}>Calls I am involved in</label>
      ${ideas.length ? `<h2><label for="ideaf">Project idea</label></h2><select id="ideaf" class="sel" style="width:100%"><option value="">All ideas</option>${ideas.map((t) => `<option ${f.idea === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
      ${tags.length ? `<h2><label for="tagf">Tag</label></h2><select id="tagf" class="sel" style="width:100%"><option value="">All tags</option>${tags.map((t) => `<option ${f.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
      <button class="btn ghost reset" id="reset-f">Clear filters</button>
    </aside>
    <main class="main">
      ${ideaPanelHtml()}
      <div class="bar">
        <button class="btn ghost mobile-filters" id="toggle-f">Filters</button>
        <span class="count">${list.length} calls</span>
        <span class="spacer"></span>
        <label class="sr" for="sort">Sort by</label>
        <select id="sort" class="sel">
          <option value="deadline" ${S.sort === "deadline" ? "selected" : ""}>Deadline first</option>
          <option value="relevance" ${S.sort === "relevance" ? "selected" : ""}>Most relevant first</option>
          <option value="new" ${S.sort === "new" ? "selected" : ""}>Newest first</option>
        </select>
        <label class="check inline"><input type="checkbox" id="showsum" ${S.showSummaries ? "checked" : ""}>Show summaries</label>
        <button class="btn ghost" id="ics" title="Download the deadlines of your favourites as a calendar file">Favourites to calendar</button>
        ${isMember() ? `<button class="btn" id="add-call">Add a call</button>` : ""}
      </div>
      <div class="list" role="list">${list.length ? list.map(rowHtml).join("") : `<div class="empty"><b>No calls match these filters</b>Widen the deadline window or clear the filters.</div>`}</div>
      ${metaHtml()}
    </main>
  </div>`;
  renderRadar($("#track"), list);
  bindList(v);
  bindIdeaPanel();
  if (sel && $("#" + focusId)) { const el = $("#" + focusId); el.focus(); el.setSelectionRange(sel[0], sel[1]); }
}

function rowHtml(c) {
  const n = noteOf(c.id);
  const dl = nextDeadline(c);
  const dleft = daysLeft(dl);
  const cls = dleft !== null && dleft >= 0 && dleft <= 14 ? "urgent" : dleft !== null && dleft <= 45 ? "soon" : "";
  const src = srcOf(c);
  const rel = c.relevance ?? 0;
  const dlHtml = dl ? `<b>${fmtDate(dl)}</b><span>${daysText(dleft)}${(c.deadlines || []).length > 1 ? " · 2-stage" : ""}</span>`
    : c.continuous ? `<b>Rolling</b><span>no deadline</span>`
    : c.deadline_text ? `<b>—</b><span>${esc(c.deadline_text.slice(0, 26))}</span>` : `<b>—</b><span>see funder's page</span>`;
  const opens = c.status === "forthcoming" && c.opens ? `<span>opens ${fmtDate(c.opens)}</span>` : "";
  const region = c.source === "eura" && c.region ? " · " + esc(c.region.split(",")[0]) + (c.region.includes(",") ? " +" : "") : "";
  return `<div class="row ${isClosed(c) ? "closed" : ""}" role="listitem" data-id="${esc(c.id)}" tabindex="0">
    <span class="src" style="background:${src.color}" title="${esc(src.label)}"></span>
    <button class="star" data-fav="${esc(c.id)}" aria-pressed="${fav(c.id)}" aria-label="${fav(c.id) ? "Remove from favourites" : "Add to favourites"}">${fav(c.id) ? STAR : STAR_O}</button>
    <div>
      <div class="t">${esc(c.title)}</div>
      <div class="m">
        <span class="fund">${esc(src.short)}${c.programme && c.programme !== c.funder && c.programme !== src.label ? " · " + esc(c.programme) : ""}${region}</span>
        ${opens}
        ${isNew(c) ? `<span class="tag new">New</span>` : ""}
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
  $("#tagf") && ($("#tagf").onchange = (e) => { f.tag = e.target.value; upd(); });
  $("#ideaf") && ($("#ideaf").onchange = (e) => { f.idea = e.target.value; upd(); });
  $("#reset-f").onclick = () => { S.filters = { ...DEFAULT_FILTERS, sources: [...DEFAULT_FILTERS.sources], status: [...DEFAULT_FILTERS.status] }; upd(); };
  $("#toggle-f").onclick = () => $("#filters").classList.toggle("open");
  $("#sort").onchange = (e) => { S.sort = e.target.value; LS.set("rv-sort", S.sort); refresh(); };
  $("#ics").onclick = () => downloadIcs();
  $("#showsum").onchange = (e) => { S.showSummaries = e.target.checked; LS.set("rv-summaries", S.showSummaries); refresh(); };
  $$("[data-hz]", v).forEach((b) => (b.onclick = () => { S.horizon = Number(b.dataset.hz); LS.set("rv-horizon", S.horizon); refresh(); }));
  $("#add-call") && ($("#add-call").onclick = openAddCall);
  $$(".list .row", v).forEach((r) => {
    r.onclick = (e) => { if (!e.target.closest(".star")) openDrawer(r.dataset.id); };
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
      <div class="idea-head"><b>${items.length ? `${items.length} suggested ${items.length === 1 ? "call" : "calls"}` : "No good matches"}</b>${I.offline ? `<span class="tag">keyword match</span>` : ""}<span class="spacer"></span><button class="linkbtn" id="idea-clear">Clear results</button></div>
      ${I.note ? `<p class="idea-note">${esc(I.note)}</p>` : ""}
      ${items.map(({ m, c }) => {
        const dl = nextDeadline(c);
        const linked = noteOf(c.id).idea === I.name.trim();
        return `<div class="match">
          <div class="fit" title="Fit with the idea, 0-100"><b>${m.fit}</b><span>fit</span></div>
          <div class="mbody">
            <button class="mtitle" data-open="${esc(c.id)}">${esc(c.title)}</button>
            <div class="m"><span>${esc(srcOf(c).short)}${c.programme && c.programme !== c.funder ? " · " + esc(c.programme) : ""}</span><span>${dl ? `deadline ${fmtDate(dl)} (${daysText(daysLeft(dl))})` : c.continuous ? "rolling call" : "deadline not known"}</span></div>
            ${m.why ? `<p>${esc(m.why)}</p>` : ""}
            ${m.angle ? `<p class="angle"><b>Angle:</b> ${esc(m.angle)}</p>` : ""}
          </div>
          <div class="mact">
            <button class="star" data-fav="${esc(c.id)}" aria-pressed="${fav(c.id)}" aria-label="${fav(c.id) ? "Remove from favourites" : "Add to favourites"}">${fav(c.id) ? STAR : STAR_O}</button>
            ${linkable ? (linked ? `<span class="tag idea">Linked</span>` : `<button class="btn ghost small" data-link="${esc(c.id)}">Link to idea</button>`) : ""}
          </div>
        </div>`;
      }).join("")}
      ${items.length && !I.name.trim() && isMember() ? `<p class="idea-note">Give the idea a name to link suggested calls to it.</p>` : ""}
    </div>`;
  }
  return `<section class="idea" aria-labelledby="idea-h">
    <button class="idea-toggle" id="idea-toggle" aria-expanded="${I.open}"><span id="idea-h">Find calls for an idea</span><span class="chev" aria-hidden="true">${I.open ? "−" : "+"}</span></button>
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
  $("#idea-clear") && ($("#idea-clear").onclick = () => { I.status = "idle"; I.matches = []; I.note = ""; refresh(); });
  $$(".idea [data-open]").forEach((b) => (b.onclick = () => openDrawer(b.dataset.open)));
  $$(".idea [data-fav]").forEach((b) => (b.onclick = () => toggleFav(b.dataset.fav)));
  $$(".idea [data-link]").forEach((b) => (b.onclick = async () => {
    await S.store.saveNote(b.dataset.link, { idea: I.name.trim() });
    toast(`Linked to “${I.name.trim()}”`);
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

async function runIdeaSearch() {
  const I = S.idea;
  const idea = I.text.trim();
  if (idea.length < 15) { toast("Describe the idea in at least one sentence."); $("#idea-text")?.focus(); return; }
  const calls = activeCalls();
  I.ctl = new AbortController();
  I.status = "loading"; I.error = ""; refresh();
  try {
    const res = await S.store.suggestCalls({ idea, ideaName: I.name.trim(), lines: calls.map(callLine), signal: I.ctl.signal });
    I.matches = res.matches || []; I.note = res.note || ""; I.offline = !!res.offline; I.status = "done";
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
    ["Deadline", (c.deadlines || []).length ? c.deadlines.map((d) => `${fmtDate(d)}${d === dl ? ` (${daysText(daysLeft(d))})` : ""}`).join(", ") : c.continuous ? "Rolling call" : c.deadline_text || "Not known – check the funder's page"],
    ["Region / countries", c.region],
    ["First seen", fmtDate(c.firstSeen)],
  ].filter(([, v]) => v);
  dr.innerHTML = `
  <header>
    <div class="srcline"><i style="background:${src.color}"></i>${esc(src.label)}${isNew(c) ? ` <span class="tag new">New</span>` : ""}</div>
    <h2 id="dr-title">${esc(c.title)}</h2>
    <button class="close" aria-label="Close">×</button>
    <div class="actions">
      <a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open funder's page</a>
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

/* ================= Partners ================= */

function renderPartners(v) {
  const linked = (pid) => Object.entries(S.notes).filter(([, n]) => (n.partners || []).includes(pid)).map(([id]) => S.byId.get(id)).filter(Boolean);
  v.innerHTML = `<div class="page">
    <h1>Partners</h1>
    <p>A shared list of current and potential partners. Link a partner to a call from the call details.</p>
    ${isMember() ? `<form class="inline-form" id="pform">
      <label><span class="sr">Name</span><input name="name" required placeholder="Organisation name"></label>
      <label><span class="sr">Country</span><input name="country" placeholder="Country, e.g. DE"></label>
      <label><span class="sr">Type</span><select name="type"><option value="">Type</option><option>University</option><option>University of applied sciences</option><option>Research institute</option><option>Company</option><option>Public body</option><option>VET provider</option><option>Other</option></select></label>
      <label><span class="sr">Contact person</span><input name="contact" placeholder="Contact person"></label>
      <button class="btn" type="submit">Add partner</button>
    </form>` : ""}
    ${S.partners.length ? `<div style="overflow-x:auto"><table class="t"><thead><tr><th>Name</th><th>Country</th><th>Type</th><th>Contact</th><th>Calls</th></tr></thead><tbody>
      ${[...S.partners].sort((a, b) => a.name.localeCompare(b.name, "en")).map((p) => `<tr class="click" data-pid="${esc(p.id)}" tabindex="0">
        <td><b>${esc(p.name)}</b>${p.notes ? `<div class="summary" style="margin:2px 0 0">${esc(p.notes.slice(0, 90))}</div>` : ""}</td>
        <td>${esc(p.country)}</td><td>${esc(p.type)}</td><td>${esc(p.contact)}${p.email ? `<br>${esc(p.email)}` : ""}</td>
        <td>${linked(p.id).length || ""}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><b>No partners yet</b>Add the first one with the form above.</div>`}
  </div>`;
  $("#pform") && ($("#pform").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await S.store.savePartner({ ...d, email: "", notes: "" });
    toast(`${d.name} added`);
  });
  $$("tr[data-pid]", v).forEach((r) => { r.onclick = () => openPartner(r.dataset.pid, linked); r.onkeydown = (e) => e.key === "Enter" && openPartner(r.dataset.pid, linked); });
}

function openPartner(pid, linked) {
  const p = S.partners.find((x) => x.id === pid);
  const ro = !isMember();
  const calls = linked(pid);
  modal(`<h2>${esc(p.name)}</h2>
    <form id="pedit">
      <div class="grid2">
        <div class="field"><label for="pe-name">Name</label><input id="pe-name" name="name" value="${esc(p.name)}" required ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="pe-country">Country</label><input id="pe-country" name="country" value="${esc(p.country)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="pe-type">Type</label><input id="pe-type" name="type" value="${esc(p.type)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="pe-contact">Contact person</label><input id="pe-contact" name="contact" value="${esc(p.contact)}" ${ro ? "disabled" : ""}></div>
      </div>
      <div class="field"><label for="pe-email">Email</label><input id="pe-email" name="email" type="email" value="${esc(p.email)}" ${ro ? "disabled" : ""}></div>
      <div class="field"><label for="pe-notes">Notes</label><textarea id="pe-notes" name="notes" rows="4" ${ro ? "disabled" : ""}>${esc(p.notes)}</textarea></div>
      <div class="field"><span class="lbl">Linked to calls</span>${calls.length ? calls.map((c) => `<div><a href="#" data-open="${esc(c.id)}">${esc(c.title)}</a></div>`).join("") : "Not linked to any call yet."}</div>
      <div class="foot">${ro ? "" : `<button type="button" class="btn danger" id="pdel">Delete</button>`}<span style="flex:1"></span>
        <button type="button" class="btn ghost" data-close>Close</button>${ro ? "" : `<button class="btn" type="submit">Save</button>`}</div>
    </form>`);
  $$("[data-open]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); closeModal(); S.view = "list"; renderShell(); openDrawer(a.dataset.open); }));
  if (ro) return;
  $("#pedit").onsubmit = async (e) => {
    e.preventDefault();
    await S.store.savePartner({ id: pid, ...Object.fromEntries(new FormData(e.target)) });
    closeModal(); toast("Partner saved");
  };
  $("#pdel").onclick = async () => {
    if (!(await askConfirm(`Delete ${p.name} from the partner list?`))) return;
    await S.store.deletePartner(pid); closeModal(); toast("Partner deleted");
  };
}

/* ================= Relevance profile ================= */

const fmtWeight = (w) => String(Math.round(Number(w) * 10) / 10);

function renderProfile(v) {
  if (S.profileDraft) return renderProfileEditor(v);
  const p = S.profile;
  const when = p?.updatedAt ? new Date(p.updatedAt) : null;
  const chips = (list, cls = "") => (list || []).length
    ? `<div class="kw-chips">${[...list].sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word)).map((k) => `<span class="kw ${cls}">${esc(k.word)}<b>${cls ? "−" : ""}${fmtWeight(k.weight)}</b></span>`).join("")}</div>`
    : `<p class="summary">None.</p>`;
  v.innerHTML = `<div class="page profile">
    <h1>Relevance profile</h1>
    <p>This describes the team to Claude. Claude uses it every night to score how well each call fits and to write the reasons, and the idea search uses it too. The keywords give a quick score for calls that Claude has not assessed yet.</p>
    ${p === undefined ? `<p class="summary">Loading…</p>` : p === null ? `<div class="empty"><b>No profile yet</b>The collector creates it from its starting settings on its first run.${isAdmin() ? " You can also write it now." : ""}</div>` : `
    <section class="pf-block">
      <h2>Team description</h2>
      <p class="pf-org">${esc(p.organisation)}</p>
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
    <p class="foot-meta">Last edited${p.updatedBy ? ` by ${esc(p.updatedBy === "config.yaml" ? "the starting settings" : p.updatedBy)}` : ""}${when ? ` on ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.${isAdmin() ? "" : " Only admins can change the profile."}</p>`}
    ${isAdmin() ? `<button class="btn" id="pf-edit">${p ? "Edit profile" : "Write profile"}</button>` : ""}
  </div>`;
  $("#pf-edit") && ($("#pf-edit").onclick = () => {
    const base = S.profile || { organisation: "", keywords: [], negative: [] };
    S.profileDraft = { organisation: base.organisation || "", keywords: structuredClone(base.keywords || []), negative: structuredClone(base.negative || []) };
    refresh();
  });
}

function renderProfileEditor(v) {
  const d = S.profileDraft;
  const rows = (kind) => d[kind].map((k, i) => `<div class="kw-row">
      <label class="sr" for="${kind}-w-${i}">Word</label><input id="${kind}-w-${i}" data-kind="${kind}" data-i="${i}" data-f="word" value="${esc(k.word)}" placeholder="word or start of a word">
      <label class="sr" for="${kind}-n-${i}">Weight</label><input id="${kind}-n-${i}" data-kind="${kind}" data-i="${i}" data-f="weight" type="number" min="0.5" max="10" step="0.5" value="${esc(fmtWeight(k.weight))}">
      <button type="button" class="linkbtn" data-rmrow="${kind}:${i}" aria-label="Remove ${esc(k.word || "row")}">Remove</button>
    </div>`).join("");
  const orgChanged = (d.organisation || "").trim() !== (S.profile?.organisation || "").trim();
  v.innerHTML = `<div class="page profile">
    <h1>Edit relevance profile</h1>
    <form id="pf-form">
      <div class="field"><label for="pf-org">Team description for Claude</label>
        <textarea id="pf-org" rows="7" maxlength="3000">${esc(d.organisation)}</textarea>
        <p class="hint">Write it the way you would brief a colleague: who you are, your research themes, how you usually take part in projects (partner, coordinator) and where you are based. Plain sentences work best.</p></div>
      <div class="pf-cols">
        <div class="field"><span class="lbl">Keywords and weights</span>${rows("keywords")}<button type="button" class="btn ghost small" data-addrow="keywords">Add keyword</button></div>
        <div class="field"><span class="lbl">Negative keywords and weights</span>${rows("negative")}<button type="button" class="btn ghost small" data-addrow="negative">Add negative keyword</button></div>
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
    const changed = d.organisation.trim() !== (S.profile?.organisation || "").trim();
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
      await S.store.saveProfile({ organisation: org, keywords: clean(d.keywords), negative: clean(d.negative) });
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
