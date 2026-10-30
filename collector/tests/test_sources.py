"""Parser tests. The samples mirror the page structures checked on 29 Oct 2026."""
import json
import os
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from common import parse_fi_date, parse_fi_range, unwrap_safelink  # noqa: E402
from scoring import AiScorer, keyword_score  # noqa: E402
from sources import akatemia, business_finland, eu_ft, eura, interreg  # noqa: E402
import main  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
PROFILE = {"keywords": {"solar": 3, "photovolta": 3, "battery": 3, "energy": 1}, "negative": {"defence": -3}}


def _eu_result(ident, title, fp="43108390", status="31094502", deadlines=("2027-03-31T00:00:00.000+0000",),
               typ="1", url=None):
    return {"summary": title, "url": "https://example/x", "metadata": {
        "identifier": [ident], "title": [title], "frameworkProgramme": [fp], "status": [status],
        "deadlineDate": list(deadlines), "startDate": ["2026-12-03T00:00:00.000+0000"], "type": [typ],
        "callIdentifier": [ident.rsplit("-", 2)[0]], "typesOfAction": ["HORIZON Innovation Actions"],
        "descriptionByte": ["<p>Expected outcome: <strong>solar</strong> PV production</p>"],
        "url": [url or f"https://ec.europa.eu/.../topic-details/{ident}"], "tags": ["photovoltaics"]}}


def test_dates():
    assert parse_fi_date("11.11.2026 klo 23.59 Suomen aikaa") == "2026-11-11"
    assert parse_fi_date("13 November 2026") == "2026-11-13"
    assert parse_fi_range("1.9.–17.11.2026") == ("2026-09-01", "2026-11-17")
    assert parse_fi_range("1.12.–15.1.2027") == ("2026-12-01", "2027-01-15")
    assert parse_fi_date("Marraskuun loppu (1. vaihe)") is None


def test_safelink():
    u = "https://eur10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.brainhealth-partnership.eu%2F&data=x"
    assert unwrap_safelink(u) == "https://www.brainhealth-partnership.eu/"


def test_eu_parse_filters_stale_duplicates_and_excluded():
    progs = {"43108390": ("HORIZON", "Horizon Europe"), "44181033": ("EDF", "European Defence Fund")}
    results = [
        _eu_result("HORIZON-CL5-2027-02-D3-15", "Production technologies for solar photovoltaics", status="31094501"),
        _eu_result("HORIZON-CL5-2027-02-D3-15", "duplikaatti"),
        _eu_result("HORIZON-CL5-2023-D3-02-12", "Large Area Perovskite solar cells",
                   deadlines=("2023-09-05T00:00:00.000+0000",),
                   url="https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/X.json"),
        _eu_result("EDF-2026-X", "Defence thing", fp="44181033"),
        _eu_result("HORIZON-CL4-2025-03-DATA-11", "Open Internet Stack", typ="8",
                   deadlines=("2026-11-03T00:00:00.000+0000",)),
    ]
    calls = eu_ft.parse_results(results, progs, {"EDF"})
    ids = [c.id for c in calls]
    assert ids == ["eu:HORIZON-CL5-2027-02-D3-15", "eu:HORIZON-CL4-2025-03-DATA-11"]
    first = calls[0]
    assert first.status == "forthcoming"
    assert first.programme == "Horizon Europe"
    assert first.deadlines == ["2027-03-31"]
    assert first.opens == "2026-12-03"
    assert "solar" in first.summary
    assert "cascade funding" in calls[1].auto_tags


