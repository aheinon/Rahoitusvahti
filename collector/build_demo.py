"""Builds web/demo-data.json for the app's demo mode.

The data was taken from the real sources on 29 Oct 2026 and run through the collector's
normalisation and keyword scoring. The Claude reasons on a few calls are illustrative examples.
"""
import json
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(__file__))
from common import Call  # noqa: E402
from sources.akatemia import GROUP_EN  # noqa: E402
from sources.eura import FUND_EN  # noqa: E402
from scoring import AiScorer, keyword_score  # noqa: E402
import main  # noqa: E402

EUB = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/"
EU = [  # id, title, programme, opens, deadlines, status, action (a sample of the ~365 current EU topics)
    ("HORIZON-CL5-2027-02-D3-15", "Production technologies for solar photovoltaics beyond the state-of-the-art (EUPI-PV Partnership)", "Horizon Europe", "2026-12-03", ["2027-03-31"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL5-2027-05-D2-08", "Demonstration for Long-duration Battery Energy Storage Systems (BATT4EU Partnership)", "Horizon Europe", "2027-05-05", ["2027-09-15"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL5-2027-07-D3-27", "Integrated Approaches for Retrofitting Infrastructures with Innovative Energy Storage Technologies", "Horizon Europe", "2027-08-04", ["2027-12-01"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-MISS-2027-04-CIT-01", "Innovative microgrids for improved energy system integration and efficiency in urban contexts", "Horizon Europe", "2027-02-09", ["2027-10-07"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL5-2026-11-D3-23", "Data sharing to support the training and development of AI foundation models in the energy sector", "Horizon Europe", "2026-08-04", ["2026-12-01"], "open", "HORIZON Innovation Actions"),
    ("HORIZON-BRIDGING-2027-01-12", "Large-Scale piloting of next-generation AI-driven digital platforms for a more affordable, secure and sustainable European energy system (IA) - Apply AI", "Horizon Europe", "2026-10-20", ["2027-02-16"], "open", "HORIZON Innovation Actions"),
    ("HORIZON-CL5-2027-07-D3-25", "Advanced TSO control rooms to enhance grid observability, stability and resilience", "Horizon Europe", "2027-08-04", ["2027-12-01"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL5-2027-04-Two-Stage-D2-07", "Novel approaches towards next-generation battery concepts, leveraging the enabling role of innovative advanced materials (BATT4EU and IAM4EU Partnerships)", "Horizon Europe", "2026-12-15", ["2027-04-14", "2027-10-07"], "forthcoming", "HORIZON  Research and Innovation Actions"),
    ("HORIZON-CL5-2027-02-D2-06", "Sustainable and Competitive Cell Production Techniques for Lithium-ion And Sodium-ion Batteries (BATT4EU Partnership)", "Horizon Europe", "2026-12-03", ["2027-03-31"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-MISS-2027-04-CIT-02", "Hydrogen cities", "Horizon Europe", "2027-02-09", ["2027-10-07"], "forthcoming", "HORIZON Coordination and Support Actions"),
    ("HORIZON-CL5-2027-02-D3-07", "Concentrated solar thermal systems for decarbonising industrial processes", "Horizon Europe", "2026-12-03", ["2027-03-31"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL4-2027-02-MAT-PROD-32-two-stage", "Efficient energy input from renewable sources and energy management in the process industries (IA)", "Horizon Europe", "2026-10-13", ["2027-02-02", "2027-09-02"], "open", "HORIZON Innovation Actions"),
    ("HORIZON-BRIDGING-2027-05-01", "Skills for innovative SMEs", "Horizon Europe", "2026-12-01", ["2027-03-03"], "forthcoming", "HORIZON Coordination and Support Actions"),
    ("HORIZON-CL6-2026-04-GOVERNANCE-01", "Additional activities for the European Partnership of Agriculture of Data", "Horizon Europe", "2026-08-25", ["2026-11-26"], "open", "HORIZON Programme Cofund Actions"),
    ("HORIZON-CL5-2027-05-D4-06", "Thermal energy optimisation and waste heat recovery of high energy demand IT rooms in buildings or small edge data centres", "Horizon Europe", "2027-05-05", ["2027-09-15"], "forthcoming", "HORIZON Innovation Actions"),
    ("DIGITAL-2023-SKILLS-04-SEMICONDUCTORS", "Reinforcing skills in semiconductors", "Digital Europe", "2026-10-31", ["2027-06-30"], "forthcoming", "DIGITAL Simple Grants"),
    ("HORIZON-CL5-2027-03-D5-18", "Enhanced electric operation and battery durability (ZEWT Partnership)", "Horizon Europe", "2026-12-15", ["2027-04-14"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL5-2027-03-D5-14", "Onboard renewable energy solutions and energy saving measures to reduce the fuel consumption of ships by at least 55% (ZEWT Partnership)", "Horizon Europe", "2026-12-15", ["2027-04-14"], "forthcoming", "HORIZON Innovation Actions"),
    ("HORIZON-CL6-2027-01-ZEROPOLLUTION-03", "Improve the capacity to monitor and reduce air pollution from agriculture", "Horizon Europe", "2027-04-20", ["2027-09-22"], "forthcoming", "HORIZON  Research and Innovation Actions"),
]

BFB = "https://www.businessfinland.fi"
BF = [  # slug-path, title, summary, status, opens, deadline, continuous
    ("/palvelut/rahoitus/haut/2026/dut-rahoitushaku-2026/", "Driving Urban Transitions (DUT) partnership -rahoitushaku 2026", "Haussa etsitään innovatiivisia projekteja, jotka nopeuttavat siirtymistä ilmastoneutraaleihin ja ilmastonmuutoksen kestäviin kaupunkeihin.", "open", "2026-09-01", "2026-11-17", False),
    ("/palvelut/rahoitus/haut/2026/haku-tutkimusorganisaatio-pk-yritys/", "Tutkimusorganisaatioiden ja pk-yritysten yhteistyö", "Haun tavoitteena on saada tutkimus-yritys-yhteistyön piiriin pk- ja mittelstand-yrityksiä. Haussa rahoitetaan yksinomaan tutkimusorganisaatioita.", "open", None, None, False),
    ("/palvelut/rahoitus/haut/2026/veturiyritysten-kumppanuusrahoitushaku-co-research/", "Veturiyritysten kumppanuusrahoitushaku Co-Research-projekteille", "Kumppanuusrahoitusta veturiyritysten tiekarttojen mukaisiin tutkimushankkeisiin tutkimusorganisaatioille tai niiden yhteisille hankkeille.", "open", None, None, True),
    ("/palvelut/rahoitus/rahoituspalvelut/yritysten-ja-tutkimusorganisaatioiden-yhteistyo/co-innovation/", "Co-Innovation", "Rahoitusta tutkimusorganisaatioiden, yritysten ja hyvinvointialueiden yhteishankkeisiin.", "open", None, None, True),
    ("/palvelut/rahoitus/rahoituspalvelut/yritysten-ja-tutkimusorganisaatioiden-yhteistyo/co-creation/", "Co-Creation", "Rahoitusta tutkimusorganisaation ja yritysten yhteisen tutkimusidean kehittämiseen.", "open", None, None, True),
    ("/palvelut/rahoitus/rahoituspalvelut/energiatuki/", "Energiatuki", "Energiatukea voidaan myöntää yritysten ja yhteisöjen investointi- ja katselmushankkeisiin, jotka edistävät energiansäästöä ja energian tuotannon tai käytön tehostamista.", "open", None, None, True),
    ("/palvelut/rahoitus/haut/2026/naytonpaikka-rahoitushaku-2026/", "Näytönpaikka – rahoitushaku radikaaleille tutkimusideoille 2026", "Näytönpaikka vauhdittaa huippututkimusta, joka luo tulevaisuuden kasvualojen tarvitsemaa osaamista ja kyvykkyyksiä.", "open", None, None, False),
    ("/palvelut/rahoitus/haut/2026/nordforsk-haku-2026/", "NordForsk-haku: tutkimusideoiden valmisteluhankkeet – Raw Materials Partnership (RAMP)", "Haun tavoitteena on vahvistaa pohjoismaista yhteistyötä ja valmistella kansainvälisiä yhteishankkeita raaka-aineisiin liittyvässä tutkimuksessa.", "open", None, None, False),
    ("/palvelut/rahoitus/haut/2026/rahoitushaku-innovatiiviset-julkiset-hankinnat/", "Innovatiiviset julkiset hankinnat", "Rahoitus soveltuu hankintoihin, joissa julkinen sektori uudistaa palvelujaan. Haku on jatkuva.", "open", None, None, True),
    ("/palvelut/rahoitus/haut/2026/european-partnership-for-a-sustainable-future-of-food-systems--rahoitushaku-2026/", "European partnership for a sustainable Future of Food Systems -rahoitushaku 2026", "Ennakkoilmoitus FutureFoodS-kumppanuuden kolmannesta hausta. Haku avautuu nykytiedon mukaan marraskuun 2026 alussa.", "forthcoming", None, None, False),
]

AKAB = "https://www.aka.fi"
AKA = [  # path, title, group, opens, deadline, deadline_text
    ("/tutkimusrahoitus/hae-rahoitusta/haut/tutkijalle/2027-akatemiatutkijan-tehtava-kaikki-tutkimusalat/", "2027 Akatemiatutkijan tehtävä, kaikki tutkimusalat", "Tutkijalle", "2026-10-14", "2026-11-11", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/tutkimusryhmille/2027-akatemiahankkeet-kaikki-tutkimusalat/", "2027 Akatemiahankkeet, kaikki tutkimusalat", "Tutkimusryhmille", "2026-10-14", "2026-11-11", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/tutkimusryhmille/2027-hyvinvointialueiden-tk-toiminnan-ja--yhteistyon-vahvistamisen-haku/", "2027 Hyvinvointialueiden T&K-toiminnan ja -yhteistyön vahvistamisen haku", "Tutkimusryhmille", "2026-10-21", "2026-11-18", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/strategisen-tutkimuksen-haut/strategisen-tutkimuksen-ohjelma---tulevaisuuden-strategiset-resurssit-resources/", "Strategisen tutkimuksen ohjelma – Tulevaisuuden strategiset resurssit (RESOURCES)", "Strategisen tutkimuksen rahoitus", "2026-11-16", "2026-12-15", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/strategisen-tutkimuksen-haut/strategisen-tutkimuksen-ohjelma---yhteinen-turvallisuus-eriytyvassa-maailmassa-protect/", "Strategisen tutkimuksen ohjelma – Yhteinen turvallisuus eriytyvässä maailmassa (PROTECT)", "Strategisen tutkimuksen rahoitus", "2026-11-16", "2026-12-15", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/kv-haut/nfrfnordforsk-haku-2026-international-joint-initiative-for-research-harnessing-disruptive-technologies-to-address-global-challenges/", "NFRF/NordForsk-haku: 2026 International Joint Initiative for Research Harnessing Disruptive Technologies", "Kansainväliset haut", None, "2026-11-03", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/kv-haut/forestpathways---building-knowledge-and-solutions-for-resilient-forests-and-sustainable-forest-based-futures/", "FORESTPathways – Resilient Forests and Sustainable Forest-Based Futures", "Kansainväliset haut", "2026-09-15", "2026-12-02", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/kv-haut/nordforsk-haku-nordic-and-baltic-solutions-on-food-security/", "NordForsk-haku: Nordic and Baltic solutions on food security", "Kansainväliset haut", "2026-06-23", "2026-12-02", ""),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/kv-haut/ovel-ecosystems-biodiversity-socio-ecological-consequences-and-future-trajectories/", "Novel ecosystems: biodiversity socio-ecological consequences and future trajectories", "Kansainväliset haut", None, None, "End of November (stage 1)"),
    ("/tutkimusrahoitus/hae-rahoitusta/haut/kv-haut/2026-ep-permed-jtc-carmen2026-kutsuhaku/", "2026 EP PerMed JTC CARMEN2026, kutsuhaku", "Kansainväliset haut", "2026-10-29", "2026-11-12", ""),
]

EURA = [  # id, title, fund, region, opens, deadline, status, authority, code
    ("bbffeaa0-a0da-493e-9793-fb2f6e16a0b3", "Länsi-Suomen alueen et. 5.1. Turvaverkkoja nuorten tulevaisuuteen kehittämishankehaku", "ESR+", "Varsinais-Suomi, Satakunta, Pirkanmaa, Keski-Suomi, Pohjanmaa, Etelä-Pohjanmaa, Keski-Pohjanmaa", "2026-08-03", "2026-10-30", "open", "Keski-Suomen elinvoimakeskus", "KESEVK-300"),
    ("565ea41d-d19c-47aa-be8d-4d04e3287df6", "Jatkuva oppiminen -valtakunnallisen teeman kehittämishankkeiden haku", "ESR+", "valtakunnallinen", "2026-09-22", "2026-11-16", "open", "Pohjois-Suomen elinvoimakeskus", "PSUEVK-112"),
    ("a3e079a7-1f24-430d-aabc-f3a15462b79f", "Luovan ja kulttuurialan innovaatio-osaaminen kehittämis- ja kokeiluhankkeiden haku, KERTAKORVAUS", "ESR+", "valtakunnallinen", "2026-10-01", "2026-11-30", "open", "Kaakkois-Suomen elinvoimakeskus", "KASEVK-159"),
    ("358c5665-e04b-421f-ade6-32fc12d9a494", "Länsi-Suomen ennallistamiseen ja jälkikäyttöön liittyvien JTF-hankkeiden haku 2.2.-27.11.2026", "JTF", "Satakunta, Pirkanmaa, Keski-Suomi, Pohjanmaa, Etelä-Pohjanmaa, Keski-Pohjanmaa", "2026-02-02", "2026-11-27", "open", "Keski-Suomen elinvoimakeskus", "KESEVK-255"),
    ("d8dd6efe-05a7-4dd9-8ed1-5f12fcc3f86c", "Uudenmaan EAKR-rahoitushaku erityistavoitteisiin 2.1 ja 2.3", "EAKR", "Uusimaa", "2026-10-05", "2026-11-05", "open", "Uudenmaan liitto", "UUMLII-035"),
    ("0d0999f0-29d4-471c-9a13-e945af84e5de", "Keski-Pohjanmaan Uudistuva ja osaava Suomi 2021-2027 EAKR 2.haku 2026", "EAKR", "Keski-Pohjanmaa", "2026-10-01", "2026-11-30", "open", "Keski-Pohjanmaan liitto", "KEPLII-027"),
    ("5676ad7a-86c8-48fa-8e69-1afdca8fb497", "Pohjois-Karjalan maakuntaliiton 15.12.2026 päättyvä EAKR-kertakorvaushankehaku", "EAKR", "Pohjois-Karjala", "2026-10-30", "2026-12-15", "forthcoming", "Pohjois-Karjalan maakuntaliitto", "POKLII-032"),
    ("4feadd29-3d42-4951-9329-6b3c0dfcb30d", "Kestävän kaupunkikehittämisen rahoitushaku – Lappeenranta-Imatra ekosysteemisopimus", "EAKR", "Etelä-Karjala", "2026-09-28", "2026-11-06", "open", "Etelä-Karjalan liitto", "EKALII-023"),
]

INTERREG = [  # title, programme, deadline, countries, themes, url
    ("Call 8 Thematic projects", "Interreg EURO Mediterranean (EURO MED)", "2026-11-13", "Spain, France, Croatia, Italy, Malta, Portugal, Slovenia, Greece, Cyprus", ["Greener Europe", "Smarter Europe"], "https://interreg-euro-med.eu/en/call-8-thematic-projects/"),
    ("Thematic call for projects for a better connected region on the Upper Rhine", "Interreg France-Germany-Switzerland (Upper Rhine)", "2026-12-10", "France, Germany, Switzerland", ["Better Connected Europe"], "https://interreg.eu/calls-for-projects/"),
    ("Developing a more innovative, more competitive and more attractive economy for the region", "Interreg France-Switzerland", "2027-03-12", "France, Switzerland", ["Smarter Europe"], "https://interreg.eu/calls-for-projects/"),
]

AI_EXAMPLES = {
    "eu:HORIZON-CL5-2027-02-D3-15": (88, "Core NERC topic (PV production technology). An Innovation Action needs a strong industrial consortium; Turku UAS fits as a piloting and testing partner.", ["solar PV", "manufacturing", "piloting"], "yes"),
    "eu:HORIZON-CL5-2027-05-D2-08": (81, "Long-duration storage demo fits the battery research line and building-scale storage work; needs a demo site and industrial partners.", ["battery storage", "demonstration"], "yes"),
    "eu:HORIZON-MISS-2027-04-CIT-01": (76, "Urban microgrids and system integration match energy community and smart grid work; Turku being a Cities Mission city is an advantage.", ["microgrids", "energy communities", "cities"], "yes"),
    "bf:haku-tutkimusorganisaatio-pk-yritys": (72, "Funds research organisations only, for work with SMEs - a good route for regional energy companies.", ["SME collaboration", "research organisation"], "yes"),
    "eura:bbffeaa0-a0da-493e-9793-fb2f6e16a0b3": (22, "Youth inclusion call covering Southwest Finland; no energy angle, mainly for education and guidance projects.", ["youth", "ESF+"], "yes"),
}


# Illustrative summaries, written from the call page text read on 29 Oct 2026.
SUMMARY_EXAMPLES = {
    "aka:2027-akatemiahankkeet-kaikki-tutkimusalat": "Four-year research projects in all fields, with a funding period from 1 Sep 2027 to 31 Aug 2031. Up to EUR 1 million for a single project and up to EUR 1.5 million for a consortium. The aim is high-quality, ground-breaking research that also strengthens the team's expertise.",
    "bf:dut-rahoitushaku-2026": "Driving Urban Transitions partnership call for international projects that speed up the shift to climate-neutral, climate-resilient cities. Two stages: pre-proposals to the DUT portal by 17 Nov 2026, then invited full proposals by 15 Apr 2027 to both DUT and Business Finland.",
    "bf:haku-tutkimusorganisaatio-pk-yritys": "Funds research organisations only, for projects that bring SMEs and Mittelstand companies into research collaboration when they have not used research organisations systematically before.",
    "bf:energiatuki": "Investment and energy audit grants for companies and communities of all sizes. Projects must save energy or make energy production or use more efficient, supporting Finland's carbon neutrality targets.",
    "eura:565ea41d-d19c-47aa-be8d-4d04e3287df6": "National ESF+ call on continuous learning, prepared under the Ministry of Education and Culture and funded through the Economic Development Centre of Northern Finland. About EUR 4 million of ESF+ funding is reserved for the call.",
}


# Sources added on 2 Nov 2026 (as seen that day)
NEW = [
    Call(id="cetp:joint-call-2026", source="cetp", title="CETPartnership Joint Call 2026", url="https://cetpartnership.eu/calls/joint-call-2026/",
         funder="Clean Energy Transition Partnership", programme="CETPartnership (Business Finland in Finland)", status="open",
         opens="2026-06-08", deadlines=["2026-10-08", "2027-03-11"], deadline_time="14:00 CET", call_id="CETP JC2026",
         action_type="Transnational joint call", auto_tags=["clean energy", "partnership call"],
         summary="CETPartnership's fifth annual joint call with 11 call modules, from energy system resilience and renewables to hydrogen, stationary batteries, heating and cooling and integrated regional energy systems. The next deadline is for full proposals, by invitation after the pre-proposal stage."),
    Call(id="va:va-jotpa-2026-5", source="va", title="Hankeavustus työn ohessa opiskelun vahvistamiseksi 4/2026", url="https://www.haeavustuksia.fi/fi/haku/va-jotpa-2026-5",
         funder="Jotpa (Service Centre for Continuous Learning and Employment)", programme="Jotpa", status="open", opens="2026-10-30",
         deadlines=["2027-04-30"], deadline_time="23:59 Finnish time", call_id="va-jotpa-2026-5",
         summary="Project grants to develop how work and studies fit together and to ease the shortage of skilled labour in sectors with labour shortages."),
    Call(id="va:va-mmm-2026-24", source="va", title="Erityisavustus LIFE-hankkeille 2027", url="https://www.haeavustuksia.fi/fi/haku/va-mmm-2026-24",
         funder="Ministry of Agriculture and Forestry", programme="State grant", status="open", opens="2026-10-23", deadlines=["2026-11-16"],
         deadline_time="16:15 Finnish time", call_id="va-mmm-2026-24", auto_tags=["MMM"],
         summary="National co-funding for LIFE projects in the ministry's sector."),
    Call(id="va:va-ita-2026-46", source="va", title="Avustus ravinteiden kierrätyksen edistämiseen", url="https://www.haeavustuksia.fi/fi/haku/va-ita-2026-46",
         funder="Economic Development Centre of Eastern Finland", programme="State grant", status="open", opens="2026-09-30", deadlines=["2026-11-30"],
         deadline_time="16:15 Finnish time", call_id="va-ita-2026-46", auto_tags=["ITA"],
         summary="Grants for projects that promote nutrient recycling (Ministry of the Environment's programme, handled nationally by the Eastern Finland centre)."),
    Call(id="va:va-ulii-2023-3", source="va", title="Interreg-ohjelmien kansallisen vastinrahoituksen haku", url="https://www.haeavustuksia.fi/fi/haku/va-ulii-2023-3",
         funder="Helsinki-Uusimaa Regional Council", programme="State grant", status="open", opens="2022-06-16", deadlines=["2027-12-31"],
         call_id="va-ulii-2023-3", auto_tags=["ULII"], summary="National co-funding for Finnish partners in Interreg projects."),
    Call(id="maaseutu:demo-lou", source="maaseutu", title="Maaseudun kehittämishankkeet – Lounais-Suomen elinvoimakeskus",
         url="https://maaseutu.fi/lounais-suomi/varsinais-suomi/rahoitus-varsinais-suomessa/valintajaksot/", funder="Lounais-Suomen elinvoimakeskus",
         programme="Rural development (CAP)", continuous=True, region="Varsinais-Suomi", auto_tags=["CAP"],
         deadline_text="Rolling; next selection periods not published yet",
         summary="Applications are open all the time and decided after each selection period."),
    Call(id="maaseutu:demo-varsinhyva", source="maaseutu", title="Leader Varsin Hyvä – maaseudun kehittämishankkeet",
         url="https://maaseutu.fi/lounais-suomi/varsinais-suomi/rahoitus-varsinais-suomessa/valintajaksot/", funder="Leader Varsin Hyvä",
         programme="Rural development (CAP)", continuous=True, deadlines=["2026-12-31"], region="Varsinais-Suomi", auto_tags=["Leader"],
         summary="Applications are open all the time and decided after each selection period (next one ends 2026-12-31). Leader Varsin Hyvä works in Kaarina, Lieto, Masku, Naantali, Nousiainen, Paimio, Raisio, Rusko, Sauvo, Taivassalo and Turku."),
    Call(id="maaseutu:demo-ykkosakseli", source="maaseutu", title="Leader Ykkösakseli – maaseudun kehittämishankkeet",
         url="https://maaseutu.fi/lounais-suomi/varsinais-suomi/rahoitus-varsinais-suomessa/valintajaksot/", funder="Leader Ykkösakseli",
         programme="Rural development (CAP)", continuous=True, deadlines=["2026-11-08", "2027-01-17"], region="Varsinais-Suomi", auto_tags=["Leader"],
         summary="Applications are open all the time and decided after each selection period (next one ends 2026-11-08). Leader Ykkösakseli works in Salo, Karkkila, Lohja and Vihti."),
    Call(id="saatio:maj-ja-tor-nesslingin-saatio", source="saatiot", title="Maj ja Tor Nesslingin säätiö: grants", url="https://nessling.fi/en/open-calls/",
         funder="Maj ja Tor Nesslingin säätiö", programme="Foundation", deadline_text="See the foundation's page", auto_tags=["foundation"],
         summary="Environmental research and its use; personal grants and implementation project grants"),
    Call(id="saatio:skr-varsinais-suomen-rahasto", source="saatiot", title="Suomen Kulttuurirahasto, Varsinais-Suomen rahasto: grants",
         url="https://www.skr.fi/en/regional-funds/varsinais-suomi-regional-fund/varsinais-suomi-grants", funder="Suomen Kulttuurirahasto, Varsinais-Suomen rahasto",
         programme="Foundation", deadline_text="See the foundation's page", auto_tags=["foundation"],
         summary="Regional fund for science, art and culture in Varsinais-Suomi; individuals and working groups"),
]
NEW_IDS = {c.id for c in NEW}


def build():
    with open(os.path.join(os.path.dirname(__file__), "config.yaml"), encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    calls = []
    for i, t, prog, o, dls, st, act in EU:
        calls.append(Call(id=f"eu:{i}", source="eu", title=t, url=("https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/46014314" if i.startswith("DIGITAL") else EUB + i), funder="European Commission",
                          programme=prog, status=st, opens=o, deadlines=dls, call_id=i.rsplit("-", 1)[0], action_type=act))
    for p, t, s, st, o, dl, cont in BF:
        calls.append(Call(id="bf:" + p.rstrip("/").split("/")[-1], source="bf", title=t, url=BFB + p,
                          funder="Business Finland", programme="Business Finland", status=st, opens=o,
                          deadlines=[dl] if dl else [], continuous=cont, summary=s))
    for p, t, g, o, dl, dtx in AKA:
        calls.append(Call(id="aka:" + p.rstrip("/").split("/")[-1], source="aka", title=t, url=AKAB + p,
                          funder="Research Council of Finland", programme=GROUP_EN.get(g, g), status="forthcoming" if o and o > "2026-10-29" else "open",
                          opens=o, deadlines=[dl] if dl else [], deadline_text=dtx, auto_tags=[GROUP_EN.get(g, g)]))
    for i, t, fund, reg, o, dl, st, auth, code in EURA:
        fund = FUND_EN.get(fund, fund)
        reg = reg.replace("valtakunnallinen", "national")
        calls.append(Call(id=f"eura:{i}", source="eura", title=t, url=f"https://eura2021.fi/hakuilmoitukset/hakuilmoitus/{i}/",
                          funder=auth, programme=fund, status=st, opens=o, deadlines=[dl], region=reg, call_id=code,
                          auto_tags=[fund], summary=f"{fund} call by {auth}."))
    for t, prog, dl, ctry, th, url in INTERREG:
        import hashlib
        calls.append(Call(id="interreg:" + hashlib.sha1((prog + "|" + t).encode()).hexdigest()[:12], source="interreg",
                          title=t, url=url, funder="Interreg", programme=prog, deadlines=[dl], region=ctry,
                          auto_tags=th, summary=f"Eligible countries: {ctry}"))

    calls += NEW
    os.environ.pop("ANTHROPIC_API_KEY", None)
    scorer = AiScorer({}, cfg["profile"])
    items = main.merge(calls, {}, set(), scorer, cfg["profile"], 60)
    for it in items:
        it["firstSeen"] = "2026-11-02" if it["id"] in NEW_IDS else "2026-10-27" if it["source"] in ("eu", "aka") and it.get("opens", "") and it["opens"] >= "2026-10-13" else "2026-10-01"
        if it["id"] in SUMMARY_EXAMPLES:
            it["aiSummary"] = SUMMARY_EXAMPLES[it["id"]]
        if it["id"] in AI_EXAMPLES:
            s, r, tags, el = AI_EXAMPLES[it["id"]]
            it.update(aiScore=s, aiReason=r, aiTags=tags, aiEligible=el, relevance=s)
    meta = {"counts": {s: sum(1 for i in items if i["source"] == s) for s in ("eu", "bf", "aka", "eura", "interreg", "cetp", "va", "maaseutu", "saatiot")},
            "errors": {}, "total": len(items), "lastRun": "2026-11-02T03:17:00+00:00", "demo": True}
    out = os.path.join(os.path.dirname(__file__), "..", "web", "demo-data.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"items": items, "meta": meta}, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} calls -> {os.path.normpath(out)}")
    build_network_demo()
    for it in sorted(items, key=lambda x: -x["relevance"])[:8]:
        print(f"  {it['relevance']:>3}  {it['title'][:80]}")


def build_network_demo():
    """web/demo-network.json from a sample of the real CORDIS data (5 Turku UAS projects, 2 Nov 2026)."""
    here = os.path.join(os.path.dirname(__file__), "demo")
    net = json.load(open(os.path.join(here, "network.json"), encoding="utf-8"))
    tuas = "948193431"
    projects = [{"pid": p[0], "acronym": p[1], "title": p[2].title() if p[2].isupper() else p[2], "topic": p[3], "start": p[4], "end": p[5],
                 "programme": "Horizon Europe", "partners": 0, "tuasCoordinator": False} for p in net["projs"]]
    orgs = []
    for i, name, country, city, g, typ, ps in net["orgs"]:
        if i == tuas:
            continue
        pids = [x.rstrip("*") for x in ps]
        orgs.append({"id": i, "name": name, "country": country, "city": city.title(), "geo": g, "type": typ,
                     "projects": pids, "coordinated": [x.rstrip("*") for x in ps if x.endswith("*")]})
    for p in projects:
        p["partners"] = sum(1 for o in orgs if p["pid"] in o["projects"])
    radar_raw = json.load(open(os.path.join(here, "radar.json"), encoding="utf-8"))
    radar = {cid: [{"pid": r[0], "acronym": r[1], "title": r[2], "topic": r[3], "year": r[4], "sameTopic": False, "score": 0.4,
                    "size": len(r[5]), "partners": [{"id": o[0], "name": o[1], "country": o[2], "type": o[3], "coordinator": bool(o[4])} for o in r[5]]}
                   for r in rows] for cid, rows in radar_raw.items()}
    out = os.path.join(os.path.dirname(__file__), "..", "web", "demo-network.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"projects": projects, "orgs": orgs, "radar": radar, "updatedAt": "2026-11-02T04:41:00+00:00"}, f, ensure_ascii=False)
    print(f"network demo: {len(projects)} projects, {len(orgs)} organisations, radar for {len(radar)} calls")


if __name__ == "__main__":
    build()
