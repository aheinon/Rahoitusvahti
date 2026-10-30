"""Storage in Firestore (or a local JSON file in a dry run).

Data model:
- index/calls-0, calls-1, ...  {items: [...], part, parts, updatedAt}
    All calls packed into a few documents, so the app reads the whole list with 1-3 reads
    (well within Firestore's free quota).
- meta/collector  {lastRun, counts, errors, ai}
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
