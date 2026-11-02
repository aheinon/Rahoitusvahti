"""Finnish state grants from Haeavustuksia.fi (the State Treasury's grant service).

Ministries (YM, TEM, MMM, OKM ...), Jotpa, the regional elinvoimakeskus centres, regional councils
and many agencies publish their calls there. The site's own search uses (checked on 2 Nov 2026):

  GET https://www.haeavustuksia.fi/api/haku/list-items?Pagination.Page=1&Pagination.PageSize=20
      &Language=fi&SearchTerm=&VaOrgLyhenne=&ShowFuture=true&ShowOngoing=true&ShowEnded=false&HideExternal=false
  -> {totalCount, pageCount, hakuilmoitukset: [{hakuasianAsianumero, nimi{fi,sv,en}, kuvaus{fi,sv,en},
      hakuAlkaaDateTimeUtc, hakuPaattyyDateTimeUtc, hakuTyyppi (Jatkuva | Maaraaikainen), julkaisuTyyppi,
      vastuullinenJarjestajaOrganisaatio{nimi{...}, lyhenne}}]}
  Call page: https://www.haeavustuksia.fi/fi/haku/<hakuasianAsianumero>

Most of the ~280 notices are for associations, municipalities, companies or farms, so this source
drops organisations and titles listed in config.yaml, and Claude's eligibility check hides the rest
that a university of applied sciences cannot apply for.
"""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from common import TODAY, Call, clean_text, http_get, log

API = ("https://www.haeavustuksia.fi/api/haku/list-items?Pagination.Page={page}&Pagination.PageSize={size}"
       "&Language=fi&SearchTerm=&VaOrgLyhenne=&ShowFuture=true&ShowOngoing=true&ShowEnded=false&HideExternal=false")
CALL_URL = "https://www.haeavustuksia.fi/fi/haku/{id}"
HKI = ZoneInfo("Europe/Helsinki")

# Organisations already covered by their own source, or that fund nothing a UAS can apply for
DEFAULT_EXCLUDE_ORGS = ["BF", "SA", "OPH", "SES", "KUVI", "MV", "STEA", "THL", "PLM", "KELA", "VK", "KA",
                        "RVL", "PSR", "VARKE", "ARA", "STM", "OM", "UM"]
DEFAULT_EXCLUDE_TITLES = (r"yksityisti?e|yksityistei|enskild|EMKVR|kalast|kalatalou|vesiviljel|porotalou|kolt|rakennetuista|"
                          r"maaseudun (hanke|yritys)tuet|yrityksen kehittämisavustu|yritysten kehittämisavustu|"
                          r"ravirado|liikun|urheil|museo|kirjasto|nuoriso|turvakoti|romutus|hissi|asunto|"
                          r"puolustusteollisuu|elokuva|taiteen|kulttuurin|rakennusperinnö|rauhoitettujen eläinten|"
                          r"saariston|järjestöille|riistanhoito|väliraportti")


def _local(utc: str | None) -> datetime | None:
    if not utc:
        return None
    return datetime.fromisoformat(utc.replace("Z", "+00:00")).astimezone(HKI)


def parse_items(items: list[dict], exclude_orgs: set, exclude_titles: str) -> list[Call]:
    today = TODAY.isoformat()
    title_re = re.compile(exclude_titles, re.I) if exclude_titles else None
    calls = []
    for x in items:
        org = x.get("vastuullinenJarjestajaOrganisaatio") or {}
        abbr = (org.get("lyhenne") or "").upper()
        name = x.get("nimi") or {}
        title = clean_text(name.get("fi") or name.get("en") or "")
        if not title or abbr in exclude_orgs or (title_re and title_re.search(title)):
            continue
        start, end = _local(x.get("hakuAlkaaDateTimeUtc")), _local(x.get("hakuPaattyyDateTimeUtc"))
        opens = start.date().isoformat() if start else None
        deadline = end.date().isoformat() if end else None
        if deadline and deadline < today:
            continue
        # Continuous calls carry a far-off end date (e.g. 2030 or 2036); show them as rolling
        rolling = x.get("hakuTyyppi") == "Jatkuva" or not deadline or deadline > f"{TODAY.year + 2}-12-31"
        org_names = org.get("nimi") or {}
        funder = clean_text(org_names.get("en") or org_names.get("fi") or abbr)
        desc = x.get("kuvaus") or {}
        text = clean_text(desc.get("fi") or desc.get("en") or "")
        jotpa = abbr == "JOTPA" or "jatkuvan oppimisen ja työllisyyden palvelukeskus" in title.lower()
        if jotpa:
            title = re.sub(r"^Jatkuvan oppimisen ja työllisyyden palvelukeskus\s*-\s*", "", title)
        calls.append(Call(
            id="va:" + x.get("hakuasianAsianumero", title),
            source="va",
            title=title,
            url=CALL_URL.format(id=x.get("hakuasianAsianumero", "")),
            funder="Jotpa (Service Centre for Continuous Learning and Employment)" if jotpa else funder,
            programme="Jotpa" if jotpa else "State grant",
            status="forthcoming" if opens and opens > today else "open",
            opens=opens,
            deadlines=[] if rolling else [deadline],
            deadline_time="" if rolling or not end else end.strftime("%H:%M") + " Finnish time",
            continuous=rolling,
            summary=clean_text(text, 600),
            call_id=x.get("hakuasianAsianumero", ""),
            auto_tags=[abbr] if abbr else [],
            detail_text=f"Funder: {funder}\n{text}"[:6000],
        ))
    return calls


def collect(cfg: dict) -> list[Call]:
    exclude_orgs = {s.upper() for s in cfg.get("exclude_organisations", DEFAULT_EXCLUDE_ORGS)}
    exclude_titles = cfg.get("exclude_titles", DEFAULT_EXCLUDE_TITLES)
    items, page, pages = [], 1, 1
    while page <= pages and page <= 40:
        data = http_get(API.format(page=page, size=50), headers={"Accept": "application/json"}).json()
        items += data.get("hakuilmoitukset") or []
        pages = int(data.get("pageCount") or 1)
        page += 1
    calls = parse_items(items, exclude_orgs, exclude_titles)
    log(f"Haeavustuksia.fi: {len(items)} notices -> {len(calls)} kept")
    return calls
