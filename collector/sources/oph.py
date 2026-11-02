"""Finnish National Agency for Education (EDUFI / Opetushallitus): Erasmus+ and other grants.

https://www.oph.fi/fi/rahoitushaut (checked on 2 Nov 2026) lists every EDUFI call, newest first,
20 per page (?page=0, 1, ...). This covers the decentralised Erasmus+ actions handled in Finland
(e.g. KA220-HED/VET cooperation partnerships, KA210 small-scale partnerships), which the EU
Funding & Tenders portal does not list. A listing item:
  div.listing-item > .listing-item-bundle ("Kansainvälistymisrahoitus" | "Valtionavustus")
    h3.listing-title > a[href=/fi/funding/...]
    .listing-item-tags span.tag (programmes, level of education, theme)
    .field-funding-state ("Tulossa" | "Haettavissa" | "Arvioitavana" | "Ratkaistu")
    .field_application_period ("22.10.2026 – 20.1.2027 klo 18:00")
Only calls tagged with a level or programme in `include_tags` (and none in `exclude_tags`) are kept.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from common import TODAY, Call, clean_text, http_get, log, page_text, parse_fi_range, parse_time

BASE = "https://www.oph.fi"
LIST = BASE + "/fi/rahoitushaut?page={page}"
STATUS = {"tulossa": "forthcoming", "haettavissa": "open"}
DEFAULT_INCLUDE = ["Erasmus+", "Korkeakoulutus", "Ammatillinen koulutus", "Aikuiskoulutus", "Jatkuva oppiminen",
                   "Kansainvälistyminen"]
DEFAULT_EXCLUDE = ["Luova Eurooppa", "Euroopan solidaarisuusjoukot", "EU:n nuoriso-ohjelmat", "Erasmus+ nuorisoalalle",
                   "Nuorisotyö", "Perusopetus", "Varhaiskasvatus", "Kulttuuri", "Urheilu"]


def parse_list(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for it in soup.select("div.listing-item"):
        a = it.select_one("h3.listing-title a, .listing-title a")
        if not a:
            continue
        state = clean_text((it.select_one(".field-funding-state") or it).get_text(" ")) if it.select_one(".field-funding-state") else ""
        period_el = it.select_one(".field_application_period")
        out.append({
            "title": clean_text(a.get_text(" ")),
            "href": a.get("href", ""),
            "kind": clean_text(it.select_one(".listing-item-bundle").get_text(" ")) if it.select_one(".listing-item-bundle") else "",
            "tags": [clean_text(t.get_text(" ")) for t in it.select(".listing-item-tags span.tag")],
            "state": state,
            "period": clean_text(period_el.get_text(" ")) if period_el else "",
        })
    return out


def keep(item: dict, include: list, exclude: list) -> bool:
    if item["state"].lower() not in STATUS:
        return False
    tags = set(item["tags"])
    if tags & set(exclude):
        return False
    return bool(tags & set(include)) or "erasmus" in item["title"].lower()


def to_call(item: dict) -> Call:
    opens, deadline = parse_fi_range(item["period"])
    erasmus = "Erasmus+" in item["tags"] or "erasmus" in item["title"].lower()
    href = item["href"]
    t = parse_time(item["period"])
    return Call(
        id="oph:" + href.rstrip("/").split("/")[-1],
        source="oph",
        title=item["title"],
        url=href if href.startswith("http") else BASE + href,
        funder="Finnish National Agency for Education (EDUFI)",
        programme="Erasmus+" if erasmus else ("EDUFI international" if "kansainvälistymis" in item["kind"].lower() else "EDUFI grant"),
        status=STATUS[item["state"].lower()],
        opens=opens,
        deadlines=[deadline] if deadline else [],
        deadline_text="" if deadline else item["period"],
        deadline_time=f"{t} Finnish time" if t else "",
        region="national",
        auto_tags=[x for x in item["tags"] if x][:5],
    )


def collect(cfg: dict) -> list[Call]:
    include = cfg.get("include_tags", DEFAULT_INCLUDE)
    exclude = cfg.get("exclude_tags", DEFAULT_EXCLUDE)
    calls, seen = [], set()
    today = TODAY.isoformat()
    for page in range(int(cfg.get("max_pages", 8))):
        items = parse_list(http_get(LIST.format(page=page)).text)
        if not items:
            break
        for it in items:
            if keep(it, include, exclude) and it["href"] not in seen:
                seen.add(it["href"])
                c = to_call(it)
                if not c.deadlines or c.deadlines[0] >= today:
                    calls.append(c)
    for c in calls:
        try:
            c.detail_text = page_text(http_get(c.url).text)
        except Exception as e:  # one page must not break the whole run
            log(f"  EDUFI: could not read call page ({c.url}): {e}")
    log(f"EDUFI: {len(calls)} open or upcoming calls kept")
    return calls