BF_LIST = """
<h2 class="sr-only">Hakutulokset</h2><ul>
<li class="x"><div><h3 class="headline-h3"><a href="/palvelut/rahoitus/haut/2026/dut-rahoitushaku-2026/"><span>Driving Urban Transitions (DUT) partnership -rahoitushaku 2026</span></a></h3>
<div class="typography-t2 mb-md"><p>Haussa etsit&auml;&auml;n innovatiivisia projekteja.</p></div></div>
<div><dl><dt class="sr-only">Status</dt><dd class="headline-h6">Haku on auki <span></span></dd></dl></div></li>
<li class="x"><div><h3><a href="/palvelut/rahoitus/haut/2026/future-food/"><span>FutureFoodS 2026</span></a></h3>
<div class="typography-t2"><p>Ennakkoilmoitus.</p></div></div><dl><dd>Tuleva haku</dd></dl></li>
</ul><ul class="pagination"><li><a data-page="2" href="#">2</a></li></ul>
"""


def test_bf_list():
    items = business_finland.parse_list(BF_LIST)
    assert [i["title"] for i in items] == ["Driving Urban Transitions (DUT) partnership -rahoitushaku 2026", "FutureFoodS 2026"]
    assert items[0]["status_text"].startswith("Haku on auki")
    assert items[1]["status_text"] == "Tuleva haku"
    assert items[0]["summary"] == "Haussa etsitään innovatiivisia projekteja."


def test_bf_detail():
    html = """<main><h1>DUT</h1> Päivitetty 29.6.2026 Käynnissä Infotilaisuudet ...
    Voimassaoloaika 1.9.–17.11.2026 Lisätietoja dut (at) businessfinland.fi
    Aiehakemukset tulee jättää DUT:n hakuportaaliin 17.11.2026 mennessä.</main>"""
    info = business_finland.parse_detail(html)
    assert info["opens"] == "2026-09-01" and info["deadline"] == "2026-11-17"
    info2 = business_finland.parse_detail("<main>Haku on jatkuva. Hakemukset jätetään asiointipalvelussa.</main>")
    assert info2.get("deadline") is None and info2["continuous"]


AKA_HTML = """<main><article><h1>Haut</h1><h2><strong>Avoimet ja tulossa olevat haut</strong></h2>
<div class="row"><div class="col-md-12"><h2 class="application-title">Tutkimusryhmille</h2></div></div>
<div class="row"><div class="col-md-12"><div class="application-box">
 <h3><a href="/tutkimusrahoitus/hae-rahoitusta/haut/tutkimusryhmille/2027-akatemiahankkeet-kaikki-tutkimusalat/">2027 Akatemiahankkeet, kaikki tutkimusalat</a></h3>
 <div class="app-start"><strong>Haku alkaa</strong> 14.10.2026</div>
 <div class="app-end noicon"><strong>Haku päättyy</strong> 11.11.2026 klo 23.59 Suomen aikaa</div></div></div>
 <div class="col-md-12"><div class="application-box">
 <h3><a href="/tutkimusrahoitus/hae-rahoitusta/haut/kv-haut/novel-ecosystems/">Novel ecosystems</a></h3>
 <div class="app-start"><strong>Haku alkaa</strong> 9.9.</div>
 <div class="app-end"><strong>Haku päättyy</strong> Marraskuun loppu (1. vaihe)</div></div></div>
 <div class="col-md-12"><div class="application-box">
 <h3><a href="/tutkimusrahoitus/hae-rahoitusta/haut/strategisen/protect/">PROTECT</a></h3>
 <div class="app-start"><strong>Haku alkaa</strong> 16.11.2027</div>
 <div class="app-end"><strong>Haku päättyy</strong> 15.12.2027 klo 23.59</div></div></div></div>
<h2>Valmistelussa olevat haut</h2>
<p>Akatemia suunnittelee avaavansa seuraavat haut.</p>
<ul><li><a href="https://eur10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.brainhealth-partnership.eu%2F&amp;data=1">Brain Health JTC2026 Call 1</a>, kutsuhaku suunnitellaan avattavaksi syksyllä 2026</li>
<li>Profi 10 -rahoitushaku, suunnitellaan olevan avoinna touko-kesäkuussa 2027</li></ul>
<h2>Jaa sivua</h2><ul><li>Facebook</li></ul></article></main>"""


