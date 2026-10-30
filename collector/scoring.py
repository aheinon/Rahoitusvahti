"""Relevance scoring: keywords always, Claude when an API key is set."""
from __future__ import annotations

import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from common import Call, log
from relevance_profile import ai_version

AI_PROMPT = """You assess how relevant a funding call is for the organisation described below.

ORGANISATION:
{org}

FUNDING CALL:
Funder: {funder} / {programme}
Title: {title}
Identifier: {call_id}
Type of action: {action_type}
Status: {status}, opens {opens}, deadline {deadline}
Text (shortened, may be in Finnish or English):
{text}

Reply with ONLY a JSON object, no other text:
{{"summary": "<2-3 plain sentences in English: what the call funds, who can apply or take part, and the size or type of funding if stated. Use only the text above; null if it says too little>",
  "score": <0-100, how well the call fits the organisation>,
  "reason": "<1-2 short sentences in English: why it fits or does not>",
  "tags": ["<2-5 short topic tags in English>"],
  "eligible": "<yes | no | unclear - can a university of applied sciences / research organisation be an applicant or partner>",
  "deadline": "<YYYY-MM-DD if the text states a deadline missing above, otherwise null>",
  "opens": "<YYYY-MM-DD or null>",
  "continuous": <true if the call is continuous/rolling, otherwise false>}}"""


def keyword_score(call: Call, profile: dict) -> int:
    title = call.title.lower()
    body = " ".join([call.summary, call.detail_text[:3000], " ".join(call.auto_tags), call.region]).lower()
    score = 0
    for word, w in {**profile.get("keywords", {}), **profile.get("negative", {})}.items():
        word = word.lower()
        if word in title:
            score += 2 * w
        elif word in body:
            score += w
    return score


def _parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


class AiScorer:
    def __init__(self, cfg: dict, profile: dict):
        self.enabled = bool(os.environ.get("ANTHROPIC_API_KEY"))
        self.model = cfg.get("model", "claude-haiku-5-5")
        self.budget = int(cfg.get("max_calls_per_run", 700))
        self.eu_min = int(cfg.get("eu_min_keyword_score", 0))
        self.org = profile.get("organisation", "")
        self.version = ai_version(profile)
        self.used = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.workers = int(cfg.get("parallel_requests", 8))
        self._lock = threading.Lock()
        if self.enabled:
            import anthropic
            # retries back off on rate limits (new API accounts have low limits); no request may hang
            self.client = anthropic.Anthropic(max_retries=6, timeout=90)
        else:
            log("AI scoring off (ANTHROPIC_API_KEY not set) - using keyword scores")

    def should_score(self, call: Call, kw: int, planned: int = 0) -> bool:
        if not self.enabled or self.used + planned >= self.budget:
            return False
        if call.source == "eu" and kw < self.eu_min:
            return False
        return True

    def score_many(self, calls: list) -> dict:
        """Scores calls in parallel. Returns {call.id: result}."""
        if not calls:
            return {}
        log(f"AI: assessing {len(calls)} calls, {self.workers} at a time")
        out = {}
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = {pool.submit(self.score, c): c for c in calls}
            for i, fut in enumerate(as_completed(futures), 1):
                out[futures[fut].id] = fut.result()
                if i % 50 == 0 or i == len(calls):
                    log(f"AI: {i}/{len(calls)} done")
        return out

    def score(self, call: Call) -> dict:
        with self._lock:
            self.used += 1
        prompt = AI_PROMPT.format(
            org=self.org, funder=call.funder, programme=call.programme, title=call.title,
            call_id=call.call_id or "-", action_type=call.action_type or "-", status=call.status,
            opens=call.opens or "?", deadline=call.next_deadline or call.deadline_text or "?",
            text=(call.detail_text or call.summary)[:5000],
        )
        try:
            msg = self.client.messages.create(
                model=self.model, max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            with self._lock:
                self.tokens_in += msg.usage.input_tokens
                self.tokens_out += msg.usage.output_tokens
            data = _parse_json(msg.content[0].text)
            data["score"] = max(0, min(100, int(data.get("score", 0))))
            return data
        except Exception as e:
            log(f"  AI scoring failed ({call.id}): {e}")
            return {}
