// Turku UAS partner register (derived from the Hypergene project portfolio) -> compact data for Firestore.
// The register is an Excel file with the sheets "Kumppanit" (one row per partner, name variants merged)
// and "Hankkeet ja kumppanit" (one row per project and partner). Sub-projects are already merged.
// It is imported in the browser and stored in Firestore (portfolio/*, team only), never in the repo.

/** Same normalisation as the collector (describe.py): upper case, no accents, only letters and digits. */
export const normName = (s) => String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();

const TYPE = { "koulutus/tutkimus": "HES", "tutkimuslaitos/keskus": "REC", yritys: "PRC", julkinen: "PUB", "järjestö/säätiö": "OTH", "muu/ei tiedossa": "OTH" };
const SELF = /turun ammattikorkeakoulu|turku university of applied sciences|^turku uas$|^tuas$/i;

function sheetRows(XLSX, wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`The sheet "${name}" is missing. Is this the partner register (TUAS_kumppanirekisteri.xlsx)?`);
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

/** Small stable id from text (FNV-1a), so a re-import keeps the same project ids. */
export function hashId(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * Parses the register workbook.
 * Returns {projects: [{id, acronym, title, instrument, funder, role, group, start, end, stage, energy, nerc, partners: [[name, role]]}],
 *          orgs: [{name, type, intl, projects, energy, variants}], summary}
 */
export function parseRegister(XLSX, wb, nercPattern = "New Energy") {
  const nercRe = new RegExp(nercPattern, "i");
  const byProject = new Map();
  for (const r of sheetRows(XLSX, wb, "Hankkeet ja kumppanit")) {
    const acr = String(r["lyhenne/nimi"] || "").trim();
    const title = String(r["hankkeen nimi"] || "").trim();
    if (!acr && !title) continue;
    const key = acr + "|" + title;
    let p = byProject.get(key);
    if (!p) {
      const group = String(r["koordinoiva tutkimusryhmä"] || "").trim();
      p = { id: hashId(key), acronym: acr, title, instrument: r["instrumentti"] || "", funder: r["rahoittaja (portfolio)"] || "",
        role: r["TUASin rooli"] || "", group, start: r["alkuvuosi"] || null, end: r["loppuvuosi"] || null, stage: r["vaihe"] || "",
        energy: r["energiahanke"] === true || String(r["energiahanke"]).toUpperCase() === "TRUE", nerc: nercRe.test(group), partners: [] };
      byProject.set(key, p);
    }
    const name = String(r["kumppani (yhdistetty)"] || "").trim();
    if (name && !SELF.test(name) && !p.partners.some((x) => x[0] === name)) p.partners.push([name, r["kumppanin rooli"] || ""]);
  }
  const orgs = [];
  for (const r of sheetRows(XLSX, wb, "Kumppanit")) {
    const name = String(r["kumppani"] || "").trim();
    if (!name || SELF.test(name)) continue;
    const variants = String(r["nimivariantit"] || "").split("|").map((x) => x.trim()).filter((x) => x && x !== name).slice(0, 8);
    orgs.push({ name, type: TYPE[String(r["tyyppi"] || "").toLowerCase()] || "OTH", intl: String(r["suomi_vai_kv"] || "") !== "FI",
      projects: Number(r["hankkeita"]) || 0, energy: Number(r["energiahankkeita"]) || 0, variants });
  }
  const projects = [...byProject.values()];
  return { projects, orgs, summary: { projects: projects.length, orgs: orgs.length, nerc: projects.filter((p) => p.nerc).length,
    links: projects.reduce((n, p) => n + p.partners.length, 0) } };
}

/** Splits a list into chunks that stay well under Firestore's 1 MiB document limit. */
export function chunk(items, maxBytes = 600_000) {
  const out = [];
  let cur = [], size = 0;
  for (const it of items) {
    const s = JSON.stringify(it).length * 1.2;
    if (cur.length && size + s > maxBytes) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}
