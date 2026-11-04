"""Short descriptions of partner organisations, written by Claude from web search results.

For each partner in scope that has no description yet (or an old one), Claude searches the web,
finds the organisation's website and writes 2-3 factual sentences: what it is, what it does,
where it is. It also returns the city, country and approximate coordinates for the map.
Results go to Firestore orgInfo/{key} (key = the normalised name, same as normName in the app).
Descriptions the team has edited in the app are never overwritten.

Scope (config.yaml, describe.scope):
  energy  - partners of energy projects in the partner register, partners of NERC's projects,
            EU partners of NERC's projects and everyone on the team's partner list (default)
  all     - every partner organisation

Cost: Claude's web search is billed per search (about $10 per 1000) plus tokens. With up to 3
searches per organisation, ~300 organisations cost roughly $5-10. `max_per_run` caps each run.

Usage:
  python describe.py                 # describe up to max_per_run organisations
  python describe.py --limit 20      # a small test run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import yaml

sys.path.insert(0, os.path.dirname(__file__))

from common import log  # noqa: E402

PROMPT = """Find this organisation on the web and describe it briefly.

ORGANISATION: {name}
{alt}COUNTRY HINT: {country}
TYPE HINT: {type}
IT HAS WORKED WITH TURKU UNIVERSITY OF APPLIED SCIENCES (FINLAND) IN: {projects}

Use web search to find its official website and what it does. Then reply with ONLY a JSON object:
{{"found": <true if you are confident which organisation this is>,
  "person": <true if the name is a private individual rather than an organisation>,
  "official_name": "<its name as on its website>",
  "website": "<https://... home page, or null>",
  "description": "<2-3 factual sentences in English: what kind of organisation it is, its main activities, and its expertise in energy, sustainability or RDI if it has any. No praise, no guessing.>",
  "city": "<city or null>", "country": "<ISO 3166-1 alpha-2 code, e.g. FI, DE; null if unknown>",
  "lat": <latitude of the city, or null>, "lon": <longitude of the city, or null>,
  "type": "<HES (university), REC (research organisation), PRC (company), PUB (public body) or OTH>"}}
