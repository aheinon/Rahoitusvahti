"""Relevance profile: one format in Firestore (lists, easy to edit in the app), another for scoring (dicts)."""
from __future__ import annotations

import hashlib


def to_doc(cfg_profile: dict) -> dict:
    """config.yaml profile -> Firestore document."""
    def pairs(d):
        # Weights are stored without a sign: the list a word is in says whether it adds or subtracts
        return [{"word": str(k), "weight": abs(float(v))} for k, v in (d or {}).items()]
    return {
        "organisation": " ".join(str(cfg_profile.get("organisation", "")).split()),
        "keywords": pairs(cfg_profile.get("keywords")),
        "negative": pairs(cfg_profile.get("negative")),
    }


def from_doc(doc: dict) -> dict:
    """Firestore document -> profile used by scoring. Negative weights are always negative."""
    def to_dict(items, sign):
        out = {}
        for it in items or []:
            word = str(it.get("word", "")).strip().lower()
            try:
                weight = abs(float(it.get("weight", 0)))
            except (TypeError, ValueError):
                continue
            if word and weight:
                out[word] = sign * weight
        return out
    return {
        "organisation": str(doc.get("organisation", "")).strip(),
        "keywords": to_dict(doc.get("keywords"), 1),
        "negative": to_dict(doc.get("negative"), -1),
    }


def ai_version(profile: dict) -> str:
    """Changes when the organisation description changes, so Claude re-assesses every call."""
    return hashlib.sha1(profile.get("organisation", "").encode("utf-8")).hexdigest()[:10]