def test_akatemia():
    calls = akatemia.parse_page(AKA_HTML)
    by = {c.title: c for c in calls}
    a = by["2027 Akatemiahankkeet, kaikki tutkimusalat"]
    assert a.opens == "2026-10-14" and a.deadlines == ["2026-11-11"] and a.programme == "For research teams"
    n = by["Novel ecosystems"]
    assert n.deadlines == [] and "Marraskuun loppu" in n.deadline_text
    assert by["PROTECT"].status == "forthcoming"
    assert by["Brain Health JTC2026 Call 1"].url == "https://www.brainhealth-partnership.eu/"
    assert "Profi 10 -rahoitushaku" in by
    assert "Facebook" not in by


def test_eura():
    data = {"preRenderData": {"koodisto": {
        "viranomainen": {"2609": {"fi": "Etelä-Karjalan liitto"}, "6207": {"fi": "Itä-Suomen elinvoimakeskus"}},
        "maakunta": {"09": {"fi": "Etelä-Karjala"}, "02": {"fi": "Varsinais-Suomi"}}},
        "hankehaku": [
            {"id": "4feadd29", "tila": "haettavissa", "hakuaika": {"alku": "2026-09-28", "loppu": "2026-11-06"},
             "otsikko": "Kestävän kaupunkikehittämisen rahoitushaku / Svensk titel", "rahasto": "EAKR",
             "eakrTyyppi": "YLEINEN", "viranomainen": "2609", "alue": "ETELA_SUOMI", "hakutunnus": "EKALII-023",
             "maakunnat": ["09", "ylimaakunnallinen"]},
            {"id": "yrtu", "tila": "haettavissa", "hakuaika": {"alku": "2026-04-15", "loppu": "2026-12-31"},
             "otsikko": "Yritystuki", "rahasto": "EAKR", "eakrTyyppi": "YRTU", "viranomainen": "6207",
             "alue": "VALTAKUNNALLINEN", "maakunnat": []},
            {"id": "old", "tila": "paattynyt", "hakuaika": {"alku": "2025-01-01", "loppu": "2025-02-01"},
             "otsikko": "Vanha", "rahasto": "ESR+", "maakunnat": []},
            {"id": "tuleva", "tila": "julkaistu", "hakuaika": {"alku": "2026-10-30", "loppu": "2026-12-15"},
             "otsikko": "Varsinais-Suomen haku", "rahasto": "EAKR", "eakrTyyppi": "YLEINEN",
             "viranomainen": "6207", "alue": "LANSI_SUOMI", "maakunnat": ["02"]},
        ]}}
    html = '<html><script type="__PREACT_CLI_DATA__">' + quote(json.dumps(data)) + "</script></html>"
    parsed = eura.extract_data(html)
    calls = eura.parse(parsed)
    assert [c.id for c in calls] == ["eura:4feadd29", "eura:tuleva"]
    assert calls[0].title == "Kestävän kaupunkikehittämisen rahoitushaku"
    assert calls[0].region == "Etelä-Karjala" and calls[0].funder == "Etelä-Karjalan liitto" and calls[0].programme == "ERDF"
    assert calls[1].status == "forthcoming" and calls[1].region == "Varsinais-Suomi"
    assert len(eura.parse(parsed, include_business_aid=True)) == 3


def test_interreg_to_call():
    c = interreg._to_call({"title": "2021 - 2027 Interreg VI-B EURO Mediterranean (EURO MED)Call 8 Thematic projects",
                           "deadline": "13 November 2026", "programme": "Interreg EURO Mediterranean (EURO MED)",
                           "countries": "Spain, France, Finland", "themes": ["Greener Europe"],
                           "url": "https://interreg-euro-med.eu/en/call-8-thematic-projects/"}, "open")
    assert c.title == "Call 8 Thematic projects"
    assert c.deadlines == ["2026-11-13"]
    assert "Finland eligible" in c.auto_tags


