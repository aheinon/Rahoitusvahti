"""Tests for CETPartnership, EDUFI, Haeavustuksia.fi, maaseutu.fi and foundations, plus the
zero-call guard and the team feedback examples. Samples mirror the pages checked on 2 Nov 2026."""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402
from common import Call, parse_time  # noqa: E402
from scoring import AiScorer  # noqa: E402
from sources import cetp, maaseutu, oph, saatiot, valtionavustukset  # noqa: E402

CETP_LIST = """<section class="calls-listing"><ul class="calls-listing__list">
<li><a href="https://cetpartnership.eu/calls/joint-call-2026/" class="calls-listing__row"><div class="calls-listing__content">
<h3 class="calls-listing__title">Joint Call 2026</h3></div></a></li>
<li><a href="https://cetpartnership.eu/calls/joint-call-2025/" class="calls-listing__row"><div class="calls-listing__content">
<h3 class="calls-listing__title">Joint Call 2025</h3><span class="calls-listing__badge">Applications closed</span></div></a></li>
</ul></section>"""

CETP_CALL = """<main><div class="big-hero__intro"><p>CETPartnership is proud to launch its fifth annual Joint Call.</p></div>
<section class="block call-calendar"><div class="call-calendar__items">
<div class="call-calendar__item is-completed"><div class="call-calendar__item-wrapper"><span class="call-calendar__item-title">Opening for pre-proposal submission (Stage 1)</span>
<span class="call-calendar__item-date">8 June 2026</span><span class="call-calendar__item-time">14:00 (CEST)</span></div></div>
<div class="call-calendar__item is-completed"><div class="call-calendar__item-wrapper"><span class="call-calendar__item-title">Deadline for pre-proposal submission (Stage 1)</span>
<span class="call-calendar__item-date">8 October 2026</span><span class="call-calendar__item-time">14:00 (CEST)</span></div></div>
<div class="call-calendar__item"><div class="call-calendar__item-wrapper"><span class="call-calendar__item-title">Deadline for full proposal submission</span>
<span class="call-calendar__item-date">11 March 2099</span><span class="call-calendar__item-time">14:00 (CET)</span></div></div>
</div></section>
<div class="call-modules__grid"><a href="x" class="card"><article><div class="card__content"><div class="card__badge card__badge--teal"> Call Module 2026-06 </div>
<div class="card__text"><p class="card__title">Stationary battery technologies and systems</p></div></div></article></a></div></main>"""


def test_cetp():
    items = cetp.parse_list(CETP_LIST)
    assert items == [{"title": "Joint Call 2026", "url": "https://cetpartnership.eu/calls/joint-call-2026/"}]
    c = cetp.parse_call(CETP_CALL, items[0]["title"], items[0]["url"])
    assert c.id == "cetp:joint-call-2026" and c.status == "open" and c.opens == "2026-06-08"
    assert c.deadlines == ["2026-10-08", "2099-03-11"] and c.next_deadline == "2099-03-11"
    assert c.deadline_time == "14:00 CET" and "invitation" in c.summary
    assert "CM2026-06: Stationary battery" in c.detail_text
    past = CETP_CALL.replace("11 March 2099", "11 March 2020")
    assert cetp.parse_call(past, "Joint Call 2019", "u") is None


OPH_LIST = """<div class="node--type-funding"><div class="listing-item node--type-funding"><div class="listing-item-content">
<div class="listing-item-bundle"> Kansainvälistymisrahoitus </div>
<h3 class="listing-title"><a class="listing-title__link" href="/fi/funding/erasmus-korkeakoulutus-ka220-hed-2099"> Erasmus+ korkeakoulutus: kumppanuushankkeiden (KA220-HED) haku </a></h3>
<div class="listing-item-footer"><div class="listing-item-tags"><span class="field field-programmes"><span class="tag">Erasmus+</span></span>
<span class="field field-level-of-education"><span class="tag">Korkeakoulutus</span></span></div>
<div class="application-status-info"><div class="status_label field field-funding-state"> Tulossa </div>
<div class="field field-application-period"><span>Hakuaika</span><span class="field_application_period">1.12.2098 – 5.3.2099 klo 13:00</span></div></div></div></div></div></div>
<div class="node--type-funding"><div class="listing-item node--type-funding"><div class="listing-item-content">
<div class="listing-item-bundle"> Kansainvälistymisrahoitus </div>
<h3 class="listing-title"><a href="/fi/funding/eun-luova-eurooppa-2099"> EU:n Luova Eurooppa: medialukutaitohankkeet </a></h3>
<div class="listing-item-footer"><div class="listing-item-tags"><span class="field field-programmes"><span class="tag">Luova Eurooppa</span></span></div>
<div class="application-status-info"><div class="field field-funding-state"> Haettavissa </div>
<div class="field"><span class="field_application_period">22.10.2026 – 20.1.2099 klo 18:00</span></div></div></div></div></div></div>
<div class="node--type-funding"><div class="listing-item node--type-funding"><div class="listing-item-content">
<h3 class="listing-title"><a href="/fi/funding/erasmus-vet-2026"> Erasmus+ ammatillinen koulutus: KA220-VET </a></h3>
<div class="listing-item-footer"><div class="listing-item-tags"><span class="field"><span class="tag">Erasmus+</span></span></div>
<div class="application-status-info"><div class="field field-funding-state"> Ratkaistu </div>
<div class="field"><span class="field_application_period">1.1.2026 – 5.3.2026 klo 13:00</span></div></div></div></div></div></div>"""


