"""Research Council of Finland (Suomen Akatemia) calls.

Page https://www.aka.fi/tutkimusrahoitus/hae-rahoitusta/haut/ (checked on 29 Oct 2026):
- each open/upcoming call is a .application-box: h3 > a, .app-start, .app-end
- h2.application-title gives the group (Tutkijalle, Tutkimusryhmille, Kansainväliset haut ...)
- after the "Valmistelussa olevat haut" heading, a list of planned calls without dates
"""
from __future__ import annotations

import hashlib

from bs4 import BeautifulSoup

from common import TODAY, Call, clean_text, http_get, log, parse_fi_date, unwrap_safelink

BASE = "https://www.aka.fi"
GROUP_EN = {"Tutkijalle": "For researchers", "Tutkimusryhmille": "For research teams",
            "Strategisen tutkimuksen rahoitus": "Strategic research", "Kansainväliset haut": "International calls",
            "Valmistelussa": "In preparation"}
PAGE = BASE + "/tutkimusrahoitus/hae-rahoitusta/haut/"


def parse_page(html: str) -> list[Call]:
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup
    calls: list[Call] = []
    group = ""
    today = TODAY.isoformat()

    for el in main.find_all(["h2", "div"]):
        if el.name == "h2":
            group = clean_text(el.get_text(" "))
            continue
        if "application-box" not in (el.get("class") or []):
            continue
        a = el.select_one("h3 a")
        if not a:
            continue
        start_el, end_el = el.select_one(".app-start"), el.select_one(".app-end")
        start_txt = clean_text(start_el.get_text(" ")).replace("Haku alkaa", "").strip() if start_el else ""
        end_txt = clean_text(end_el.get_text(" ")).replace("Haku päättyy", "").strip() if end_el else ""
        opens, deadline = parse_fi_date(start_txt), parse_fi_date(end_txt)
        href = a.get("href", "")
        url = href if href.startswith("http") else BASE + href
        calls.append(Call(
            id="aka:" + href.rstrip("/").split("/")[-1],
            source="aka",
            title=clean_text(a.get_text(" ")),
            url=url,
            funder="Research Council of Finland",
            programme=GROUP_EN.get(group, group),
            status="forthcoming" if opens and opens > today else "open",
            opens=opens,
            deadlines=[deadline] if deadline else [],
            deadline_text="" if deadline else end_txt,
            auto_tags=[GROUP_EN.get(group, group)] if group else [],
        ))

    # Calls in preparation (no dates)
    prep_h2 = next((h for h in main.find_all("h2") if "Valmistelussa" in h.get_text()), None)
    if prep_h2:
        for sib in prep_h2.find_all_next():
            if sib.name == "h2":
                break
            if sib.name != "li":
                continue
            text = clean_text(sib.get_text(" "))
            if not text:
                continue
            a = sib.find("a")
            link = unwrap_safelink(a["href"]) if a and a.get("href") else PAGE
            if link.startswith("/"):
                link = BASE + link
            title = text.split(",")[0].strip()
            calls.append(Call(
                id="aka:prep-" + hashlib.sha1(title.encode()).hexdigest()[:10],
                source="aka",
                title=title,
                url=link,
                funder="Research Council of Finland",
                programme="In preparation",
                status="forthcoming",
                deadline_text=text,
                summary=text,
                auto_tags=["in preparation"],
            ))
    return calls


def parse_detail(html: str) -> str:
    """Main text of a call page (main article)."""
    soup = BeautifulSoup(html, "html.parser")
    art = soup.select_one("main article") or soup.find("main")
    return clean_text(art.get_text(" ") if art else "")[:6000]


def collect(cfg: dict) -> list[Call]:
    calls = parse_page(http_get(PAGE).text)
    for c in calls:
        if not c.url.startswith(BASE) or c.programme == "In preparation":
            continue
        try:
            c.detail_text = parse_detail(http_get(c.url).text)
        except Exception as e:  # one page must not break the whole run
            log(f"  RCF: could not read call page ({c.url}): {e}")
    log(f"Research Council of Finland: {len(calls)} calls")
    return calls
