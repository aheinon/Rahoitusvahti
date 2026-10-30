"""Business Finland funding calls.

The site's own search block returns an HTML fragment (checked on 29 Oct 2026):
  GET https://www.businessfinland.fi/api/v1/funding/results
      ?sort=Relevancy&id=<block-id>&language=fi&status=open&status=future&p=<page>
- <block-id> is read from the form on /palvelut/rahoitus/ (form-funding-search-filters-<id>)
- each call is an <li> with h3 > a (title + link), .typography-t2 (description), dd (status)
- the deadline is only on the call page (e.g. "Voimassaoloaika 1.9.-17.11.2026")
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from common import Call, clean_text, http_get, log, parse_fi_date, parse_fi_range

BASE = "https://www.businessfinland.fi"
LIST_PAGE = BASE + "/palvelut/rahoitus/"
RESULTS = BASE + "/api/v1/funding/results"
FALLBACK_BLOCK_ID = "33919"

_DEADLINE_PATTERNS = [
    re.compile(r"(?:hakemukset|aiehakemukset)[^.]{0,120}?(\d{1,2}\.\s?\d{1,2}\.\s?20\d\d)\s*mennessä", re.I),
    re.compile(r"(?:haku|hakuaika)\s+(?:päättyy|sulkeutuu)[^0-9]{0,30}(\d{1,2}\.\s?\d{1,2}\.\s?20\d\d)", re.I),
    re.compile(r"(\d{1,2}\.\s?\d{1,2}\.\s?20\d\d)\s*(?:klo [\d.:]+\s*)?mennessä", re.I),
]


def block_id() -> str:
    html = http_get(LIST_PAGE).text
    m = re.search(r"form-funding-search-filters-(\d+)", html)
    return m.group(1) if m else FALLBACK_BLOCK_ID


def parse_list(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for li in soup.find_all("li"):
        a = li.select_one("h3 a")
        if not a or not a.get("href"):
            continue
        desc = li.select_one(".typography-t2")
        dd = li.find("dd")
        out.append({
            "href": a["href"],
            "title": clean_text(a.get_text(" ")),
            "summary": clean_text(desc.get_text(" ") if desc else "", 600),
            "status_text": clean_text(dd.get_text(" ") if dd else ""),
        })
    return out


def parse_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup.body or soup
    text = clean_text(main.get_text(" "))
    info: dict = {"text": text[:6000]}
    m = re.search(r"Voimassaoloaika\s*([^A-ZÄÖÅ]{0,40})", text)
    if m:
        start, end = parse_fi_range(m.group(1))
        info["opens"], info["deadline"] = start, end
        if not end:
            info["deadline"] = parse_fi_date(m.group(1))
    if not info.get("deadline"):
        for pat in _DEADLINE_PATTERNS:
            mm = pat.search(text)
            if mm:
                info["deadline"] = parse_fi_date(mm.group(1))
                break
    info["continuous"] = bool(re.search(r"jatkuva haku|haku on jatkuva|jatkuvasti haettavissa", text, re.I))
    return info


def collect(cfg: dict) -> list[Call]:
    bid = block_id()
    items, seen = [], set()
    for page in range(1, 15):
        html = http_get(RESULTS, params=[("sort", "Relevancy"), ("id", bid), ("language", "fi"),
                                         ("status", "open"), ("status", "future"), ("p", page)]).text
        new = [it for it in parse_list(html) if it["href"] not in seen]
        if not new:
            break
        for it in new:
            seen.add(it["href"])
        items.extend(new)

    calls = []
    for it in items:
        url = it["href"] if it["href"].startswith("http") else BASE + it["href"]
        slug = it["href"].rstrip("/").split("/")[-1]
        try:
            info = parse_detail(http_get(url).text)
        except Exception as e:  # one page must not break the whole run
            log(f"  BF: could not read call page ({url}): {e}")
            info = {}
        status = "forthcoming" if "tuleva" in it["status_text"].lower() else "open"
        dl = info.get("deadline")
        calls.append(Call(
            id=f"bf:{slug}",
            source="bf",
            title=it["title"],
            url=url,
            funder="Business Finland",
            programme="Business Finland",
            status=status,
            opens=info.get("opens"),
            deadlines=[dl] if dl else [],
            continuous=info.get("continuous", False) and not dl,
            summary=it["summary"],
            detail_text=info.get("text", ""),
        ))
    log(f"BF: {len(calls)} calls")
    return calls
