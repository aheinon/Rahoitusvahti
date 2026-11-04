"""describe.py: who gets a description, the name key, and cleaning Claude's answer (no network)."""
import os
import sys
from types import SimpleNamespace as NS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import describe  # noqa: E402


def test_norm_name_matches_app():
    # same as normName in web/portfolio.js
    assert describe.norm_name("Åbo Akademi (ÅA)") == "ABO AKADEMI AA"
    assert describe.norm_name("  Fundación CIRCE ") == "FUNDACION CIRCE"
    assert describe.norm_name("Valonia / Turun kaupunki") == "VALONIA TURUN KAUPUNKI"


def data():
    return {
        "portfolio": {"projects": [
            {"id": "a1", "acronym": "SUNVIBE", "title": "x", "instrument": "Horizon Europe", "start": 2026, "nerc": True,
             "partners": [["Solarigo Systems Oy", "partner"]]},
            {"id": "b2", "acronym": "HEALTH", "title": "y", "instrument": "ESR", "start": 2022, "nerc": False,
             "partners": [["Hospital District", "partner"], ["Valonia", "partner"]]}],
            "orgs": [{"name": "Hospital District", "type": "PUB", "intl": False, "energy": 0, "projects": 1, "variants": []},
                     {"name": "Valonia", "type": "PUB", "intl": False, "energy": 3, "projects": 5, "variants": ["Valonia (Turku)"]},
                     {"name": "Solarigo Systems Oy", "type": "PRC", "intl": False, "energy": 0, "projects": 1, "variants": []}]},
        "network": {"projects": [{"pid": "1", "acronym": "SUNVIBE"}, {"pid": "2", "acronym": "OTHER"}],
                    "orgs": [{"name": "SOLARIGO SYSTEMS OY", "country": "FI", "type": "PRC", "projects": ["1"]},
                             {"name": "FUNDACION CIRCE", "country": "ES", "type": "REC", "projects": ["1"]},
                             {"name": "RANDOM GMBH", "country": "DE", "type": "PRC", "projects": ["2"]}]},
        "netProjects": [{"id": "m1", "kind": "manual", "name": "CoVE", "partners": [{"name": "Omnia", "country": "FI"}, {"name": "Valonia"}]}],
        "partners": [{"name": "Fortum"}]}


def test_select_energy_scope():
    names = [o["name"] for o in describe.select(data())]
    # CORDIS partners of NERC projects (acronym matches a NERC register project), register energy
    # partners, the team's partner list; the register's Solarigo is the same as CORDIS's
    assert names == ["SOLARIGO SYSTEMS OY", "FUNDACION CIRCE", "Valonia", "Fortum", "Omnia"]
    valonia = next(o for o in describe.select(data()) if o["name"] == "Valonia")
    assert valonia["country"] == "FI" and valonia["alt"] == ["Valonia (Turku)"] and valonia["projects"] == ["HEALTH (ESR, 2022)"]
    assert len(describe.select(data(), "all")) == 7


def test_select_respects_team_untick():
    d = data()
    d["netProjects"].append({"id": "pf-a1", "nerc": False})          # the team said SUNVIBE is not ours
    names = [o["name"] for o in describe.select(d)]
    assert "FUNDACION CIRCE" not in names and "Valonia" in names


def test_clean():
    ok = describe.clean({"found": True, "official_name": "Fundación CIRCE", "website": "https://www.fcirce.es",
                         "description": "A research centre.", "city": "Zaragoza", "country": "es", "lat": 41.65, "lon": -0.88,
                         "type": "REC"}, ["https://www.fcirce.es", "https://en.wikipedia.org/wiki/CIRCE"], "m")
    assert ok["country"] == "ES" and ok["sources"] == ["https://www.fcirce.es", "https://en.wikipedia.org/wiki/CIRCE"]
    assert ok["lat"] == 41.65 and ok["type"] == "REC" and "notFound" not in ok
    bad = describe.clean({"found": True, "website": "javascript:x", "lat": 200, "lon": 0, "type": "X"}, [], "m")
    assert bad["website"] == "" and bad["lat"] is None and bad["type"] == ""
    assert describe.clean({"found": True, "person": True}, [], "m")["notFound"]
    assert describe.clean({}, [], "m")["notFound"]
    meta = "A Bulgarian company. Its activities could not be confirmed because the search tool reached its usage limit."
    assert describe.clean({"found": True, "description": meta}, [], "m")["notFound"]


def test_describer_parses_response():
    d = describe.Describer.__new__(describe.Describer)
    d.model, d.max_uses, d.tool, d.searches, d.tokens_in, d.tokens_out = "m", 3, "web_search_20260209", 0, 0, 0
    import threading
    d.lock = threading.Lock()
    calls = []

    def create(**kw):
        calls.append(kw)
        if kw["tools"][0]["type"] == "web_search_20260209":
            raise RuntimeError("tools.0: unknown tool type web_search_20260209")
        return NS(usage=NS(input_tokens=10, output_tokens=5, server_tool_use=NS(web_search_requests=2)), content=[
            NS(type="server_tool_use"),
            NS(type="web_search_tool_result", content=[NS(url="https://valonia.fi"), NS(url="https://turku.fi")]),
            NS(type="text", text='Here: {"found": true, "website": "https://valonia.fi", "description": "Regional service centre.", '
                                 '"city": "Turku", "country": "FI", "lat": 60.45, "lon": 22.27, "type": "PUB"}')])
    d.client = NS(messages=NS(create=create))
    r = d.describe({"name": "Valonia", "alt": [], "country": "FI", "type": "PUB", "projects": ["X (ESR, 2022)"]})
    assert len(calls) == 2 and d.tool == "web_search_20250305" and d.searches == 2
    assert r["website"] == "https://valonia.fi" and r["sources"] == ["https://valonia.fi", "https://turku.fi"]
    assert "Valonia" in calls[0]["messages"][0]["content"]