def test_oph():
    items = oph.parse_list(OPH_LIST)
    assert [i["state"] for i in items] == ["Tulossa", "Haettavissa", "Ratkaistu"]
    kept = [i for i in items if oph.keep(i, oph.DEFAULT_INCLUDE, oph.DEFAULT_EXCLUDE)]
    assert len(kept) == 1
    c = oph.to_call(kept[0])
    assert c.id == "oph:erasmus-korkeakoulutus-ka220-hed-2099" and c.programme == "Erasmus+"
    assert c.status == "forthcoming" and c.opens == "2098-12-01" and c.deadlines == ["2099-03-05"]
    assert c.deadline_time == "13:00 Finnish time" and c.url.startswith("https://www.oph.fi/fi/funding/")


def _va(num, title, org="YM", start="2026-10-25T22:00:00.000Z", end="2027-12-09T21:59:00.000Z", typ="Maaraaikainen"):
    return {"hakuasianAsianumero": num, "nimi": {"fi": title}, "kuvaus": {"fi": "Avustusta kehittämishankkeisiin."},
            "hakuAlkaaDateTimeUtc": start, "hakuPaattyyDateTimeUtc": end, "hakuTyyppi": typ,
            "vastuullinenJarjestajaOrganisaatio": {"nimi": {"fi": "Ympäristöministeriö", "en": "Ministry of the Environment"}, "lyhenne": org}}


def test_valtionavustukset():
    items = [
        _va("va-ym-2099-1", "Avustus ravinteiden kierrätyksen edistämiseen"),
        _va("va-lou-2026-5", "Yksityisteiden valtionavustukset", org="LOU"),
        _va("va-bf-2026-1", "Co-Innovation", org="BF"),
        _va("va-jotpa-2026-5", "Jatkuvan oppimisen ja työllisyyden palvelukeskus - Hankeavustus työn ohessa opiskelun vahvistamiseksi 4/2026",
            org="JOTPA", end="2027-04-30T20:59:59.000Z"),
        _va("va-tem-2024-1", "Jatkuva haku", org="TEM", start="2024-01-01T00:00:00.000Z", end="2136-12-31T21:59:00.000Z", typ="Jatkuva"),
        _va("va-ym-2020-1", "Vanha", end="2020-01-01T00:00:00.000Z"),
    ]
    calls = valtionavustukset.parse_items(items, set(valtionavustukset.DEFAULT_EXCLUDE_ORGS), valtionavustukset.DEFAULT_EXCLUDE_TITLES)
    by = {c.id: c for c in calls}
    assert set(by) == {"va:va-ym-2099-1", "va:va-jotpa-2026-5", "va:va-tem-2024-1"}
    ym = by["va:va-ym-2099-1"]
    assert ym.funder == "Ministry of the Environment" and ym.deadlines == ["2027-12-09"] and ym.deadline_time == "23:59 Finnish time"
    assert ym.opens == "2026-10-26" and ym.url == "https://www.haeavustuksia.fi/fi/haku/va-ym-2099-1"
    jotpa = by["va:va-jotpa-2026-5"]
    assert jotpa.programme == "Jotpa" and jotpa.title.startswith("Hankeavustus työn ohessa")
    assert by["va:va-tem-2024-1"].continuous and by["va:va-tem-2024-1"].deadlines == []


MAASEUTU = """<main><section class="accordion-block"><div class="content">
<button type="button" class="accordion-title" aria-controls="a1"><span class="h4"> Hanketuet </span><span class="material-icons">arrow_drop_down</span></button>
<div class="accordion-text" id="a1"><div class="text-wrapper"><p>Maaseudun hanketukien valintajaksot Lounais-Suomen elinvoimakeskuksessa:</p>
<ul><li>1.5.2025–30.9.2025</li><li>1.10.2098–31.1.2099</li></ul>
<p>Yleishyödyllisten ympäristö- ja ilmastoinvestointien teemahaku:</p><ul><li>1.10.–15.11.2025</li></ul></div></div>
<button type="button" class="accordion-title" aria-controls="a2"><span class="h4"> Yritystuet </span></button>
<div class="accordion-text" id="a2"><div class="text-wrapper"><p>Yritystukien valintajaksot:</p><ul><li>16.1.–15.3.</li></ul></div></div>
<button type="button" class="accordion-title" aria-controls="a3"><span class="h4"> Leader Varsin Hyvä </span></button>
<div class="accordion-text" id="a3"><div class="text-wrapper"><p>Leader Varsin Hyvä toimii Kaarinassa, Liedossa ja Turussa.</p>
<p>Valintajaksot:</p><ul><li>1.1.–28.2.2026</li><li>12.10.–31.12.2098</li></ul></div></div>
<button type="button" class="accordion-title" aria-controls="a4"><span class="h4"> Leader Ravakka </span></button>
<div class="accordion-text" id="a4"><div class="text-wrapper"><p>Leader Ravakka toimii Laitilassa.</p><p>Seuraavat valintajaksot päättyvät:</p><ul><li>11.1.2026</li></ul></div></div>
</div></section></main>"""


