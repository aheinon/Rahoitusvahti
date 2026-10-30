"""Rahoitusvahti - collector entry point.

Usage:
  python main.py                        # collect and save to Firestore
  python main.py --dry-run out.json     # collect and save to a local file (for testing)
  python main.py --only eu,aka          # selected sources only
"""
from __future__ import annotations

import argparse
import os
import sys
import traceback
from datetime import date, timedelta

import yaml

sys.path.insert(0, os.path.dirname(__file__))

from common import TODAY, log  # noqa: E402
import relevance_profile as prof  # noqa: E402
from scoring import AiScorer, keyword_score  # noqa: E402
from sources import akatemia, business_finland, eu_ft, eura, interreg  # noqa: E402
from store import Store  # noqa: E402

SOURCES = {
    "eu": eu_ft.collect,
    "bf": business_finland.collect,
    "aka": akatemia.collect,
    "eura": eura.collect,
    "interreg": interreg.collect,
}


def merge(fresh: list, prev: dict, ok_sources: set, scorer: AiScorer, profile: dict, retention: int) -> list[dict]:
    today = TODAY.isoformat()
    out: dict[str, dict] = {}

    # 1) decide which calls Claude should (re)assess, then assess them in parallel
    staged, to_score = [], []
    for call in fresh:
        kw = keyword_score(call, profile)
        old = prev.get(call.id, {})
        unchanged = old.get("hash") == call.content_hash()
        # Score again when the call changed, when the profile changed, or when an older record has no summary
        current = unchanged and "aiScore" in old and "aiSummary" in old and old.get("aiProfile") == scorer.version
        staged.append((call, kw, old, unchanged))
        if not current and scorer.should_score(call, kw, planned=len(to_score)):
            to_score.append(call)
    results = scorer.score_many(to_score)

    # 2) build the records
    for call, kw, old, unchanged in staged:
        rec = call.to_record()
        rec["firstSeen"] = old.get("firstSeen", today)
        rec["lastSeen"] = today
        rec["kwScore"] = kw
        ai = results.get(call.id) or {}
        if not ai and "aiScore" in old:
            # keep the previous assessment (unchanged call, AI off, or this run's budget used up)
            for k in ("aiScore", "aiReason", "aiTags", "aiEligible", "aiSummary", "aiProfile"):
                if k in old:
                    rec[k] = old[k]
            if unchanged:
                for k in ("deadline", "opens"):      # dates filled in by Claude are kept
                    if not rec.get(k) and old.get(k):
                        rec[k] = old[k]
        if ai:
            rec["aiScore"] = ai.get("score")
            rec["aiReason"] = ai.get("reason", "")
            rec["aiTags"] = ai.get("tags", [])[:5]
            rec["aiEligible"] = ai.get("eligible", "")
            rec["aiProfile"] = scorer.version
            summary = ai.get("summary")
            rec["aiSummary"] = str(summary).strip()[:700] if summary and str(summary).lower() != "null" else None
            if not rec.get("deadline") and ai.get("deadline") and ai["deadline"] >= today:
                rec["deadline"] = ai["deadline"]
                rec["deadlines"] = [ai["deadline"]]
            if not rec.get("opens") and ai.get("opens"):
                rec["opens"] = ai["opens"]
            if ai.get("continuous") and not rec.get("deadline"):
                rec["continuous"] = True
        rec["relevance"] = rec.get("aiScore") if rec.get("aiScore") is not None else min(100, max(0, kw * 8))
        out[rec["id"]] = rec

    # Calls seen last time but missing now
    cutoff = (date.today() - timedelta(days=retention)).isoformat()
    for cid, old in prev.items():
        if cid in out:
            continue
        src = old.get("source")
        if src not in ok_sources:
            out[cid] = old                       # source failed -> keep as it was
        elif (old.get("lastSeen") or today) >= cutoff:
            old = dict(old)
            old["status"] = "closed"            # gone from the source -> closed
            out[cid] = old
    return sorted(out.values(), key=lambda r: (r.get("deadline") or "9999", r["title"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", metavar="FILE")
    ap.add_argument("--only")
    args = ap.parse_args()

    with open(os.path.join(os.path.dirname(__file__), "config.yaml"), encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    store = Store(args.dry_run)
    prev = store.load_previous()
    log(f"Previously stored calls: {len(prev)}")

    wanted = set(args.only.split(",")) if args.only else set(SOURCES)
    fresh, ok, errors, counts = [], set(), {}, {}
    for name, fn in SOURCES.items():
        scfg = cfg["sources"].get(name, {})
        if name not in wanted or not scfg.get("enabled", True):
            continue
        try:
            calls = fn(scfg)
            fresh.extend(calls)
            ok.add(name)
            counts[name] = len(calls)
        except Exception as e:
            errors[name] = f"{type(e).__name__}: {e}"
            log(f"ERROR in source {name}: {e}")
            traceback.print_exc()

    # Relevance profile: Firestore settings/profile (edited in the app); config.yaml seeds it on the first run
    doc = store.load_profile()
    if not doc:
        doc = prof.to_doc(cfg["profile"])
        store.seed_profile(doc)
        log("Profile: seeded settings/profile from config.yaml")
    profile = prof.from_doc(doc)
    log(f"Profile: {len(profile['keywords'])} keywords, {len(profile['negative'])} negative, "
        f"last edited by {doc.get('updatedBy', 'config.yaml')}")

    scorer = AiScorer(cfg.get("ai", {}), profile)
    items = merge(fresh, prev, ok, scorer, profile, cfg.get("retention_days_after_close", 60))
    meta = {"counts": counts, "errors": errors, "total": len(items),
            "ai": {"scored": scorer.used, "inputTokens": scorer.tokens_in, "outputTokens": scorer.tokens_out}}
    store.save(items, meta)
    log(f"Done: {len(items)} calls saved. Sources: {counts}. Errors: {errors or 'none'}. "
        f"AI: {scorer.used} scored, {scorer.tokens_in} input / {scorer.tokens_out} output tokens")
    return 1 if errors and not ok else 0


if __name__ == "__main__":
    sys.exit(main())
