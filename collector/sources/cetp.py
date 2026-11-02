"""Clean Energy Transition Partnership (CETPartnership) joint calls.

https://cetpartnership.eu/calls/ (checked on 2 Nov 2026):
- "All calls" list: a.calls-listing__row > h3.calls-listing__title; closed calls carry a
  span.calls-listing__badge "Applications closed"
- call page (e.g. /calls/joint-call-2026/): .big-hero__intro (intro), the call calendar
  .call-calendar__item > .call-calendar__item-title / -date / -time, and the call modules
  .call-modules__grid a.card > .card__badge ("Call Module 2026-01") + .card__title
The joint call is one call with two stages (pre-proposal, then full proposal by invitation).
In Finland the national funder is Business Finland.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from common import TODAY, Call, clean_text, http_get, log, parse_fi_date, parse_time

PAGE = "https://cetpartnership.eu/calls/"


def parse_list(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.select("a.calls-listing__row"):
        title = clean_text((a.select_one(".calls-listing__title") or a).get_text(" "))
        badge = clean_text((a.select_one(".calls-listing__badge") or BeautifulSoup("", "html.parser")).get_text(" "))
        if "closed" in badge.lower():
            continue
        out.append({"title": title, "url": a.get("href", "")})
    return out


def parse_call(html: str, title: str, url: str) -> Call | None:
    soup = BeautifulSoup(html, "html.parser")
    today = TODAY.isoformat()
    events = []
    for it in soup.select(".call-calendar__item"):
        get = lambda cls: clean_text((it.select_one(cls) or BeautifulSoup("", "html.parser")).get_text(" "))  # noqa: E731
        events.append({"title": get(".call-calendar__item-title"), "date": parse_fi_date(get(".call-calendar__item-date")),
                       "time": get(".call-calendar__item-time")})
    deadlines = [e for e in events if e["date"] and re.search(r"deadline", e["title"], re.I)]
    openings = [e for e in events if e["date"] and re.search(r"opening", e["title"], re.I)]
    if deadlines and all(e["date"] < today for e in deadlines):
        return None                                   # everything has closed
    opens = openings[0]["date"] if openings else None
    upcoming = [e for e in deadlines if e["date"] >= today]
    modules = []
    for card in soup.select(".call-modules__grid a.card"):
        badge = clean_text((card.select_one(".card__badge") or card).get_text(" "))
        name = clean_text((card.select_one(".card__title") or card).get_text(" "))
        modules.append(f"{badge.replace('Call Module ', 'CM')}: {name}")
    intro = clean_text((soup.select_one(".big-hero__intro") or BeautifulSoup("", "html.parser")).get_text(" "))
    stage_note = ""
    if upcoming and re.search(r"full proposal", upcoming[0]["title"], re.I):
        stage_note = " The next deadline is for full proposals, by invitation after the pre-proposal stage."
    year = re.search(r"(20\d{2})", title)
    calendar = "; ".join(f"{e['title']}: {e['date']} {e['time']}".strip() for e in events if e["date"])
    return Call(
        id="cetp:" + (url.rstrip("/").split("/")[-1] or title.lower().replace(" ", "-")),
        source="cetp",
        title=f"CETPartnership {title}",
        url=url,
        funder="Clean Energy Transition Partnership",
        programme="CETPartnership (Business Finland in Finland)",
        status="forthcoming" if opens and opens > today else "open",
        opens=opens,
        deadlines=sorted(e["date"] for e in deadlines),
        deadline_time=_time_label(upcoming[0]["time"]) if upcoming else "",
        summary=clean_text(f"{intro} Two-stage call with {len(modules)} call modules.{stage_note}", 600),
        call_id=f"CETP JC{year.group(1)}" if year else "",
        action_type="Transnational joint call",
        auto_tags=["clean energy", "partnership call"],
        detail_text=f"{intro}\nCall calendar: {calendar}\nCall modules:\n" + "\n".join(modules),
    )


def _time_label(text: str) -> str:
    """'14:00 (CET)' -> '14:00 CET'."""
    tz = re.search(r"\(([A-Z]{3,4})\)", text or "")
    return (parse_time(text) + (" " + tz.group(1) if tz else "")).strip()


def collect(cfg: dict) -> list[Call]:
    calls = []
    for item in parse_list(http_get(PAGE).text):
        try:
            c = parse_call(http_get(item["url"]).text, item["title"], item["url"])
            if c:
                calls.append(c)
        except Exception as e:  # one page must not break the whole run
            log(f"  CETP: could not read {item['url']}: {e}")
    log(f"CETP: {len(calls)} open or upcoming joint calls")
    return calls
