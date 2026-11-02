"""Shared helpers: data model, dates, HTTP."""
from __future__ import annotations

import hashlib
import html
import re
import time
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

import requests

USER_AGENT = "Rahoitusvahti/1.0 (+https://github.com; TKI-rahoitushakujen seuranta)"
TODAY = date.today()


@dataclass
class Call:
    """One funding call in normalised form."""
    id: str                      # stable id, e.g. "eu:HORIZON-CL5-2027-02-D3-15"
    source: str                  # eu | bf | aka | eura | interreg | manual
    title: str
    url: str
    funder: str                  # e.g. "European Commission", "Business Finland"
    programme: str = ""          # e.g. "Horizon Europe", "ERDF"
    status: str = "open"         # open | forthcoming
    opens: Optional[str] = None  # YYYY-MM-DD
    deadlines: list = field(default_factory=list)  # all deadlines (YYYY-MM-DD)
    deadline_text: str = ""      # original deadline text when it cannot be parsed
    continuous: bool = False     # rolling call
    summary: str = ""            # short description (max ~600 characters)
    region: str = ""             # e.g. "Varsinais-Suomi", "national"
    call_id: str = ""            # the funder's own call identifier
    action_type: str = ""        # e.g. "HORIZON Innovation Actions"
    auto_tags: list = field(default_factory=list)
    deadline_time: str = ""      # closing time of the next deadline, e.g. "17:00 Brussels time"
    text_hash: str = ""          # optional: hash of the page text, so a changed page is assessed again
    detail_text: str = ""        # longer text for AI scoring (not stored)

    @property
    def next_deadline(self) -> Optional[str]:
        today = TODAY.isoformat()
        upcoming = sorted(d for d in self.deadlines if d >= today)
        return upcoming[0] if upcoming else None

    def content_hash(self) -> str:
        raw = "|".join([self.title, self.summary, ",".join(self.deadlines), self.status, self.opens or ""])
        if self.text_hash:
            raw += "|" + self.text_hash
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]

    def to_record(self) -> dict:
        d = asdict(self)
        d.pop("detail_text", None)
        d["deadline"] = self.next_deadline
        d["hash"] = self.content_hash()
        return d


# ---------- HTTP ----------

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fi,en;q=0.8"})


def http_get(url: str, **kw) -> requests.Response:
    for attempt in range(3):
        try:
            r = _session.get(url, timeout=30, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def http_post(url: str, **kw) -> requests.Response:
    for attempt in range(3):
        try:
            r = _session.post(url, timeout=60, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


# ---------- Text ----------

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def clean_text(s: str, limit: int = 0) -> str:
    """Removes HTML tags and extra whitespace."""
    if not s:
        return ""
    s = html.unescape(_TAG_RE.sub(" ", s))
    s = _WS_RE.sub(" ", s).strip()
    if limit and len(s) > limit:
        s = s[: limit - 1].rsplit(" ", 1)[0] + "…"
    return s


def unwrap_safelink(url: str) -> str:
    """Turns Outlook safelinks back into the original URL."""
    if url and "safelinks.protection.outlook.com" in url:
        q = parse_qs(urlparse(url).query)
        if "url" in q:
            return unquote(q["url"][0])
    return url


# ---------- Dates ----------

_FI_DATE = re.compile(r"(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})")
_FI_RANGE = re.compile(r"(\d{1,2})\.\s?(\d{1,2})\.?\s?(20\d{2})?\s*[–\-]\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})")
_EN_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}
_EN_DATE = re.compile(r"(\d{1,2})\s+(" + "|".join(_EN_MONTHS) + r")\s+(20\d{2})", re.I)


def _iso(d: int, m: int, y: int) -> Optional[str]:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def parse_fi_date(text: str) -> Optional[str]:
    """'11.11.2026 klo 23.59' -> '2026-11-11'."""
    if not text:
        return None
    m = _FI_DATE.search(text)
    if m:
        return _iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = _EN_DATE.search(text)
    if m:
        return _iso(int(m.group(1)), _EN_MONTHS[m.group(2).lower()], int(m.group(3)))
    return None


def parse_fi_range(text: str) -> tuple[Optional[str], Optional[str]]:
    """'1.9.–17.11.2026' -> ('2026-09-01', '2026-11-17')."""
    m = _FI_RANGE.search(text or "")
    if not m:
        return None, None
    y2 = int(m.group(6))
    y1 = int(m.group(3)) if m.group(3) else y2
    start = _iso(int(m.group(1)), int(m.group(2)), y1)
    end = _iso(int(m.group(4)), int(m.group(5)), y2)
    if start and end and start > end and not m.group(3):
        start = _iso(int(m.group(1)), int(m.group(2)), y2 - 1)
    return start, end


def iso_from_any(s: str) -> Optional[str]:
    """'2026-11-05T00:00:00.000+0000' -> '2026-11-05'."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:10]).date().isoformat()
    except ValueError:
        return None


_TIME = re.compile(r"(?:\bklo\.?\s*|\bat\s*)(\d{1,2})[:.](\d{2})\b|\b(\d{1,2}):(\d{2})\b")


def parse_time(text: str) -> str:
    """'... klo 16.15' / '14:00 (CEST)' -> '16:15'. Dates such as 22.10.2026 are not times."""
    m = _TIME.search(text or "")
    if not m:
        return ""
    h, mi = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    return f"{int(h):02d}:{mi}" if int(h) < 24 else ""


def page_text(html_doc: str, limit: int = 6000) -> str:
    """Readable text of a web page: main content without menus, scripts and footers."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html_doc, "html.parser")
    for t in soup(["script", "style", "noscript", "nav", "header", "footer", "form", "svg"]):
        t.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup
    return clean_text(root.get_text(" "))[:limit]


def short_hash(s: str) -> str:
    return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:12]


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)