def test_keyword_score_title_weighs_double():
    from common import Call
    c1 = Call(id="a", source="eu", title="Solar PV production", url="", funder="")
    c2 = Call(id="b", source="eu", title="Something", url="", funder="", summary="solar")
    c3 = Call(id="c", source="eu", title="Defence energy", url="", funder="")
    assert keyword_score(c1, PROFILE) == 6
    assert keyword_score(c2, PROFILE) == 3
    assert keyword_score(c3, PROFILE) < 0


def test_merge_keeps_ai_marks_closed_and_protects_failed_sources(monkeypatch):
    from common import Call
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    scorer = AiScorer({}, PROFILE)
    c = Call(id="eu:A", source="eu", title="Solar", url="u", funder="EC", deadlines=["2099-01-01"])
    prev = {
        "eu:A": {**c.to_record(), "firstSeen": "2026-01-01", "aiScore": 77, "aiReason": "hyvä"},
        "eu:GONE": {"id": "eu:GONE", "source": "eu", "title": "x", "lastSeen": "2099-01-01", "status": "open"},
        "bf:KEEP": {"id": "bf:KEEP", "source": "bf", "title": "y", "lastSeen": "2000-01-01", "status": "open"},
    }
    out = {r["id"]: r for r in main.merge([c], prev, {"eu"}, scorer, PROFILE, 60)}
    assert out["eu:A"]["aiScore"] == 77 and out["eu:A"]["firstSeen"] == "2026-01-01"
    assert out["eu:A"]["relevance"] == 77
    assert out["eu:GONE"]["status"] == "closed"
    assert out["bf:KEEP"]["status"] == "open"   # BF-lähde epäonnistui -> ei kosketa


def test_ai_scorer_with_fake_client(monkeypatch):
    from types import SimpleNamespace
    from common import Call
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    scorer = AiScorer({"max_calls_per_run": 1, "eu_min_keyword_score": 1}, {"organisation": "NERC"})
    reply = '{"score": 140, "reason": "Fits PV research.", "tags": ["aurinkosähkö"], "eligible": "kyllä", ' \
            '"deadline": "2099-05-01", "opens": null, "continuous": false}'
    fake = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: SimpleNamespace(
        content=[SimpleNamespace(text="Tässä: " + reply)], usage=SimpleNamespace(input_tokens=900, output_tokens=60))))
    scorer.client = fake
    c = Call(id="bf:x", source="bf", title="PV", url="u", funder="BF")
    eu_low = Call(id="eu:y", source="eu", title="Space", url="u", funder="EC")
    assert not scorer.should_score(eu_low, 0)          # EU-esisuodatus
    out = {r["id"]: r for r in main.merge([c], {}, {"bf"}, scorer, PROFILE, 60)}
    r = out["bf:x"]
    assert r["aiScore"] == 100 and r["deadline"] == "2099-05-01" and r["aiTags"] == ["aurinkosähkö"]
    assert scorer.tokens_in == 900 and not scorer.should_score(c, 5)   # budjetti täynnä


def test_eura_detail_and_akatemia_detail():
    ilm = {"preRenderData": {"ilmoitus": {"kuvaus": "<p>Osana Uudistuva ja osaava Suomi -ohjelmaa toteutetaan jatkuvan oppimisen teemaa.</p>",
                                          "kokonaistuki": "Haulle on varattu noin neljä miljoonaa euroa.", "jatkuvaHaku": True}}}
    info = eura.parse_detail('<script type="__PREACT_CLI_DATA__">' + quote(json.dumps(ilm)) + "</script>")
    assert "jatkuvan oppimisen" in info["text"] and "neljä miljoonaa" in info["text"] and info["continuous"]
    html = "<main><nav>Valikko</nav><article><h1>2027 Akatemiahankkeet</h1><p>Enimmäismyöntö on 1 miljoona euroa.</p></article></main>"
    assert akatemia.parse_detail(html) == "2027 Akatemiahankkeet Enimmäismyöntö on 1 miljoona euroa."


