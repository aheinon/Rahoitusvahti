// Data layer: the same interface for Firebase mode and demo mode.
// Team annotations are kept apart from the collector's data (index/*).
import { buildDevelopPrompt, buildIdeaPrompt, cleanDevelop, cleanMatches, DEFAULT_PROFILE } from "./idea-prompt.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

/* ---------------- Firebase ---------------- */

export async function createFirebaseStore(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const EMAIL_KEY = "rv-signin-email";

  const store = {
    mode: "firebase",
    user: null,       // {email, name, role}

    // ---- sign-in (email link, no passwords) ----
    async init() {
      if (A.isSignInWithEmailLink(auth, location.href)) {
        let email = localStorage.getItem(EMAIL_KEY);
        if (!email) email = prompt("Confirm the email address the sign-in link was sent to:");
        if (email) {
          await A.signInWithEmailLink(auth, email.trim(), location.href);
          localStorage.removeItem(EMAIL_KEY);
          history.replaceState(null, "", location.pathname);
        }
      }
      return new Promise((resolve) => {
        A.onAuthStateChanged(auth, async (u) => {
          if (!u) { store.user = null; return resolve({ state: "signedOut" }); }
          const email = u.email.toLowerCase();
          try {
            const snap = await F.getDoc(F.doc(db, "allowlist", email));
            if (!snap.exists()) { store.user = { email }; return resolve({ state: "denied", email }); }
            store.user = { email, ...snap.data() };
            resolve({ state: "ok" });
          } catch (e) {
            store.user = { email };
            resolve({ state: "denied", email, error: e.message });
          }
        });
      });
    },
    async sendLink(email) {
      await A.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
      localStorage.setItem(EMAIL_KEY, email);
    },
    async signOut() { await A.signOut(auth); location.reload(); },

    // ---- calls ----
    async loadCalls() {
      const snap = await F.getDocs(F.collection(db, "index"));
      let items = [];
      snap.forEach((d) => { if (d.id.startsWith("calls-")) items = items.concat(d.data().items || []); });
      const manual = await F.getDocs(F.collection(db, "manualCalls"));
      manual.forEach((d) => items.push({ ...d.data(), id: "manual:" + d.id, source: "manual" }));
      const meta = await F.getDoc(F.doc(db, "meta", "collector"));
      return { items, meta: meta.exists() ? meta.data() : {} };
    },
    async addManualCall(data) {
      await F.addDoc(F.collection(db, "manualCalls"), { ...data, createdBy: store.user.email, createdAt: F.serverTimestamp() });
    },
    async deleteManualCall(id) { await F.deleteDoc(F.doc(db, "manualCalls", id.replace(/^manual:/, ""))); },

    // ---- shared annotations ----
    watchNotes(cb) {
      return F.onSnapshot(F.collection(db, "notes"), (snap) => {
        const out = {};
        snap.forEach((d) => { out[decodeId(d.id)] = d.data(); });
        cb(out);
      });
    },
    async saveNote(callId, patch) {
      await F.setDoc(F.doc(db, "notes", encodeId(callId)),
        { ...patch, updatedBy: store.user.email, updatedAt: F.serverTimestamp() }, { merge: true });
    },
    watchComments(callId, cb) {
      const q = F.query(F.collection(db, "notes", encodeId(callId), "comments"), F.orderBy("createdAt", "asc"));
      return F.onSnapshot(q, (snap) => {
        const out = [];
        snap.forEach((d) => {
          const c = d.data();
          out.push({ id: d.id, ...c, createdAt: c.createdAt?.toDate?.().toISOString() || new Date().toISOString() });
        });
        cb(out);
      });
    },
    async addComment(callId, text, mentions) {
      await F.addDoc(F.collection(db, "notes", encodeId(callId), "comments"),
        { text, mentions, author: store.user.email, authorName: store.user.name || store.user.email, createdAt: F.serverTimestamp() });
      await F.setDoc(F.doc(db, "notes", encodeId(callId)), { commentCount: F.increment(1) }, { merge: true });
    },
    async deleteComment(callId, id) {
      await F.deleteDoc(F.doc(db, "notes", encodeId(callId), "comments", id));
      await F.setDoc(F.doc(db, "notes", encodeId(callId)), { commentCount: F.increment(-1) }, { merge: true });
    },

    // ---- "is this relevant?" ratings: ratings/{callKey}__{email} ----
    watchRatings(cb) {
      return F.onSnapshot(F.collection(db, "ratings"), (snap) => {
        const out = {};
        snap.forEach((d) => {
          const r = d.data();
          (out[r.callId] ||= []).push({ email: r.email, name: r.name || r.email, v: r.v, reason: r.reason || "", at: r.at?.toDate?.().toISOString() || null });
        });
        cb(out);
      });
    },
    async saveRating(callId, v, reason = "") {
      const key = `${encodeId(callId)}__${store.user.email}`;
      if (v === null) return F.deleteDoc(F.doc(db, "ratings", key));
      await F.setDoc(F.doc(db, "ratings", key), { callId, callKey: encodeId(callId), email: store.user.email, name: store.user.name || store.user.email, v, reason: String(reason).slice(0, 300), at: F.serverTimestamp() });
    },

    // ---- partners ----
    watchPartners(cb) {
      return F.onSnapshot(F.collection(db, "partners"), (snap) => {
        const out = []; snap.forEach((d) => out.push({ id: d.id, ...d.data() })); cb(out);
      });
    },
    async savePartner(p) {
      const { id, ...data } = p;
      if (id) await F.setDoc(F.doc(db, "partners", id), data, { merge: true });
      else return (await F.addDoc(F.collection(db, "partners"), { ...data, createdBy: store.user.email })).id;
      return id;
    },
    async deletePartner(id) { await F.deleteDoc(F.doc(db, "partners", id)); },

    // ---- own profile / favourites ----
    async loadMe() {
      const s = await F.getDoc(F.doc(db, "users", store.user.email));
      return s.exists() ? s.data() : { favorites: [] };
    },
    async saveMe(patch) { await F.setDoc(F.doc(db, "users", store.user.email), patch, { merge: true }); },

    // ---- relevance profile (settings/profile) ----
    watchProfile(cb) {
      return F.onSnapshot(F.doc(db, "settings", "profile"), (snap) => {
        if (!snap.exists()) return cb(null);
        const d = snap.data();
        cb({ ...d, updatedAt: d.updatedAt?.toDate?.().toISOString() || d.updatedAt || null });
      });
    },
    async saveProfile(p) {
      await F.setDoc(F.doc(db, "settings", "profile"), { ...p, updatedBy: store.user.name || store.user.email, updatedAt: F.serverTimestamp() });
    },

    // ---- partner network (CORDIS, weekly) and the team's own project list ----
    async loadNetwork() {
      const snap = await F.getDocs(F.collection(db, "network"));
      let projects = [], orgs = [], updatedAt = null;
      snap.forEach((d) => {
        const x = d.data();
        if (d.id === "projects") { projects = x.items || []; updatedAt = x.updatedAt; } else if (d.id.startsWith("orgs-")) orgs = orgs.concat(x.items || []);
      });
      return { projects, orgs, updatedAt };
    },
    async loadRadar(callId) {
      const s = await F.getDoc(F.doc(db, "radar", encodeId(callId)));
      return s.exists() ? s.data().items || [] : [];
    },
    watchNetProjects(cb) {
      return F.onSnapshot(F.collection(db, "netProjects"), (snap) => {
        const out = []; snap.forEach((d) => out.push({ id: d.id, ...d.data() })); cb(out);
      }, () => cb([]));
    },
    async saveNetProject(p) {
      const { id, ...data } = p;
      if (id) { await F.setDoc(F.doc(db, "netProjects", id), { ...data, updatedBy: store.user.email }, { merge: true }); return id; }
      return (await F.addDoc(F.collection(db, "netProjects"), { ...data, createdBy: store.user.email })).id;
    },
    async deleteNetProject(id) { await F.deleteDoc(F.doc(db, "netProjects", id)); },

    // ---- idea bank (team only): ideas/{name in lower case}, pieces/{id} ----
    watchIdeas(cb) {
      return F.onSnapshot(F.collection(db, "ideas"), (snap) => {
        const out = {}; snap.forEach((d) => { const x = d.data(); out[x.name] = x; }); cb(out);
      }, () => cb({}));
    },
    async saveIdea(name, patch) {
      if (typeof patch === "string") patch = { description: patch };
      await F.setDoc(F.doc(db, "ideas", encodeId(name.toLowerCase())), { ...patch, name, updatedBy: store.user.email, updatedAt: F.serverTimestamp() }, { merge: true });
    },
    async deleteIdea(name) { await F.deleteDoc(F.doc(db, "ideas", encodeId(name.toLowerCase()))); },
    watchPieces(cb) {
      return F.onSnapshot(F.collection(db, "pieces"), (snap) => {
        const out = []; snap.forEach((d) => out.push({ id: d.id, ...d.data() })); cb(out);
      }, () => cb([]));
    },
    async savePiece(p) {
      const { id, ...data } = p;
      if (id) { await F.setDoc(F.doc(db, "pieces", id), { ...data, updatedAt: F.serverTimestamp() }, { merge: true }); return id; }
      return (await F.addDoc(F.collection(db, "pieces"), { ...data, broughtBy: store.user.email, createdAt: F.serverTimestamp() })).id;
    },
    async deletePiece(id) { await F.deleteDoc(F.doc(db, "pieces", id)); },

    // ---- idea search and idea analysis (Cloudflare Worker holds the Claude API key) ----
    ideaSearchAvailable() { return !!window.RV_CONFIG?.ideaSearchUrl; },
    async suggestCalls({ idea, ideaName, lines, signal }) { return callWorker({ idea, ideaName, lines }, signal); },
    async developIdea({ callId, ideaName, idea, call, signal }) { return callWorker({ mode: "develop", callId, ideaName, idea, call }, signal); },

    // ---- users ----
    watchAllow(cb) {
      return F.onSnapshot(F.collection(db, "allowlist"), (snap) => {
        const out = []; snap.forEach((d) => out.push({ email: d.id, ...d.data() })); cb(out);
      });
    },
    async saveAllow(email, data) { await F.setDoc(F.doc(db, "allowlist", email.toLowerCase()), data, { merge: true }); },
    async deleteAllow(email) { await F.deleteDoc(F.doc(db, "allowlist", email)); },
  };
  async function callWorker(payload, signal) {
    const url = window.RV_CONFIG?.ideaSearchUrl;
    if (!url) throw { code: "not_configured" };
    const token = await auth.currentUser.getIdToken();
    let res;
    try {
      res = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload) });
    } catch (e) { throw { code: e.name === "AbortError" ? "cancelled" : "network", message: e.message }; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: res.status === 429 ? "rate_limited" : "server", message: body.error || `HTTP ${res.status}` };
    return body;
  }
  return store;
}

