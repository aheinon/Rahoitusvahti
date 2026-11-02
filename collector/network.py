"""Partner network and consortium radar from CORDIS open data (run weekly).

CORDIS publishes every EU-funded Horizon Europe and Horizon 2020 project as zipped CSV files
(checked on 2 Nov 2026, both updated monthly):
  https://cordis.europa.eu/data/cordis-HORIZONprojects-csv.zip   (~38 MB)
  https://cordis.europa.eu/data/cordis-h2020projects-csv.zip      (~55 MB)
Each has project.csv (id, acronym, title, topics, startDate, endDate, objective ...) and
organization.csv (projectID, organisationID, name, country, city, geolocation "lat,lon",
activityType HES/REC/PRC/PUB/OTH, role coordinator/participant ...). Separator ';', quoted.

This script writes to Firestore:
- network/projects   every project Turku UAS (organisation id `tuas_id`) has taken part in
- network/orgs-0..N  every organisation those projects had, with location and joint projects
- radar/{callId}     for each open or upcoming Horizon Europe call: the funded projects most similar
                     to it, with their consortia ("who won similar calls before")
The app works out which of these are NERC's own projects (marked on the Network tab) and which
organisations the team already knows.

Usage:
  python network.py                      # update Firestore
  python network.py --dry-run net.json   # write to a local file instead
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict

import yaml

sys.path.insert(0, os.path.dirname(__file__))

from common import _session, log  # noqa: E402
from store import Store  # noqa: E402

URLS = {"Horizon Europe": "https://cordis.europa.eu/data/cordis-HORIZONprojects-csv.zip",
        "Horizon 2020": "https://cordis.europa.eu/data/cordis-h2020projects-csv.zip"}
csv.field_size_limit(10_000_000)
STOP = set("""the and for with from that this into are can will its their our which these those such than then also have has
been being more most other over under between through within without about across while where when what who how all any
each both few some new use used using based towards toward european europe project projects research innovation
development developing support solutions solution approach approaches novel including include includes well high
level levels key main aim aims objective objectives action actions activities results result impact impacts""".split())


# ---------- reading CORDIS ----------

def download(url: str) -> str:
    log(f"Downloading {url}")
    fd, path = tempfile.mkstemp(suffix=".zip")
    with os.fdopen(fd, "wb") as f, _session.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        for chunk in r.iter_content(1 << 20):
            f.write(chunk)
    return path


def read_csv(zf: zipfile.ZipFile, name: str):
    member = next(n for n in zf.namelist() if n.endswith(name))
    with zf.open(member) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""), delimiter=";")


def geo(s: str):
    try:
        lat, lon = (float(x) for x in (s or "").split(","))
        return [round(lat, 3), round(lon, 3)]
    except ValueError:
        return None


def load_programme(zf: zipfile.ZipFile, programme: str, tuas_id: str):
    """Returns (projects {id: row}, orgs_by_project {id: [org rows]}, tuas project ids)."""
    projects = {}
    for r in read_csv(zf, "project.csv"):
        projects[r["id"]] = {"pid": r["id"], "acronym": r.get("acronym", ""), "title": r.get("title", ""),
                             "topic": (r.get("topics") or "").split(",")[0].strip(), "start": (r.get("startDate") or "")[:10],
                             "end": (r.get("endDate") or "")[:10], "programme": programme,
                             "objective": (r.get("objective") or "")[:1500]}
    by_project, tuas = defaultdict(list), set()
    for r in read_csv(zf, "organization.csv"):
        by_project[r["projectID"]].append({
            "id": r.get("organisationID", ""), "name": (r.get("name") or "").strip(), "country": r.get("country", ""),
            "city": (r.get("city") or "").strip(), "geo": geo(r.get("geolocation", "")), "type": r.get("activityType", ""),
            "coordinator": r.get("role") == "coordinator"})
        if r.get("organisationID") == tuas_id:
            tuas.add(r["projectID"])
    return projects, by_project, tuas


# ---------- network ----------

def build_network(projects: dict, by_project: dict, tuas_ids: set, tuas_id: str):
    out_projects, orgs = [], {}
    for pid in sorted(tuas_ids, key=lambda p: projects.get(p, {}).get("start", ""), reverse=True):
        p = projects.get(pid)
        if not p:
            continue
        members = by_project.get(pid, [])
        out_projects.append({k: p[k] for k in ("pid", "acronym", "title", "topic", "start", "end", "programme")}
                            | {"tuasCoordinator": any(m["coordinator"] and m["id"] == tuas_id for m in members),
                               "partners": len(members) - 1})
        for m in members:
            if m["id"] == tuas_id:
                continue
            o = orgs.setdefault(m["id"], {k: m[k] for k in ("id", "name", "country", "city", "geo", "type")}
                                | {"projects": [], "coordinated": []})
            if pid not in o["projects"]:
                o["projects"].append(pid)
            if m["coordinator"]:
                o["coordinated"].append(pid)
            if not o["geo"] and m["geo"]:
                o["geo"] = m["geo"]
    return out_projects, sorted(orgs.values(), key=lambda o: (-len(o["projects"]), o["name"]))


# ---------- consortium radar ----------

def tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z][a-z0-9\-]{2,}", (text or "").lower()) if w not in STOP]


def topic_prefix(topic: str) -> str:
    """'HORIZON-CL5-2027-02-D3-15' -> 'HORIZON-CL5'"""
    return "-".join((topic or "").split("-")[:2])


class Index:
    """Small TF-IDF index (cosine similarity) over funded projects."""

    def __init__(self, docs: dict[str, str]):
        self.n = len(docs)
        df = Counter()
        tfs = {}
        for pid, text in docs.items():
            tf = Counter(tokens(text))
            tfs[pid] = tf
            df.update(tf.keys())
        self.idf = {t: math.log((1 + self.n) / (1 + d)) + 1 for t, d in df.items()}
        self.post = defaultdict(list)
        for pid, tf in tfs.items():
            vec = {t: (1 + math.log(c)) * self.idf[t] for t, c in tf.items()}
            norm = math.sqrt(sum(v * v for v in vec.values())) or 1
            for t, v in vec.items():
                self.post[t].append((pid, v / norm))

    def search(self, text: str) -> dict[str, float]:
        tf = Counter(tokens(text))
        vec = {t: (1 + math.log(c)) * self.idf.get(t, 0) for t, c in tf.items() if t in self.idf}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1
        scores = defaultdict(float)
        for t, v in vec.items():
            for pid, w in self.post[t]:
                scores[pid] += (v / norm) * w
        return scores


def build_radar(calls: list[dict], projects: dict, by_project: dict, top: int = 4, min_score: float = 0.15) -> dict:
    he = {pid: p for pid, p in projects.items() if p["programme"] == "Horizon Europe"}
    index = Index({pid: f"{p['title']} {p['title']} {p['objective']}" for pid, p in he.items()})
    radar = {}
    for c in calls:
        topic = c["id"].split(":", 1)[-1]
        scores = index.search(" ".join([c.get("title", ""), c.get("title", ""), c.get("aiSummary") or "", c.get("summary") or ""]))
        ranked = []
        for pid, s in scores.items():
            p = he[pid]
            same = p["topic"] == topic
            s += 0.5 if same else 0.08 if topic_prefix(p["topic"]) == topic_prefix(topic) else 0
            if s >= min_score:
                ranked.append((s, same, pid))
        items = []
        for s, same, pid in sorted(ranked, reverse=True)[:top]:
            p = he[pid]
            members = sorted(by_project.get(pid, []), key=lambda m: not m["coordinator"])
            items.append({"pid": pid, "acronym": p["acronym"], "title": p["title"][:160], "topic": p["topic"],
                          "year": p["start"][:4], "sameTopic": same, "score": round(min(s, 1.0), 2),
                          "partners": [{k: m[k] for k in ("id", "name", "country", "type", "coordinator")} for m in members[:45]],
                          "size": len(members)})
        if items:
            radar[c["id"]] = items
    return radar


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", metavar="FILE")
    args = ap.parse_args()
    with open(os.path.join(os.path.dirname(__file__), "config.yaml"), encoding="utf-8") as f:
        cfg = (yaml.safe_load(f) or {}).get("network", {})
    tuas_id = str(cfg.get("organisation_id", "948193431"))

    projects, by_project, tuas = {}, {}, set()
    for programme, url in URLS.items():
        path = download(url)
        try:
            with zipfile.ZipFile(path) as zf:
                p, b, t = load_programme(zf, programme, tuas_id)
        finally:
            os.remove(path)
        projects.update(p)
        by_project.update(b)
        tuas |= t
        log(f"{programme}: {len(p)} projects, {len(t)} with our organisation")

    net_projects, net_orgs = build_network(projects, by_project, tuas, tuas_id)
    log(f"Network: {len(net_projects)} projects, {len(net_orgs)} partner organisations")

    store = Store(args.dry_run + ".calls.json" if args.dry_run else None)
    calls = [c for c in store.load_previous().values()
             if c.get("source") == "eu" and c.get("status") != "closed" and str(c.get("id", "")).startswith("eu:HORIZON")]
    radar = build_radar(calls, projects, by_project, int(cfg.get("radar_projects", 4)), float(cfg.get("radar_min_score", 0.15)))
    log(f"Radar: similar funded projects found for {len(radar)} of {len(calls)} Horizon Europe calls")

    if args.dry_run:
        with open(args.dry_run, "w", encoding="utf-8") as f:
            json.dump({"projects": net_projects, "orgs": net_orgs, "radar": radar}, f, ensure_ascii=False)
        return 0
    store.save_network(net_projects, net_orgs, radar)
    return 0


if __name__ == "__main__":
    sys.exit(main())
