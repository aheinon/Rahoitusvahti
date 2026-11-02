"""EU rural development funding (CAP, maaseuturahoitus): development projects in the home region.

Applications are continuous, but the elinvoimakeskus and each Leader group decide on them after
fixed selection periods (valintajaksot). Each region has a page on maaseutu.fi listing them; for
Varsinais-Suomi (checked on 2 Nov 2026):
  https://maaseutu.fi/lounais-suomi/varsinais-suomi/rahoitus-varsinais-suomessa/valintajaksot/
Structure: section.accordion-block > button.accordion-title (span.h4 = "Hanketuet", "Leader Varsin Hyvä" ...)
and the panel it controls (aria-controls) with <p> headings followed by <ul><li>1.5.2026–30.9.2026</li></ul>.

One call per kept panel group: the next selection period end dates are its deadlines. Business aid
and farm investment panels are skipped (`include_sections`).
"""
from __future__ import annotations

import hashlib
import re

from bs4 import BeautifulSoup

from common import TODAY, Call, clean_text, http_get, log, parse_fi_date, parse_fi_range

DEFAULT_PAGES = [{"region": "Varsinais-Suomi",
                  "url": "https://maaseutu.fi/lounais-suomi/varsinais-suomi/rahoitus-varsinais-suomessa/valintajaksot/",
                  "authority": "Lounais-Suomen elinvoimakeskus"}]
DEFAULT_SECTIONS = r"^(Hanketuet|Leader\b)"
_GENERIC = re.compile(r"^(seuraavat\s+)?valintajaksot", re.I)


def _period_end(text: str) -> str | None:
    start, end = parse_fi_range(text)
    if end:
        return end
    return parse_fi_date(text)                 # "11.1.2026" = a selection period ending that day


def parse_page(html: str, page: dict, include_sections: str = DEFAULT_SECTIONS) -> list[Call]:
    soup = BeautifulSoup(html, "html.parser")
    today = TODAY.isoformat()
    sect_re = re.compile(include_sections, re.I)
    calls = []
    for btn in soup.select("button.accordion-title"):
        section = clean_text((btn.select_one(".h4") or btn).get_text(" ")).replace("arrow_drop_down", "").strip()
        panel = soup.find(id=btn.get("aria-controls", ""))
        if not panel or not sect_re.search(section):
            continue
        intro, groups, heading = [], [], ""
        root = panel.select_one(".text-wrapper") or panel
        for el in root.find_all(["p", "ul"], recursive=True):
            if el.name == "p":
                txt = clean_text(el.get_text(" "))
                if re.search(r"\d{1,2}\.\d{1,2}\.", txt) and _GENERIC.search(txt):
                    groups.append((txt.split(":")[0], [txt]))          # "Valintajaksot: 1.1.–28.2.2026 ..." in one line
                elif txt.endswith(":"):
                    heading = txt.rstrip(":")
                elif txt:
                    intro.append(txt)
            else:
                groups.append((heading, [clean_text(li.get_text(" ")) for li in el.find_all("li")]))
        leader = section.lower().startswith("leader")
        for head, items in groups:
            ends = sorted({e for t in items for e in ([_period_end(t)] if _period_end(t) else [])})
            future = [e for e in ends if e >= today]
            theme = "teemahaku" in head.lower() or "theme" in head.lower()
            if theme and not future:
                continue                                              # a past thematic call
            if leader:
                title, funder = f"{section} – maaseudun kehittämishankkeet", section
            elif theme:
                title, funder = head, page.get("authority", "")
            else:
                title, funder = f"Maaseudun kehittämishankkeet – {page.get('authority') or page['region']}", page.get("authority", "")
            area = " ".join(intro)[:400]
            key = hashlib.sha1((page["url"] + section + head).encode()).hexdigest()[:10]
            calls.append(Call(
                id=f"maaseutu:{key}",
                source="maaseutu",
                title=title,
                url=page["url"],
                funder=funder,
                programme="Rural development (CAP)",
                status="open",
                deadlines=future,
                continuous=not theme,
                deadline_text="" if future else "Rolling; next selection periods not published yet",
                region=page["region"],
                summary=clean_text(("Applications are open all the time and decided after each selection period"
                                    + (f" (next one ends {future[0]})" if future else "") + ". " + area), 600),
                auto_tags=["Leader"] if leader else ["CAP"],
                detail_text=f"{section}. {head}. Selection periods: {'; '.join(items)}. {area}",
            ))
    return calls


def collect(cfg: dict) -> list[Call]:
    calls = []
    for page in cfg.get("pages", DEFAULT_PAGES):
        calls += parse_page(http_get(page["url"]).text, page, cfg.get("include_sections", DEFAULT_SECTIONS))
    log(f"Maaseutu.fi: {len(calls)} rural development funding lines")
    return calls