If you cannot tell which organisation is meant, set "found" to false and leave the rest null.
You can search at most {searches} times, so make each search count (start with the name and country).
The description is shown to readers as a profile of the organisation: write only facts about it.
Never mention searching, sources, tools, limits or what you could not find. If you know too little
to say what the organisation does, set "found" to false."""

# Descriptions that talk about the search instead of the organisation are not kept
META = re.compile(r"search tool|usage limit|could not be (confirmed|found|determined|verified)|search results?|"
                  r"no (further|additional) information|not (enough|sufficient) information|unable to (find|confirm)", re.I)

TYPE_HINT = {"HES": "university or school", "REC": "research organisation", "PRC": "company", "PUB": "public body", "OTH": "unknown"}


def norm_name(s: str) -> str:
    """Same as normName in web/portfolio.js."""
    s = unicodedata.normalize("NFD", str(s or "").upper())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def candidates(name: str, variants=()) -> list[str]:
    inner = re.search(r"\(([^)]+)\)", name)
    return [x for x in [name, re.sub(r"\s*\([^)]*\)\s*", " ", name).strip(), inner.group(1) if inner else "", *variants] if x]


def select(data: dict, scope: str = "energy") -> list[dict]:
    """Organisations to describe: [{key, name, alt, country, type, projects}] without duplicates.

    data = {portfolio: {projects, orgs, meta} | None, network: {projects, orgs}, netProjects: [...], partners: [...]}"""
    pf = data.get("portfolio") or {"projects": [], "orgs": [], "meta": {}}
    net = data.get("network") or {"projects": [], "orgs": []}
    docs = {d.get("id"): d for d in data.get("netProjects", [])}
    pf_nerc = {p["id"] for p in pf["projects"]
               if (docs.get("pf-" + p["id"], {}).get("nerc") if "nerc" in docs.get("pf-" + p["id"], {}) else p.get("nerc"))}
    nerc_acr = {norm_name(p.get("acronym")) for p in pf["projects"] if p["id"] in pf_nerc}
    cordis_nerc = {p["pid"] for p in net["projects"]
                   if (docs.get("cordis-" + p["pid"], {}).get("nerc") if "nerc" in docs.get("cordis-" + p["pid"], {}) else norm_name(p.get("acronym")) in nerc_acr)}
    acr = {p["pid"]: p.get("acronym", "") for p in net["projects"]}

    out, seen = [], set()

    def add(name, alt=(), country="", typ="OTH", projects=()):
        keys = {norm_name(c) for c in candidates(name, alt)}
        if not name or keys & seen:
            return
        seen.update(keys)
        out.append({"key": norm_name(name), "name": name, "alt": [a for a in alt if a != name][:4], "country": country or "",
                    "type": typ or "OTH", "projects": list(projects)[:6]})

    # EU partners of NERC's projects first (they have CORDIS names and locations already)
    for o in net["orgs"]:
        mine = [p for p in o.get("projects", []) if p in cordis_nerc]
        if scope == "all" or mine:
            add(o["name"], country=o.get("country", ""), typ=o.get("type", "OTH"), projects=[acr.get(p, p) + " (Horizon)" for p in (mine or o.get("projects", []))])
    pf_projects_of = {}
    for p in pf["projects"]:
        for x in p.get("partners", []):                     # Firestore: [{n, r}]; tests: [[name, role]]
            name = x.get("n") if isinstance(x, dict) else x[0]
            pf_projects_of.setdefault(name, []).append(p)
    for o in sorted(pf["orgs"], key=lambda o: (-o.get("energy", 0), -o.get("projects", 0))):
        projs = pf_projects_of.get(o["name"], [])
        in_scope = scope == "all" or o.get("energy", 0) > 0 or any(p["id"] in pf_nerc for p in projs)
        if in_scope:
            add(o["name"], o.get("variants", []), "" if o.get("intl") else "FI", o.get("type", "OTH"),
                [f"{p.get('acronym') or p.get('title')} ({p.get('instrument')}, {p.get('start')})" for p in projs])
    for d in data.get("partners", []):                     # the team's partner list (potential partners too)
        add(d.get("name", ""), country=d.get("country", ""), typ="OTH")
    for mp in docs.values():                                # partners of projects the team added by hand
        if mp.get("kind") == "manual":
            for pt in mp.get("partners", []):
                add(pt.get("name", ""), country=pt.get("country", ""), typ="OTH", projects=[mp.get("name", "")])
    return out


class Describer:
    def __init__(self, cfg: dict):
        import anthropic
        self.client = anthropic.Anthropic(max_retries=4, timeout=120)
        self.model = cfg.get("model", "claude-haiku-5-5")
        self.max_uses = int(cfg.get("searches_per_org", 3))
        self.tool = cfg.get("tool", "web_search_20260209")
        self.searches = self.tokens_in = self.tokens_out = 0
        self.lock = threading.Lock()

    def describe(self, org: dict) -> dict | None:
        prompt = PROMPT.format(name=org["name"], alt=f"ALSO KNOWN AS: {', '.join(org['alt'])}\n" if org["alt"] else "",
                               country=org["country"] or "unknown", type=TYPE_HINT.get(org["type"], "unknown"),
                               projects=", ".join(org["projects"]) or "-", searches=self.max_uses)
        for attempt in range(2):
            try:
                msg = self.client.messages.create(
                    model=self.model, max_tokens=1500, messages=[{"role": "user", "content": prompt}],
                    tools=[{"type": self.tool, "name": "web_search", "max_uses": self.max_uses}])
                break
            except Exception as e:  # an older account or model may only know the older tool version
                if attempt == 0 and "web_search" in str(e) and self.tool != "web_search_20250305":
                    log(f"  web search tool {self.tool} not accepted, using web_search_20250305")
                    self.tool = "web_search_20250305"
                    continue
                log(f"  {org['name']}: {e}")
                return None
        with self.lock:
            u = msg.usage
            self.tokens_in += getattr(u, "input_tokens", 0) or 0
            self.tokens_out += getattr(u, "output_tokens", 0) or 0
            self.searches += getattr(getattr(u, "server_tool_use", None), "web_search_requests", 0) or 0
        text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
        sources = []
        for b in msg.content:
            if getattr(b, "type", "") == "web_search_tool_result" and isinstance(getattr(b, "content", None), list):
                sources += [getattr(r, "url", None) for r in b.content if getattr(r, "url", None)]
        m = re.search(r"\{.*\}", text, re.S)
        try:
            data = json.loads(m.group(0)) if m else {}
        except json.JSONDecodeError:
            data = {}
        return clean(data, sources, self.model)


def clean(d: dict, sources: list, model: str) -> dict:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not d.get("found") or d.get("person") or META.search(str(d.get("description") or "")):
        return {"notFound": True, "person": bool(d.get("person")), "at": now, "model": model}
    num = lambda x: float(x) if isinstance(x, (int, float)) else None  # noqa: E731
    web = d.get("website") if isinstance(d.get("website"), str) and d["website"].startswith("http") else ""
    lat, lon = num(d.get("lat")), num(d.get("lon"))
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        lat = lon = None
    return {"description": str(d.get("description") or "").strip()[:900], "officialName": str(d.get("official_name") or "")[:200],
            "website": web[:300], "city": str(d.get("city") or "")[:80], "country": str(d.get("country") or "").upper()[:2],
            "lat": lat, "lon": lon, "type": d.get("type") if d.get("type") in ("HES", "REC", "PRC", "PUB", "OTH") else "",
            "sources": list(dict.fromkeys([u for u in [web, *sources] if u]))[:3], "at": now, "model": model}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    with open(os.path.join(os.path.dirname(__file__), "config.yaml"), encoding="utf-8") as f:
        cfg = (yaml.safe_load(f) or {}).get("describe", {})
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY is not set")
    from store import Store
    store = Store()
    data = store.load_describe_input()
    info = data["orgInfo"]
    refresh = datetime.now(timezone.utc) - timedelta(days=int(cfg.get("refresh_days", 365)))

    def due(o):
        old = info.get(o["key"])
        if not old:
            return True
        if old.get("sameAs"):
            return False                                     # merged into another organisation by the team
        if not old.get("editedBy") and META.search(old.get("description") or ""):
            return True                                      # an earlier text about the search, not the organisation
        if not old.get("at") and not old.get("editedBy"):
            return True                                      # only a merge note, no description yet
        if old.get("editedBy"):
            return False                                     # the team's own text is kept
        try:
            return datetime.fromisoformat(old.get("at", "")) < refresh
        except ValueError:
            return True

    todo = [o for o in select(data, cfg.get("scope", "energy")) if due(o)]
    limit = args.limit or int(cfg.get("max_per_run", 300))
    log(f"Describe: {len(todo)} organisations need a description, doing {min(limit, len(todo))}")
    todo = todo[:limit]
    d = Describer(cfg)
    results, saved = {}, set()
    with ThreadPoolExecutor(max_workers=int(cfg.get("parallel_requests", 4))) as pool:
        for i, (o, r) in enumerate(zip(todo, pool.map(d.describe, todo)), 1):
            if r:
                results[o["key"]] = r
                log(f"  {'-' if r.get('notFound') else '+'} {o['name']}" + (f"  ({r['website']})" if r.get("website") else ""))
            if i % 25 == 0:
                log(f"  {i}/{len(todo)} done, {d.searches} searches")
                store.save_org_info({k: v for k, v in results.items() if k not in saved})   # a cancelled run keeps its work
                saved.update(results)
    store.save_org_info({k: v for k, v in results.items() if k not in saved})
    found = sum(1 for r in results.values() if not r.get("notFound"))
    log(f"Done: {found} described, {len(results) - found} not identified. "
        f"{d.searches} web searches, {d.tokens_in} input / {d.tokens_out} output tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
