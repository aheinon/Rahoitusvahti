"""Interreg calls from the interreg.eu overview page.

https://interreg.eu/calls-for-projects/ lists the open and upcoming calls of every Interreg
programme (source keep.eu). The page is rendered with JavaScript, so it is read with a headless
browser (Playwright), the same way a person sees it. Structure (checked on 29 Oct 2026):
- card: [data-calls-result] > h3 (title), "DEADLINE FOR APPLICATION", "PROGRAMME",
  hidden details ("ELIGBLE COUNTRIES", "THEMES") and a "VIEW CALL" link
- tabs "Open calls (n)" and "Coming calls (n)"

If Playwright is missing, the source is skipped with a warning.
"""
from __future__ import annotations

import hashlib
import re

from common import Call, clean_text, log, parse_fi_date

PAGE = "https://interreg.eu/calls-for-projects/"

_JS_EXTRACT = """
() => [...document.querySelectorAll('[data-calls-result]')].map(c => {
  const labels = {};
  c.querySelectorAll('span').forEach(s => {
    const t = s.textContent.trim();
    if (/^[A-Z ]{6,}$/.test(t) && s.nextElementSibling) labels[t] = s.nextElementSibling.textContent.trim();
  });
  const a = [...c.querySelectorAll('a[href]')].find(x => /view call/i.test(x.textContent));
  return {
    title: (c.querySelector('h3') || {}).textContent || '',
    deadline: labels['DEADLINE FOR APPLICATION'] || '',
    programme: labels['PROGRAMME'] || '',
    countries: labels['ELIGBLE COUNTRIES'] || labels['ELIGIBLE COUNTRIES'] || '',
    themes: [...c.querySelectorAll('.theme')].map(t => t.textContent.trim()),
    url: a ? a.href : ''
  };
})
"""


def _to_call(raw: dict, status: str) -> Call:
    title = clean_text(raw.get("title", ""))
    # "2021 - 2027 Interreg VI-B EURO Mediterranean (EURO MED)Call 8 Thematic projects" -> shorter
    title = re.sub(r"^2021 - 2027 Interreg [IVX]+-[A-D] [^)]*\)\s*", "", title) or title
    url = raw.get("url") or PAGE
    key = hashlib.sha1((raw.get("programme", "") + "|" + title).encode()).hexdigest()[:12]
    countries = raw.get("countries", "")
    deadline = parse_fi_date(raw.get("deadline", ""))
    return Call(
        id=f"interreg:{key}",
        source="interreg",
        title=title,
        url=url,
        funder="Interreg",
        programme=clean_text(raw.get("programme", "")),
        status=status,
        deadlines=[deadline] if deadline else [],
        region=countries,
        auto_tags=list(raw.get("themes", [])) + (["Finland eligible"] if "Finland" in countries else []),
        summary=f"Eligible countries: {countries}" if countries else "",
    )


def collect(cfg: dict) -> list[Call]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("Interreg: Playwright not installed – skipping")
        return []
    calls: list[Call] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0 Rahoitusvahti/1.0")
        page.goto(PAGE, wait_until="networkidle", timeout=60000)
        page.wait_for_selector("[data-calls-result]", timeout=30000)
        calls += [_to_call(r, "open") for r in page.evaluate(_JS_EXTRACT)]
        tab = page.locator("button", has_text=re.compile(r"Coming calls", re.I))
        if tab.count():
            tab.first.click()
            page.wait_for_timeout(2500)
            open_ids = {c.id for c in calls}
            calls += [c for c in (_to_call(r, "forthcoming") for r in page.evaluate(_JS_EXTRACT))
                      if c.id not in open_ids]
        browser.close()
    if cfg.get("finland_only"):
        calls = [c for c in calls if "Finland eligible" in c.auto_tags]
    log(f"Interreg: {len(calls)} calls")
    return calls