// Firestore document ids cannot contain '/'
const encodeId = (id) => id.replace(/\//g, "∕");
const decodeId = (id) => id.replace(/∕/g, "/");

/* ---------------- Demo (browser storage) ---------------- */

export async function createDemoStore() {
  const KEY = "rv-demo-en-v6";
  const base = window.RV_DEMO_DATA || (await (await fetch("demo-data.json")).json());
  const now = Date.now();
  const seed = {
    notes: {
      "eu:HORIZON-CL5-2027-02-D3-15": { stage: "preparing", idea: "PV-Factory pilot line", tags: ["solar PV", "consortium needed"], people: ["demo@turkuamk.fi", "matti.meikalainen@turkuamk.fi"], partners: ["p1", "p3"], commentCount: 3 },
      "eu:HORIZON-CL5-2027-05-D2-08": { stage: "watching", idea: "Housing company PV + storage", tags: ["batteries"], people: ["maija.meikalainen@turkuamk.fi"], partners: [], commentCount: 0 },
      "bf:haku-tutkimusorganisaatio-pk-yritys": { stage: "watching", idea: "Housing company PV + storage", tags: ["SME collaboration"], people: [], partners: ["p2"], commentCount: 1 },
    },
    comments: {
      "eu:HORIZON-CL5-2027-02-D3-15": [
        { id: "c1", author: "matti.meikalainen@turkuamk.fi", authorName: "Matti Meikäläinen", text: "The work programme says IA, TRL 6-7. Do we have a pilot site to offer?", mentions: [], createdAt: new Date(now - 3 * 864e5).toISOString() },
        { id: "c2", author: "demo@turkuamk.fi", authorName: "Demo User", text: "@Maija Meikäläinen could you ask the example university whether they would coordinate?", mentions: ["maija.meikalainen@turkuamk.fi"], createdAt: new Date(now - 864e5).toISOString() },
        { id: "c4", author: "demo@turkuamk.fi", authorName: "Demo User", createdAt: new Date(now - 6 * 36e5).toISOString(), mentions: [],
          text: "Claude's analysis of “PV-Factory pilot line” for this call (fit 71/100) [example]\n\nA reasonable fit as a partner: the call funds pilot lines for next-generation PV manufacturing, and the idea brings a test environment and SME links. As a coordinator it would be too heavy; the call expects industrial manufacturers to lead.\n\nWhat already fits:\n• Testing new module production steps with SMEs\n• Student involvement supports the skills and replication aspects\n\nGaps to close:\n• The call expects demonstration at manufacturing scale; join a consortium led by a PV manufacturer\n• Define measurable targets for module efficiency and cost\n\nPartners and roles needed:\n• A European PV equipment or module manufacturer as coordinator\n• A research institute with cell and module characterisation (e.g. CEA, Fraunhofer ISE)\n\nRisks:\n• Large consortia: the UAS role may be small unless the test environment is a work package of its own\n\nNext steps:\n1. Contact EUPI-PV partnership members about consortia forming\n2. Describe the pilot line's capabilities on one page" },
      ],
      "bf:haku-tutkimusorganisaatio-pk-yritys": [
        { id: "c3", author: "maija.meikalainen@turkuamk.fi", authorName: "Maija Meikäläinen", text: "Good route for regional energy SMEs. Let's map which SMEs are interested.", mentions: [], createdAt: new Date(now - 2 * 864e5).toISOString() },
      ],
    },
    partners: [
      { id: "p1", name: "Example University", country: "DE", type: "University", contact: "Contact person (example)", email: "", notes: "Example row - edit or delete." },
      { id: "p2", name: "Solar Tech Ltd (example)", country: "FI", type: "Company", contact: "", email: "", notes: "" },
      { id: "p3", name: "FUNDACION CIRCE CENTRO DE INVESTIGACION DE RECURSOS Y CONSUM", cordisId: "999516907", country: "ES", type: "Research institute", contact: "Contact person (example)", email: "", notes: "Coordinated SUNVIBE. Strong in grid integration and inverters; good coordinator candidate for PV calls. (example notes)", close: true },
    ],
    allow: [
      { email: "demo@turkuamk.fi", name: "Demo User", role: "admin", org: "Turku UAS" },
      { email: "matti.meikalainen@turkuamk.fi", name: "Matti Meikäläinen", role: "member", org: "Turku UAS" },
      { email: "maija.meikalainen@turkuamk.fi", name: "Maija Meikäläinen", role: "member", org: "Turku UAS" },
      { email: "partner@example.eu", name: "Partner (example)", role: "partner", org: "Example University" },
    ],
    me: { favorites: ["eu:HORIZON-CL5-2027-02-D3-15", "aka:2027-akatemiahankkeet-kaikki-tutkimusalat", "eu:HORIZON-MISS-2027-04-CIT-01"] },
    manual: [],
    ideas: {
      "PV-Factory pilot line": { name: "PV-Factory pilot line", status: "developing", scope: "international", funders: ["horizon", "cetp"],
        search: { at: new Date(now - 864e5).toISOString(), note: "", matches: [
          { id: "eu:HORIZON-CL5-2027-02-D3-15", fit: 78, why: "Pilot lines for next-generation PV manufacturing.", angle: "Offer the pilot line as a test bed in a manufacturer-led consortium." },
          { id: "cetp:joint-call-2026", fit: 66, why: "Renewable power technologies module; Business Finland funds Finnish partners.", angle: "Smaller transnational project on module testing with SMEs." },
          { id: "eu:HORIZON-CL5-2027-02-D3-07", fit: 41, why: "Solar technology, but thermal rather than PV.", angle: "Only if a CSP partner leads." }],
          strengthen: ["Describe the pilot line's equipment and capacity in one paragraph; the Horizon call expects manufacturing-scale demonstration.", "Name one or two Finnish SMEs that would use the line, for the CETP national requirements."] }, pieces: ["pc2"], description: "A pilot line at Turku UAS for testing new PV module production steps with Finnish SMEs, with students doing the test runs and quality measurements." },
      "Housing company PV + storage": { name: "Housing company PV + storage", status: "raw", scope: "national", funders: ["bf", "eura"],
        search: { at: new Date(now - 2 * 864e5).toISOString(), note: "", matches: [
          { id: "bf:haku-tutkimusorganisaatio-pk-yritys", fit: 74, why: "Research organisations with SMEs that are new to research collaboration.", angle: "Installers and battery integrators as the SME group." },
          { id: "eu:HORIZON-CL5-2027-05-D2-08", fit: 58, why: "Battery storage demonstration, though aimed at long-duration grid storage.", angle: "Housing companies as a distributed storage use case." },
          { id: "maaseutu:demo-varsinhyva", fit: 35, why: "Local development funding in Turku region, but rural areas only.", angle: "Only for a housing company in a rural Leader area." }],
          strengthen: ["Name the pilot housing company and when its roof renovation is due.", "Decide whether the energy community angle (shared battery) or the skills angle (students) leads the application."] }, pieces: ["pc1"], description: "A pilot where a housing company shares rooftop PV and a battery between apartments, with vocational students doing the installation and monitoring." },
    },
    netProjects: [
      { id: "cordis-101123238", kind: "cordis", pid: "101123238", nerc: true, close: ["998802502", "892171760", "999951467", "953024419"] },
      { id: "cordis-101269394", kind: "cordis", pid: "101269394", nerc: true, close: ["881684411", "995129985"] },
      { id: "np1", kind: "manual", nerc: true, name: "Example Erasmus+ CoVE project (example)", programme: "Erasmus+", start: "2024", end: "2027",
        partners: [{ name: "Example VET college (example)", country: "NL", city: "Utrecht", type: "HES" }, { name: "FUNDACION CIRCE CENTRO DE INVESTIGACION DE RECURSOS Y CONSUM", country: "ES", city: "Zaragoza", type: "REC" }] },
    ],
    pieces: [
      { id: "pc1", kind: "site", title: "1960s terraced housing company in Turku (example)", description: "16 apartments, roof renovation planned for 2028; the board is interested in PV and a shared battery.", contact: "Board chair (example)", tags: ["PV", "battery", "housing"], broughtBy: "maija.meikalainen@turkuamk.fi" },
      { id: "pc2", kind: "resource", title: "Electroluminescence imaging set-up (example)", description: "Drone and lab EL/PL imaging for PV module inspection.", contact: "", tags: ["PV", "inspection"], broughtBy: "demo@turkuamk.fi" },
      { id: "pc3", kind: "need", title: "Local SME needs battery ageing data (example)", description: "A battery integrator wants field data on how home batteries age in Finnish conditions.", contact: "", tags: ["battery"], broughtBy: "matti.meikalainen@turkuamk.fi" },
    ],
    ratings: {
      "eu:HORIZON-CL5-2027-02-D3-15": [{ email: "matti.meikalainen@turkuamk.fi", name: "Matti Meikäläinen", v: 1, reason: "Core PV topic", at: new Date(now - 2 * 864e5).toISOString() }],
      "eu:HORIZON-CL5-2027-05-D2-08": [{ email: "maija.meikalainen@turkuamk.fi", name: "Maija Meikäläinen", v: 1, reason: "", at: new Date(now - 2 * 864e5).toISOString() }],
      "eu:HORIZON-MISS-2027-04-CIT-01": [{ email: "maija.meikalainen@turkuamk.fi", name: "Maija Meikäläinen", v: -1, reason: "Cities mission: needs a city as coordinator, we have none lined up", at: new Date(now - 864e5).toISOString() }],
      "eura:bbffeaa0-a0da-493e-9793-fb2f6e16a0b3": [{ email: "matti.meikalainen@turkuamk.fi", name: "Matti Meikäläinen", v: -1, reason: "Youth services, not our field", at: new Date(now - 3 * 864e5).toISOString() }],
      "bf:haku-tutkimusorganisaatio-pk-yritys": [{ email: "maija.meikalainen@turkuamk.fi", name: "Maija Meikäläinen", v: 1, reason: "", at: new Date(now - 864e5).toISOString() }],
    },
    profile: { ...structuredClone(DEFAULT_PROFILE), updatedBy: "config.yaml", updatedAt: "2026-10-29T03:17:00Z" },
  };
  let st;
  try { st = JSON.parse(localStorage.getItem(KEY)) || seed; } catch { st = seed; }
  st.profile ||= structuredClone(seed.profile);
  st.ratings ||= structuredClone(seed.ratings);
  st.ideas ||= structuredClone(seed.ideas);
  st.pieces ||= structuredClone(seed.pieces);
  st.netProjects ||= structuredClone(seed.netProjects);
  const listeners = { netProjects: new Set(), pieces: new Set(), ideas: new Set(), ratings: new Set(), notes: new Set(), partners: new Set(), allow: new Set(), comments: new Map(), profile: new Set() };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage is optional */ } };
  const emit = (k) => {
    save();
    if (k === "notes") listeners.notes.forEach((cb) => cb(structuredClone(st.notes)));
    if (k === "partners") listeners.partners.forEach((cb) => cb(structuredClone(st.partners)));
    if (k === "allow") listeners.allow.forEach((cb) => cb(structuredClone(st.allow)));
  };
  const watch = (set, cb, val) => { set.add(cb); cb(structuredClone(val)); return () => set.delete(cb); };

  const store = {
    mode: "demo",
    user: { email: "demo@turkuamk.fi", name: "Demo User", role: "admin" },
    async init() { return { state: "ok" }; },
    async signOut() { localStorage.removeItem(KEY); location.reload(); },
    reset() { localStorage.removeItem(KEY); location.reload(); },
    async loadCalls() { return { items: base.items.concat(st.manual), meta: base.meta }; },
    async addManualCall(d) { st.manual.push({ ...d, id: "manual:" + Date.now(), source: "manual", createdBy: store.user.email }); save(); },
    async deleteManualCall(id) { st.manual = st.manual.filter((m) => m.id !== id); save(); },
    watchNotes(cb) { return watch(listeners.notes, cb, st.notes); },
    async saveNote(id, patch) { st.notes[id] = { ...(st.notes[id] || {}), ...patch }; emit("notes"); },
    watchComments(id, cb) {
      const fn = () => cb(structuredClone(st.comments[id] || []));
      listeners.comments.set(id, fn); fn();
      return () => listeners.comments.delete(id);
    },
    async addComment(id, text, mentions) {
      (st.comments[id] ||= []).push({ id: "c" + Date.now(), author: store.user.email, authorName: store.user.name, text, mentions, createdAt: new Date().toISOString() });
      st.notes[id] = { ...(st.notes[id] || {}), commentCount: (st.notes[id]?.commentCount || 0) + 1 };
      emit("notes"); listeners.comments.get(id)?.();
    },
    async deleteComment(id, cid) {
      st.comments[id] = (st.comments[id] || []).filter((c) => c.id !== cid);
      st.notes[id].commentCount = Math.max(0, (st.notes[id].commentCount || 1) - 1);
      emit("notes"); listeners.comments.get(id)?.();
    },
    watchRatings(cb) { return watch(listeners.ratings, cb, st.ratings); },
    watchIdeas(cb) { return watch(listeners.ideas, cb, st.ideas); },
    async saveIdea(name, patch) {
      if (typeof patch === "string") patch = { description: patch };
      st.ideas[name] = { ...(st.ideas[name] || {}), ...patch, name, updatedBy: store.user.email };
      save(); listeners.ideas.forEach((cb) => cb(structuredClone(st.ideas)));
    },
    async deleteIdea(name) { delete st.ideas[name]; save(); listeners.ideas.forEach((cb) => cb(structuredClone(st.ideas))); },
    watchPieces(cb) { return watch(listeners.pieces, cb, st.pieces); },
    async loadNetwork() { const n = await demoNetwork(); return { projects: n.projects, orgs: n.orgs, updatedAt: n.updatedAt }; },
    async loadRadar(callId) { return (await demoNetwork()).radar[callId] || []; },
    watchNetProjects(cb) { return watch(listeners.netProjects, cb, st.netProjects); },
    async saveNetProject(p) {
      const id = p.id || "np" + Date.now();
      const i = st.netProjects.findIndex((x) => x.id === id);
      if (i >= 0) st.netProjects[i] = { ...st.netProjects[i], ...p, id }; else st.netProjects.push({ ...p, id });
      save(); listeners.netProjects.forEach((cb) => cb(structuredClone(st.netProjects))); return id;
    },
    async deleteNetProject(id) { st.netProjects = st.netProjects.filter((x) => x.id !== id); save(); listeners.netProjects.forEach((cb) => cb(structuredClone(st.netProjects))); },
    async savePiece(p) {
      if (p.id) st.pieces = st.pieces.map((x) => (x.id === p.id ? { ...x, ...p } : x));
      else { p = { ...p, id: "pc" + Date.now(), broughtBy: store.user.email, createdAt: new Date().toISOString() }; st.pieces.push(p); }
      save(); listeners.pieces.forEach((cb) => cb(structuredClone(st.pieces))); return p.id;
    },
    async deletePiece(id) { st.pieces = st.pieces.filter((x) => x.id !== id); save(); listeners.pieces.forEach((cb) => cb(structuredClone(st.pieces))); },
    // Analysis of a linked idea for one call: Claude through the artifact viewer when available.
    async developIdea({ callId, ideaName, idea, call, callText, signal }) {
      const sample = window.claude?.use ? await window.claude.use("sample").catch(() => null) : null;
      if (!sample) throw { code: "not_available", message: "Claude's analysis needs the live service (or the demo opened in Claude)." };
      const prompt = buildDevelopPrompt({ org: st.profile?.organisation || DEFAULT_PROFILE.organisation, ideaName, idea, call, callText, today: new Date().toISOString().slice(0, 10) });
      try {
        return { ...cleanDevelop(await sample.json(prompt, { signal, modelTier: "default" })), hadCallText: false };
      } catch (e) {
        if (e?.name === "AbortError" || e?.code === "aborted") throw { code: "cancelled" };
        throw { code: e?.code || "server", message: e?.message || "Claude could not answer." };
      }
    },
    async saveRating(callId, v, reason = "") {
      const list = (st.ratings[callId] || []).filter((r) => r.email !== store.user.email);
      if (v !== null) list.push({ email: store.user.email, name: store.user.name, v, reason, at: new Date().toISOString() });
      st.ratings[callId] = list;
      save(); listeners.ratings.forEach((cb) => cb(structuredClone(st.ratings)));
    },
    watchPartners(cb) { return watch(listeners.partners, cb, st.partners); },
    async savePartner(p) {
      if (p.id) st.partners = st.partners.map((x) => (x.id === p.id ? { ...x, ...p } : x));
      else { p = { ...p, id: "p" + Date.now() }; st.partners.push(p); }
      emit("partners"); return p.id;
    },
    async deletePartner(id) { st.partners = st.partners.filter((p) => p.id !== id); emit("partners"); },
    watchProfile(cb) { return watch(listeners.profile, cb, st.profile); },
    async saveProfile(p) {
      st.profile = { ...p, updatedBy: store.user.name, updatedAt: new Date().toISOString() };
      save(); listeners.profile.forEach((cb) => cb(structuredClone(st.profile)));
    },
    async loadMe() { return structuredClone(st.me); },
    async saveMe(patch) { st.me = { ...st.me, ...patch }; save(); },
    watchAllow(cb) { return watch(listeners.allow, cb, st.allow); },
    async saveAllow(email, data) {
      email = email.toLowerCase();
      const i = st.allow.findIndex((a) => a.email === email);
      if (i >= 0) st.allow[i] = { ...st.allow[i], ...data }; else st.allow.push({ email, ...data });
      emit("allow");
    },
    async deleteAllow(email) { st.allow = st.allow.filter((a) => a.email !== email); emit("allow"); },

    // Idea search: Claude through the artifact viewer when available, otherwise local keyword matching.
    ideaSearchAvailable() { return true; },
    async suggestCalls({ idea, ideaName, lines, signal }) {
      const knownIds = new Set(lines.map((l) => l.split(" | ")[0]));
      const sample = window.claude?.use ? await window.claude.use("sample").catch(() => null) : null;
      if (sample) {
        const prompt = buildIdeaPrompt({ idea, ideaName, lines, org: st.profile?.organisation || DEFAULT_PROFILE.organisation, today: new Date().toISOString().slice(0, 10) });
        try {
          const result = await sample.json(prompt, { signal, modelTier: "default" });
          return cleanMatches(result, knownIds);
        } catch (e) {
          if (!["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e?.code)) throw e;
        }
      }
      return { ...keywordMatch(idea, lines), offline: true };
    },
  };
  return store;
}

let _demoNet = null;
async function demoNetwork() {
  _demoNet ||= window.RV_DEMO_NETWORK || (await (await fetch("demo-network.json")).json());
  return _demoNet;
}

// Fallback when Claude is not reachable: word overlap between the idea and each call line.
function keywordMatch(idea, lines) {
  const stop = new Set("and the for with from that this into our are can will a an of to in on at by or as is be we it".split(" "));
  const words = [...new Set(idea.toLowerCase().match(/[\p{L}\p{N}-]{3,}/gu) || [])].filter((w) => !stop.has(w));
  const scored = lines.map((l) => {
    const low = l.toLowerCase();
    const hits = words.filter((w) => low.includes(w.slice(0, Math.max(4, w.length - 2))));
    return { id: l.split(" | ")[0], hits };
  }).filter((x) => x.hits.length).sort((a, b) => b.hits.length - a.hits.length).slice(0, 8);
  const top = scored[0]?.hits.length || 1;
  return {
    note: "Claude is not available here, so these are simple keyword matches.",
    matches: scored.map((s) => ({ id: s.id, fit: Math.round((s.hits.length / top) * 60), why: `Shares the words: ${s.hits.slice(0, 6).join(", ")}.`, angle: "" })),
  };
}
