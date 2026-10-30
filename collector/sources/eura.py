"""ERDF / ESF+ / JTF calls from the EURA 2021 system.

https://eura2021.fi/hakuilmoitukset/ (checked on 29 Oct 2026):
- the page embeds every call notice in <script type="__PREACT_CLI_DATA__">
  (URL-encoded JSON): preRenderData.hankehaku = [...], preRenderData.koodisto
- a notice: id, tila (haettavissa | julkaistu | paattynyt), hakuaika{alku,loppu}, otsikko,
  rahasto (EAKR/ESR+/JTF), eakrTyyppi (YLEINEN | YRTU = business aid), viranomainen, alue, maakunnat[]
"""
from __future__ import annotations

import json
from urllib.parse import unquote

from bs4 import BeautifulSoup

from common import Call, clean_text, http_get, log

PAGE = "https://eura2021.fi/hakuilmoitukset/"
DETAIL = "https://eura2021.fi/hakuilmoitukset/hakuilmoitus/{id}/"
STATUS = {"haettavissa": "open", "julkaistu": "forthcoming"}
FUND_EN = {"EAKR": "ERDF", "ESR+": "ESF+", "JTF": "JTF"}
ALUE_FI = {"ETELA_SUOMI": "Etelä-Suomi", "LANSI_SUOMI": "Länsi-Suomi", "ITA_SUOMI": "Itä-Suomi",
           "POHJOIS_SUOMI": "Pohjois-Suomi", "VALTAKUNNALLINEN": "national"}


def extract_data(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("script", attrs={"type": "__PREACT_CLI_DATA__"})
    if not tag:
        raise ValueError("EURA: __PREACT_CLI_DATA__ missing - the page structure has changed")
    return json.loads(unquote(tag.string or tag.get_text()))["preRenderData"]


def parse(data: dict, include_business_aid: bool = False) -> list[Call]:
    kood = data.get("koodisto", {})
    vir = kood.get("viranomainen", {})
    maak = kood.get("maakunta", {})
    calls = []
    for x in data.get("hankehaku", []):
        if x.get("tila") not in STATUS:
            continue
        if x.get("eakrTyyppi") == "YRTU" and not include_business_aid:
            continue
        title = clean_text(x.get("otsikko", "")).split(" / ")[0]  # Finnish part
        aika = x.get("hakuaika") or {}
        m_names = [(maak.get(c) or {}).get("fi", c) for c in x.get("maakunnat", [])]
        m_names = [n for n in m_names if n and not str(n).startswith("ylimaakunnallinen")]
        alue = ALUE_FI.get(x.get("alue", ""), x.get("alue", ""))
        fund = FUND_EN.get(x.get("rahasto", ""), x.get("rahasto", ""))
        authority = (vir.get(x.get("viranomainen", "")) or {}).get("fi", "")
        calls.append(Call(
            id=f"eura:{x['id']}",
            source="eura",
            title=title,
            url=DETAIL.format(id=x["id"]),
            funder=authority or "EU regional funds (Finland)",
            programme=fund,
            status=STATUS[x["tila"]],
            opens=aika.get("alku"),
            deadlines=[aika["loppu"]] if aika.get("loppu") else [],
            region=", ".join(m_names) if m_names else alue,
            call_id=x.get("hakutunnus", ""),
            auto_tags=[fund] + ([alue] if alue else []),
            summary=f"{fund} call by {authority}, area: {alue}." if authority else f"{fund} call, area: {alue}.",
        ))
    return calls


def parse_detail(html: str) -> dict:
    """Description, budget and rolling-call flag from a call notice page (preRenderData.ilmoitus)."""
    n = extract_data(html).get("ilmoitus") or {}
    text = " ".join(clean_text(n.get(k) or "") for k in ("kuvaus", "kokonaistuki"))
    return {"text": text.strip()[:6000], "continuous": bool(n.get("jatkuvaHaku"))}


def collect(cfg: dict) -> list[Call]:
    data = extract_data(http_get(PAGE).text)
    calls = parse(data, include_business_aid=cfg.get("include_business_aid", False))
    for c in calls:
        try:
            info = parse_detail(http_get(c.url).text)
            c.detail_text = info["text"]
            c.continuous = info["continuous"]
        except Exception as e:  # one page must not break the whole run
            log(f"  EURA: could not read call page ({c.url}): {e}")
    log(f"EURA: {len(data.get('hankehaku', []))} notices -> {len(calls)} open/upcoming")
    return calls