def _fake_scorer(monkeypatch, budget, reply):
    from types import SimpleNamespace
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    scorer = AiScorer({"max_calls_per_run": budget}, {"organisation": "NERC"})
    scorer.client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: SimpleNamespace(
        content=[SimpleNamespace(text=reply)], usage=SimpleNamespace(input_tokens=10, output_tokens=5))))
    return scorer


def test_summary_stored_and_old_records_rescored(monkeypatch):
    from common import Call
    reply = '{"summary": "Funds PV pilots. Consortia of three or more.", "score": 70, "reason": "r", "tags": [], "eligible": "yes"}'
    c = Call(id="eu:A", source="eu", title="Solar", url="u", funder="EC", deadlines=["2099-01-01"])
    prev = {"eu:A": {**c.to_record(), "aiScore": 40, "aiReason": "old"}}          # scored before summaries existed
    out = main.merge([c], prev, {"eu"}, _fake_scorer(monkeypatch, 5, reply), PROFILE, 60)[0]
    assert out["aiSummary"] == "Funds PV pilots. Consortia of three or more." and out["aiScore"] == 70
    # already has a summary and is unchanged -> not scored again
    prev2 = {"eu:A": {**out}}
    scorer = _fake_scorer(monkeypatch, 5, reply)
    out2 = main.merge([c], prev2, {"eu"}, scorer, PROFILE, 60)[0]
    assert scorer.used == 0 and out2["aiSummary"] == out["aiSummary"]
    # "null" summary is stored as None
    out3 = main.merge([Call(id="x", source="bf", title="T", url="u", funder="BF")], {}, {"bf"},
                      _fake_scorer(monkeypatch, 5, '{"summary": null, "score": 10}'), PROFILE, 60)[0]
    assert out3["aiSummary"] is None


def test_budget_used_up_keeps_previous_assessment(monkeypatch):
    from common import Call
    c = Call(id="eu:A", source="eu", title="Solar changed", url="u", funder="EC", deadlines=["2099-01-01"])
    prev = {"eu:A": {"id": "eu:A", "hash": "different", "aiScore": 55, "aiReason": "kept", "aiSummary": "S"}}
    out = main.merge([c], prev, {"eu"}, _fake_scorer(monkeypatch, 0, "{}"), PROFILE, 60)[0]
    assert out["aiScore"] == 55 and out["aiReason"] == "kept" and out["relevance"] == 55


def test_profile_round_trip_and_rescore_on_change(monkeypatch):
    import relevance_profile as prof
    from common import Call
    doc = prof.to_doc({"organisation": "NERC  team\\n solar", "keywords": {"Solar": 3}, "negative": {"defence": -3}})
    assert doc["keywords"] == [{"word": "Solar", "weight": 3.0}] and doc["organisation"] == "NERC team\\n solar"
    p = prof.from_doc({**doc, "negative": [{"word": "defence", "weight": 3}, {"word": "", "weight": 1}, {"word": "x", "weight": "bad"}]})
    assert p["keywords"] == {"solar": 3.0} and p["negative"] == {"defence": -3.0}

    reply = '{"summary": "S", "score": 60, "reason": "r", "tags": [], "eligible": "yes"}'
    c = Call(id="eu:A", source="eu", title="Solar", url="u", funder="EC", deadlines=["2099-01-01"])
    scorer = _fake_scorer(monkeypatch, 5, reply)
    first = main.merge([c], {}, {"eu"}, scorer, p, 60)[0]
    assert first["aiProfile"] == scorer.version
    # same profile -> not scored again
    s2 = _fake_scorer(monkeypatch, 5, reply)
    main.merge([c], {"eu:A": first}, {"eu"}, s2, p, 60)
    assert s2.used == 0
    # organisation text changed -> scored again
    s3 = _fake_scorer(monkeypatch, 5, reply)
    s3.version = prof.ai_version({"organisation": "different"})
    out = main.merge([c], {"eu:A": first}, {"eu"}, s3, p, 60)[0]
    assert s3.used == 1 and out["aiProfile"] == s3.version