def test_maaseutu():
    page = maaseutu.DEFAULT_PAGES[0]
    calls = maaseutu.parse_page(MAASEUTU, page)
    titles = [c.title for c in calls]
    assert titles == ["Maaseudun kehittämishankkeet – Lounais-Suomen elinvoimakeskus",
                      "Leader Varsin Hyvä – maaseudun kehittämishankkeet", "Leader Ravakka – maaseudun kehittämishankkeet"]
    main_c, varsin, ravakka = calls
    assert main_c.continuous and main_c.deadlines == ["2099-01-31"] and main_c.region == "Varsinais-Suomi"
    assert varsin.deadlines == ["2098-12-31"] and "Turussa" in varsin.summary and varsin.funder == "Leader Varsin Hyvä"
    assert ravakka.deadlines == [] and ravakka.continuous and "not published" in ravakka.deadline_text


def test_saatiot_and_text_hash():
    f = {"name": "Maj ja Tor Nesslingin säätiö", "url": "https://nessling.fi/en/open-calls/", "note": "Environmental research"}
    a = saatiot.to_call(f, "The general call is open 10 August - 15 September.")
    b = saatiot.to_call(f, "The general call is open 9 August - 14 September.")
    assert a.id == "saatio:maj-ja-tor-nesslingin-s-ti" or a.id.startswith("saatio:maj-ja-tor-nesslingin")
    assert a.content_hash() != b.content_hash()               # a changed page is assessed again
    plain = Call(id="x", source="bf", title="T", url="u", funder="F")
    assert plain.content_hash() == Call(id="x", source="bf", title="T", url="u", funder="F", text_hash="").content_hash()


def test_parse_time():
    assert parse_time("22.10.2026 – 20.1.2027 klo 18:00") == "18:00"
    assert parse_time("klo 16.15") == "16:15"
    assert parse_time("22.10.2026") == ""


def test_zero_calls_keeps_previous(monkeypatch, tmp_path):
    import json
    prev = {"items": [{"id": f"cetp:{i}", "source": "cetp", "title": str(i), "status": "open", "lastSeen": "2026-11-01"} for i in range(4)]}
    path = tmp_path / "calls.json"
    path.write_text(json.dumps(prev))
    monkeypatch.setattr(main, "SOURCES", {"cetp": lambda cfg: []})
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", ["main.py", "--dry-run", str(path)])
    assert main.main() == 1                                   # all sources failed
    out = json.loads(path.read_text())
    assert all(c["status"] == "open" for c in out["items"]) and "cetp" in out["meta"]["errors"]


def test_team_examples_and_prompt(monkeypatch):
    calls = {"eu:A": {"title": "PV pilot lines", "funder": "European Commission", "programme": "Horizon Europe"},
             "bf:B": {"title": "Defence SMEs", "funder": "Business Finland", "programme": ""},
             "aka:C": {"title": "Academy projects", "funder": "RCF", "programme": ""}}
    fb = {"ratings": [{"callId": "eu:A", "v": 1, "reason": "core topic", "at": "2026-11-01"},
                      {"callId": "eu:A", "v": 1, "at": "2026-11-02"},
                      {"callId": "bf:B", "v": -1, "reason": "companies only", "at": "2026-10-30"},
                      {"callId": "zz", "v": 1, "at": "2026-10-30"}],
          "notes": {"aka:C": {"stage": "skip", "updatedAt": "2026-10-01"}, "eu:A": {"stage": "preparing"}}}
    ex = main.team_examples(fb, calls)
    assert [(e["title"], e["verdict"]) for e in ex] == [("PV pilot lines", "relevant"), ("Defence SMEs", "not relevant"),
                                                        ("Academy projects", "not relevant")]
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    sent = {}
    scorer = AiScorer({}, {"organisation": "NERC"}, ex)
    scorer.client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: sent.update(kw) or SimpleNamespace(
        content=[SimpleNamespace(type="text", text='{"score": 50}')], usage=SimpleNamespace(input_tokens=1, output_tokens=1))))
    scorer.score(Call(id="x", source="bf", title="T", url="u", funder="F"))
    prompt = sent["messages"][0]["content"]
    assert "HOW THE TEAM HAS JUDGED" in prompt and "Defence SMEs (Business Finland): not relevant - companies only" in prompt
