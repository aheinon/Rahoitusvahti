// Prompt and answer cleaning for one partner description ("Write with Claude" on an organisation card).
// Used by the worker (worker/src/index.js). The monthly batch run (collector/describe.py) uses the same
// prompt in Python; keep the two in step.

const TYPE_HINT = { HES: "university or school", REC: "research organisation", PRC: "company", PUB: "public body", OTH: "unknown" };

/** Texts about the search instead of the organisation are not kept. */
export const META = /search tool|usage limit|could not be (confirmed|found|determined|verified)|search results?|no (further|additional) information|not (enough|sufficient) information|unable to (find|confirm)/i;

export const DESCRIBE_LIMITS = { name: 200, alt: 4, project: 120, projects: 6, hint: 400, website: 300, searches: 4 };

export function buildDescribePrompt({ name, alt = [], country = "", type = "OTH", projects = [], hint = "", website = "" }) {
  return `Find this organisation on the web and describe it briefly.

ORGANISATION: ${name}
${alt.length ? `ALSO KNOWN AS: ${alt.join(", ")}\n` : ""}COUNTRY HINT: ${country || "unknown"}
TYPE HINT: ${TYPE_HINT[type] || "unknown"}
IT HAS WORKED WITH TURKU UNIVERSITY OF APPLIED SCIENCES (FINLAND) IN: ${projects.join(", ") || "-"}
${website ? `ITS WEBSITE (given by our team, read it first with web_fetch): ${website}\n` : ""}${hint ? `NOTE FROM OUR TEAM (trust this): ${hint}\n` : ""}
${website ? "Read the website, and" : "Use web search to find its official website and what it does. Then"} reply with ONLY a JSON object:
{"found": <true if you are confident which organisation this is>,
  "person": <true if the name is a private individual rather than an organisation>,
  "official_name": "<its name as on its website>",
  "website": "<https://... home page, or null>",
  "description": "<2-3 factual sentences in English: what kind of organisation it is, its main activities, and its expertise in energy, sustainability or RDI if it has any. No praise, no guessing.>",
  "city": "<city or null>", "country": "<ISO 3166-1 alpha-2 code, e.g. FI, DE; null if unknown>",
  "lat": <latitude of the city, or null>, "lon": <longitude of the city, or null>,
  "type": "<HES (university), REC (research organisation), PRC (company), PUB (public body) or OTH>"}
If you cannot tell which organisation is meant, set "found" to false and leave the rest null.
You can search at most ${DESCRIBE_LIMITS.searches} times, so make each search count (start with the name and country).
The description is shown to readers as a profile of the organisation: write only facts about it.
Never mention searching, sources, tools, limits or what you could not find. If you know too little
to say what the organisation does, set "found" to false.`;
}

/** Same rules as clean() in describe.py. Returns the orgInfo fields, or {notFound: true}. */
export function cleanDescription(d, sources, model, now = new Date().toISOString()) {
  d = d || {};
  const at = now.slice(0, 19) + "+00:00";
  if (!d.found || d.person || META.test(String(d.description || ""))) return { notFound: true, person: !!d.person, at, model };
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const web = typeof d.website === "string" && /^https?:\/\//.test(d.website) ? d.website.slice(0, 300) : "";
  let lat = num(d.lat), lon = num(d.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) lat = lon = null;
  return {
    description: String(d.description || "").trim().slice(0, 900), officialName: String(d.official_name || "").slice(0, 200),
    website: web, city: String(d.city || "").slice(0, 80), country: String(d.country || "").toUpperCase().slice(0, 2), lat, lon,
    type: ["HES", "REC", "PRC", "PUB", "OTH"].includes(d.type) ? d.type : "",
    sources: [...new Set([web, ...sources].filter(Boolean))].slice(0, 3), at, model, notFound: false,
  };
}
