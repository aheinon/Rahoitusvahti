"""Network and consortium radar from CORDIS-format files (headers as in the 8 Oct 2026 release)."""
import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import network  # noqa: E402

PROJ_H = '"id";"acronym";"status";"title";"startDate";"endDate";"totalCost";"ecMaxContribution";"topics";"ecSignatureDate";"frameworkProgramme";"masterCall";"subCall";"fundingScheme";"nature";"objective";"contentUpdateDate";"rcn";"grantDoi";"keywords";"Human-validated";"legalBasis"'
ORG_H = '"projectID";"projectAcronym";"organisationID";"vatNumber";"name";"shortName";"SME";"activityType";"street";"postCode";"city";"country";"nutsCode";"geolocation";"organizationURL";"contactForm";"contentUpdateDate";"rcn";"order";"role";"ecContribution";"netEcContribution";"totalCost";"endOfParticipation";"active"'


def proj(pid, acr, title, topic, start, objective):
    return ";".join(f'"{x}"' for x in [pid, acr, "SIGNED", title, start, "2029-01-31", "1", "1", topic, "", "HORIZON", "", "", "HORIZON-IA", "", objective, "", "", "", "", "", ""])


def org(pid, acr, oid, name, country, city, geo, typ, role):
    return ";".join(f'"{x}"' for x in [pid, acr, oid, "", name, "", "false", typ, "", "", city, country, "", geo, "", "", "", "", "1", role, "1", "1", "1", "false", ""])


def make_zip(path):
    projects = [PROJ_H,
                proj("101269394", "SUNVIBE", "Smart Upgraded iNverter architectures for PV-based systems", "HORIZON-CL5-2025-02-D3-11", "2026-05-01",
                     "Grid-forming photovoltaic inverters with storage; ""quoted"" text;\nsecond line"),
                proj("101269551", "ALLEGRO", "Alternative silicon wafer growth for low-cost high-efficiency photovoltaics", "HORIZON-CL5-2025-02-D3-09", "2026-01-01",
                     "Photovoltaic manufacturing in Europe: wafers, cells and modules production lines."),
                proj("101319030", "MISTRAL", "Digital platform for battery ageing validation", "HORIZON-CL5-2026-01-D2-05", "2026-11-01",
                     "Battery ageing and reliability testing.")]
    orgs = [ORG_H,
            org("101269394", "SUNVIBE", "999516907", "FUNDACION CIRCE", "ES", "Zaragoza", "41.66,-0.88", "REC", "coordinator"),
            org("101269394", "SUNVIBE", "948193431", "TURUN AMMATTIKORKEAKOULU OY", "FI", "Turku", "60.45148,22.26869", "HES", "participant"),
            org("101269394", "SUNVIBE", "881684411", "SOLARIGO SYSTEMS OY", "FI", "Pirkkala", "61.45,23.69", "PRC", "participant"),
            org("101269551", "ALLEGRO", "999455603", "INSTITUTT FOR ENERGITEKNIKK", "NO", "Kjeller", "59.97,11.05", "REC", "coordinator"),
            org("101269551", "ALLEGRO", "881684411", "SOLARIGO SYSTEMS OY", "FI", "Pirkkala", "", "PRC", "participant"),
            org("101319030", "MISTRAL", "928030235", "FUNDACIO EURECAT", "ES", "Barcelona", "41.4,2.2", "REC", "coordinator")]
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("project.csv", "\n".join(projects) + "\n")
        zf.writestr("organization.csv", "\n".join(orgs) + "\n")


def test_network_and_radar(tmp_path):
    path = tmp_path / "he.zip"
    make_zip(path)
    with zipfile.ZipFile(path) as zf:
        projects, by_project, tuas = network.load_programme(zf, "Horizon Europe", "948193431")
    assert tuas == {"101269394"} and "second line" in projects["101269394"]["objective"]
    net_projects, orgs = network.build_network(projects, by_project, tuas, "948193431")
    assert [p["acronym"] for p in net_projects] == ["SUNVIBE"] and net_projects[0]["partners"] == 2
    assert {o["name"] for o in orgs} == {"FUNDACION CIRCE", "SOLARIGO SYSTEMS OY"}
    circe = next(o for o in orgs if o["id"] == "999516907")
    assert circe["coordinated"] == ["101269394"] and circe["geo"] == [41.66, -0.88]

    calls = [{"id": "eu:HORIZON-CL5-2027-02-D3-15", "title": "Production technologies for solar photovoltaics",
              "summary": "Photovoltaic manufacturing pilot lines for wafers, cells and modules in Europe."},
             {"id": "eu:HORIZON-CL5-2025-02-D3-11", "title": "Inverters", "summary": "Grid-forming PV inverters"}]
    radar = network.build_radar(calls, projects, by_project, top=2, min_score=0.1)
    assert radar["eu:HORIZON-CL5-2027-02-D3-15"][0]["acronym"] == "ALLEGRO"
    same = radar["eu:HORIZON-CL5-2025-02-D3-11"][0]
    assert same["acronym"] == "SUNVIBE" and same["sameTopic"] and same["partners"][0]["coordinator"]
    assert "MISTRAL" not in [r["acronym"] for r in radar["eu:HORIZON-CL5-2027-02-D3-15"]]


def test_topic_prefix_and_tokens():
    assert network.topic_prefix("HORIZON-MISS-2027-04-CIT-01") == "HORIZON-MISS"
    assert "photovoltaics" in network.tokens("The photovoltaics project for Europe")
    assert "project" not in network.tokens("The photovoltaics project for Europe")
