"""EU Funding & Tenders portal (Horizon Europe, LIFE, Digital Europe, Erasmus+, CEF ...).

Public search API (SEDIA), checked on 29 Oct 2026:
- POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***
- multipart fields: query (JSON), languages (JSON), sort (JSON)
- status: 31094501 = forthcoming, 31094502 = open, 31094503 = closed
- type: 1 = call topic, 2 = tender (not collected), 8 = cascade funding / open call (FSTP)

Note: the API also returns old topics still marked "open" (e.g. from 2023) and duplicates.
They are filtered out by deadline and identifier.
"""
from __future__ import annotations

import json

from common import Call, clean_text, http_post, iso_from_any, log, TODAY

SEARCH_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***"
FACET_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/facet?apiKey=SEDIA&text=***"
STATUS = {"31094501": "forthcoming", "31094502": "open"}

# Programmes that are not collected (not relevant for UAS RDI work).
# Change in config.yaml (sources.eu.exclude_programmes).
DEFAULT_EXCLUDE = {
    "EDF", "ISF", "JUST", "EP", "PERICLES IV", "HUMA", "NDICI", "SOCPL", "EUBA",
    "IMCAP", "IMREG", "PPPA", "H2020 - 2014-2020", "COSME - 2014-2020",
}

PROGRAMME_FI = {
    "HORIZON": "Horizon Europe", "DIGITAL": "Digital Europe", "LIFE": "LIFE",
    "ERASMUS": "Erasmus+", "CEF": "Connecting Europe Facility", "I3": "Interregional Innovation Investments (I3)",
    "SMP": "Single Market Programme", "CREA": "Creative Europe", "CERV": "CERV",
    "EURATOM": "Euratom", "INNOVFUND": "Innovation Fund", "RENEWFM": "RENEWFM",
    "JTM": "Just Transition Mechanism", "ESF": "ESF+", "EMFAF": "EMFAF", "ESC": "European Solidarity Corps",
}


def _form(query: dict, sort: dict | None = None) -> dict:
    files = {
        "query": (None, json.dumps(query), "application/json"),
        "languages": (None, json.dumps(["en"]), "application/json"),
    }
    if sort:
        files["sort"] = (None, json.dumps(sort), "application/json")
    return files


def _base_query() -> dict:
    return {"bool": {"must": [
        {"terms": {"type": ["1", "8"]}},
        {"terms": {"status": list(STATUS)}},
    ]}}


def programme_names() -> dict[str, tuple[str, str]]:
    """Palauttaa {ohjelma-id: (lyhenne, koko nimi)} facet-rajapinnasta."""
    r = http_post(FACET_URL, files=_form(_base_query()))
    out = {}
    for facet in r.json().get("facets", []):
        if facet.get("name") != "frameworkProgramme":
            continue
        for v in facet.get("values", []):
            label = v.get("value", "")  # "Horizon Europe (HORIZON)"
            abbr = label.rsplit("(", 1)[-1].rstrip(") ").strip() if "(" in label else label
            out[str(v.get("rawValue"))] = (abbr, label.rsplit("(", 1)[0].strip())
    return out


def _first(meta: dict, key: str, default=""):
    v = meta.get(key) or []
    return v[0] if v else default


def parse_results(results: list, programmes: dict, exclude: set) -> list[Call]:
    today = TODAY.isoformat()
    seen, calls = set(), []
    for r in results:
        m = r.get("metadata", {})
        ident = _first(m, "identifier")
        if not ident or ident in seen:
            continue
        deadlines = sorted({iso_from_any(x) for x in m.get("deadlineDate", []) if iso_from_any(x)})
        if deadlines and not any(d >= today for d in deadlines):
            continue  # expired although the status says "open"
        fp_id = _first(m, "frameworkProgramme")
        abbr, full = programmes.get(fp_id, ("", ""))
        if abbr in exclude:
            continue
        seen.add(ident)
        typ = _first(m, "type")
        title = clean_text(_first(m, "title") or r.get("summary", ""), 400)
        desc = clean_text(_first(m, "descriptionByte") or _first(m, "description"), 4000)
        url = _first(m, "url") or r.get("url", "")
        if url.endswith(".json"):  # old topics point to JSON data
            url = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/" + ident
        call = Call(
            id=f"eu:{ident}",
            source="eu",
            title=title,
            url=url,
            funder="European Commission",
            programme=PROGRAMME_FI.get(abbr, full or abbr),
            status=STATUS.get(_first(m, "status"), "open"),
            opens=iso_from_any(_first(m, "startDate")),
            deadlines=deadlines,
            summary=clean_text(desc, 600),
            call_id=_first(m, "callIdentifier") or ident,
            action_type=clean_text(_first(m, "typesOfAction")),
            auto_tags=[t for t in m.get("tags", [])[:6] if isinstance(t, str)]
                      + (["cascade funding"] if typ == "8" else []),
            detail_text=desc,
        )
        calls.append(call)
    return calls


def collect(cfg: dict) -> list[Call]:
    exclude = set(cfg.get("exclude_programmes", DEFAULT_EXCLUDE))
    programmes = programme_names()
    results, page = [], 1
    while page <= 30:
        r = http_post(f"{SEARCH_URL}&pageSize=100&pageNumber={page}",
                      files=_form(_base_query(), {"field": "sortStatus", "order": "ASC"}))
        batch = r.json().get("results", [])
        if not batch:
            break
        results.extend(batch)
        page += 1
    calls = parse_results(results, programmes, exclude)
    log(f"EU F&T: {len(results)} raw results -> {len(calls)} current calls")
    return calls
