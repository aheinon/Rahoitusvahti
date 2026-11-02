"""Private foundations (säätiöt).

Foundations publish their calls as ordinary web pages with no common format, so this source reads
each page listed in config.yaml (`sources.saatiot.foundations`) and lets Claude pick out the
current or next application period, who can apply and what is funded (the normal AI assessment
fills in the deadline and opening date). The page text is hashed, so Claude reads a page again
only when it changes. A page that cannot be read is skipped with a warning.

Without an API key the foundations still show, but without dates ("see the foundation's page").
"""
from __future__ import annotations

import re

from common import Call, http_get, log, page_text, short_hash

DEFAULT_FOUNDATIONS = [
    {"name": "Maj ja Tor Nesslingin säätiö", "url": "https://nessling.fi/en/open-calls/",
     "note": "Environmental research; personal grants and implementation project grants"},
    {"name": "Suomen Kulttuurirahasto, Varsinais-Suomen rahasto",
     "url": "https://www.skr.fi/en/regional-funds/varsinais-suomi-regional-fund/varsinais-suomi-grants",
     "note": "Regional fund: science, art and culture in Varsinais-Suomi; individuals and working groups"},
]


def to_call(f: dict, text: str) -> Call:
    slug = re.sub(r"[^a-z0-9]+", "-", f["name"].lower()).strip("-")[:50]
    return Call(
        id=f"saatio:{slug}",
        source="saatiot",
        title=f.get("title") or f"{f['name']}: grants",
        url=f["url"],
        funder=f["name"],
        programme="Foundation",
        status="open",
        deadline_text="See the foundation's page",
        summary=f.get("note", ""),
        auto_tags=["foundation"],
        text_hash=short_hash(text),
        detail_text=(f"Foundation: {f['name']}. {f.get('note', '')}\nPage text:\n{text}")[:6000],
    )


def collect(cfg: dict) -> list[Call]:
    calls = []
    for f in cfg.get("foundations", DEFAULT_FOUNDATIONS):
        try:
            calls.append(to_call(f, page_text(http_get(f["url"]).text)))
        except Exception as e:  # one foundation must not break the others
            log(f"  Foundations: could not read {f['url']}: {e}")
    log(f"Foundations: {len(calls)} pages read")
    return calls
