// Idea search prompt - shared by the browser app (demo) and the Cloudflare Worker.

export const DEFAULT_ORG = `Turku University of Applied Sciences (Turku UAS), New Energy Research Centre (NERC), Finland.
Applied RDI in solar PV, battery energy storage, agrivoltaics, energy communities, smart grids,
hydrogen and energy efficiency. Works closely with companies, municipalities and vocational education.
Based in Southwest Finland. Applies as a research organisation, usually as a consortium partner or coordinator.`;

/** Starting profile (same as collector/config.yaml). The live profile is settings/profile in Firestore. */
export const DEFAULT_PROFILE = {
  organisation: "Turku University of Applied Sciences (Turku UAS), New Energy Research Centre (NERC), Finland. Applied RDI in solar PV, battery energy storage, agrivoltaics, energy communities, smart grids, hydrogen and energy efficiency. Works closely with companies, municipalities and vocational education (e.g. Erasmus+ Centres of Vocational Excellence). Based in Southwest Finland (Varsinais-Suomi). Applies as a research organisation, usually as a consortium partner or coordinator.",
  keywords: [{ word: "aurinko", weight: 3 }, { word: "solar", weight: 3 }, { word: "photovolta", weight: 3 }, { word: "agrivolta", weight: 4 }, { word: "agri-pv", weight: 4 }, { word: "akku", weight: 3 }, { word: "battery", weight: 3 }, { word: "batteries", weight: 3 }, { word: "energy storage", weight: 3 }, { word: "energiavarasto", weight: 3 }, { word: "energiayhteisö", weight: 4 }, { word: "energy communit", weight: 4 }, { word: "smart grid", weight: 3 }, { word: "älyverkko", weight: 3 }, { word: "grid", weight: 1 }, { word: "vety", weight: 2 }, { word: "hydrogen", weight: 2 }, { word: "energiatehokkuus", weight: 2 }, { word: "energy efficiency", weight: 2 }, { word: "renewable", weight: 1 }, { word: "uusiutuva", weight: 1 }, { word: "energy", weight: 1 }, { word: "energia", weight: 1 }, { word: "vocational", weight: 2 }, { word: "ammatillinen", weight: 2 }, { word: "skills", weight: 1 }, { word: "osaaminen", weight: 1 }, { word: "tutkimusorganisaatio", weight: 1 }, { word: "research organisation", weight: 1 }, { word: "varsinais-suomi", weight: 3 }],
  negative: [{ word: "defence", weight: 3 }, { word: "puolustus", weight: 3 }, { word: "medical", weight: 2 }, { word: "cancer", weight: 3 }, { word: "space", weight: 1 }],
};

export const IDEA_LIMITS = { idea: 2000, name: 120, lines: 900, line: 420 };

/** One compact line per call, so several hundred calls fit in one prompt. */
export function callLine(c) {
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const deadline = c.deadline || (c.deadlines || [])[0] || (c.continuous ? "continuous" : c.deadline_text || "-");
  const tags = [...new Set([...(c.aiTags || []), ...(c.auto_tags || [])])].slice(0, 5).join(", ");
  const funder = c.programme && c.programme !== c.funder ? `${c.funder} / ${c.programme}` : c.funder;
  return [c.id, clip(funder, 70), clip(c.title, 160), `opens ${c.opens || "-"}`, `deadline ${clip(deadline, 30)}`,
    clip(c.action_type, 40), clip(tags, 70), clip(c.aiSummary || c.summary, 220)].filter(Boolean).join(" | ").slice(0, IDEA_LIMITS.line);
}

export function buildIdeaPrompt({ idea, ideaName = "", lines, org = DEFAULT_ORG, today }) {
  return `You help an applied research team find funding calls for a project idea.

TEAM:
${org}

PROJECT IDEA${ideaName ? ` ("${ideaName}")` : ""}:
${idea}

TODAY: ${today}

OPEN AND UPCOMING FUNDING CALLS (one per line: id | funder / programme | title | opens | deadline | type of action | tags | short description):
${lines.join("\n")}

Pick the calls that fit this idea best, at most 8. Prefer calls where a university of applied sciences can apply or be a partner and where there is still time to prepare. Be strict: return fewer calls if only a few fit, and none if nothing fits. Use the ids exactly as listed.

Reply with ONLY a JSON object:
{"matches": [{"id": "<id as listed>", "fit": <0-100>, "why": "<1-2 sentences: why this call fits the idea>", "angle": "<one sentence: how to frame the idea for this call>"}],
 "note": "<one sentence of overall advice, e.g. which kind of funding seems to be missing or what to sharpen in the idea>"}`;
}

/** Keeps only matches whose id exists, clamps fit, sorts best first. */
export function cleanMatches(result, knownIds) {
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return {
    note: typeof result?.note === "string" ? result.note.slice(0, 400) : "",
    matches: matches
      .filter((m) => m && knownIds.has(String(m.id)))
      .map((m) => ({ id: String(m.id), fit: Math.max(0, Math.min(100, Number(m.fit) || 0)),
        why: String(m.why || "").slice(0, 400), angle: String(m.angle || "").slice(0, 300) }))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 8),
  };
}
