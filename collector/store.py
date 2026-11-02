"""Storage in Firestore (or a local JSON file in a dry run).

Data model:
- index/calls-0, calls-1, ...  {items: [...], part, parts, updatedAt}
    All calls packed into a few documents, so the app reads the whole list with 1-3 reads
    (well within Firestore's free quota).
- meta/collector  {lastRun, counts, errors, ai}
- ratings/{callId}__{email}  {callId, email, v: 1 | 0 | -1, reason, at}
    Team members' "is this relevant?" answers. The collector shows recent ones to Claude as examples.
- texts/{callId}  {text, updatedAt}
    The full text of each call (as read from the funder's page), for Claude's analysis of a linked
    project idea. Written only when the text changes. ('/' in ids is stored as '∕'.)
- network/projects, network/orgs-N, radar/{callId}
    Written weekly by network.py from CORDIS: Turku UAS's EU projects and partners, and for each open
    Horizon Europe call the most similar funded projects with their consortia.
- settings/profile  {organisation, keywords: [{word, weight}], negative: [{word, weight}], updatedAt, updatedBy}
    The relevance profile, edited by admins in the app. Seeded from config.yaml on the first run.
Team annotations (favourites, tags, comments, partners) live in their own collections,
which the collector never touches.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

CHUNK_BYTES = 700_000  # Firestore document limit is 1 MiB


class Store:
    def __init__(self, dry_run_path: str | None = None):
        self.dry = dry_run_path
        self.db = None
        if not self.dry:
            import firebase_admin
            from firebase_admin import credentials, firestore
            sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
            if not sa:
                raise SystemExit("FIREBASE_SERVICE_ACCOUNT is not set (GitHub secret)")
            firebase_admin.initialize_app(credentials.Certificate(json.loads(sa)))
            self.db = firestore.client()

    def load_previous(self) -> dict[str, dict]:
        if self.dry:
            if os.path.exists(self.dry):
                with open(self.dry, encoding="utf-8") as f:
                    return {c["id"]: c for c in json.load(f).get("items", [])}
            return {}
        out = {}
        for doc in self.db.collection("index").stream():
            if doc.id.startswith("calls-"):
                for c in doc.to_dict().get("items", []):
                    out[c["id"]] = c
        return out

    def load_profile(self) -> dict | None:
        """The profile document from Firestore, or None (dry run, or not created yet)."""
        if self.dry:
            return None
        snap = self.db.collection("settings").document("profile").get()
        return snap.to_dict() if snap.exists else None

    def save_texts(self, texts: dict[str, str]) -> None:
        if not texts:
            return
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if self.dry:
            path = self.dry.rsplit(".", 1)[0] + ".texts.json"
            old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
            with open(path, "w", encoding="utf-8") as f:
                json.dump({**old, **texts}, f, ensure_ascii=False, indent=1)
            return
        items = list(texts.items())
        for i in range(0, len(items), 400):           # a batch takes at most 500 writes
            batch = self.db.batch()
            for cid, text in items[i:i + 400]:
                batch.set(self.db.collection("texts").document(cid.replace("/", "∕")), {"text": text[:20000], "updatedAt": now})
            batch.commit()

    def save_network(self, projects: list, orgs: list, radar: dict) -> None:
        """network/projects, network/orgs-N (chunks under the document size limit) and radar/{callId}."""
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        col = self.db.collection("network")
        chunks, cur, size = [], [], 0
        for o in orgs:
            s = len(json.dumps(o, ensure_ascii=False).encode())
            if cur and size + s > CHUNK_BYTES:
                chunks.append(cur)
                cur, size = [], 0
            cur.append(o)
            size += s
        if cur:
            chunks.append(cur)
        batch = self.db.batch()
        batch.set(col.document("projects"), {"items": projects, "orgParts": len(chunks), "updatedAt": now})
        for i, ch in enumerate(chunks):
            batch.set(col.document(f"orgs-{i}"), {"items": ch, "updatedAt": now})
        batch.commit()
        items = list(radar.items())
        for i in range(0, len(items), 400):
            batch = self.db.batch()
            for cid, rows in items[i:i + 400]:
                batch.set(self.db.collection("radar").document(cid.replace("/", "∕")), {"items": rows, "updatedAt": now})
            batch.commit()

    def load_feedback(self) -> dict:
        """The team's relevance ratings (ratings/{callId}__{email}) and pipeline stages (notes/{callId})."""
        if self.dry:
            return {"ratings": [], "notes": {}}
        ratings = [d.to_dict() for d in self.db.collection("ratings").stream()]
        notes = {d.id.replace("∕", "/"): {"stage": (d.to_dict() or {}).get("stage"), "updatedAt": (d.to_dict() or {}).get("updatedAt")}
                 for d in self.db.collection("notes").stream()}
        return {"ratings": ratings, "notes": notes}

    def seed_profile(self, doc: dict) -> None:
        if self.dry:
            return
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.db.collection("settings").document("profile").set({**doc, "updatedAt": now, "updatedBy": "config.yaml"})

    def save(self, items: list[dict], meta: dict) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if self.dry:
            with open(self.dry, "w", encoding="utf-8") as f:
                json.dump({"items": items, "meta": {**meta, "lastRun": now}}, f, ensure_ascii=False, indent=1)
            return
        chunks, cur, size = [], [], 0
        for it in items:
            s = len(json.dumps(it, ensure_ascii=False).encode())
            if cur and size + s > CHUNK_BYTES:
                chunks.append(cur)
                cur, size = [], 0
            cur.append(it)
            size += s
        if cur:
            chunks.append(cur)
        batch = self.db.batch()
        for i, ch in enumerate(chunks):
            batch.set(self.db.collection("index").document(f"calls-{i}"),
                      {"items": ch, "part": i, "parts": len(chunks), "updatedAt": now})
        # delete leftover old chunks
        for doc in self.db.collection("index").stream():
            if doc.id.startswith("calls-") and int(doc.id.split("-")[1]) >= len(chunks):
                batch.delete(doc.reference)
        batch.set(self.db.collection("meta").document("collector"), {**meta, "lastRun": now})
        batch.commit()
