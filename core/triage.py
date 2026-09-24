"""Structured LLM triage: a stack trace in, a validated verdict out.

The model is asked for JSON only; whatever comes back is parsed and checked
against `Triage` before anything downstream sees it. Free text from a model is
untrusted input — it can be fenced, chatty, truncated, or simply wrong-shaped —
so a malformed answer gets one repair attempt (with the validation error
quoted back) and then a hard failure, never a half-parsed result.
"""

import json
import re
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from core.ai_router import AIModelRouter, AIModelUnavailable

Severity = Literal["low", "medium", "high", "critical"]


class Triage(BaseModel):
    root_cause: str = Field(min_length=1, max_length=1500)
    severity: Severity
    suggested_fix: str = Field(min_length=1, max_length=1500)
    # Self-reported and uncalibrated: useful for ordering, not as a probability.
    confidence: float = Field(ge=0.0, le=1.0)


class TriageFailed(RuntimeError):
    """The model answered, but not with a usable verdict, even after a retry."""


SCHEMA_HINT = (
    "Reply with a single JSON object and nothing else — no prose, no code fences. "
    'Keys: "root_cause" (string, the most likely cause), "severity" '
    '("low" | "medium" | "high" | "critical"), "suggested_fix" (string, the single '
    'change most likely to fix it), "confidence" (number from 0 to 1; use a low '
    "value if the trace is insufficient)."
)

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_triage(text: str) -> Triage:
    """Raises ValueError (bad JSON) or ValidationError (bad shape)."""
    cleaned = _FENCE.sub("", text.strip()).strip()
    # Models sometimes wrap the object in a sentence; take the outermost braces.
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end < start:
        raise ValueError("no JSON object found in the reply")
    data = json.loads(cleaned[start : end + 1])
    # Clamp rather than reject: 85 (meaning percent) is a formatting slip, not
    # a reason to throw away an otherwise good verdict.
    conf = data.get("confidence")
    if isinstance(conf, (int, float)) and not isinstance(conf, bool):
        if 1 < conf <= 100:
            conf = conf / 100
        data["confidence"] = min(max(float(conf), 0.0), 1.0)
    return Triage.model_validate(data)


def run_triage(ai: AIModelRouter, prompt: str) -> Triage:
    """One call, plus one repair attempt. Raises AIModelUnavailable if the
    provider is down and TriageFailed if the output stays unusable."""
    full = f"{prompt}\n\n{SCHEMA_HINT}"
    reply = ai.complete(full, max_tokens=1500, json_mode=True)
    try:
        return parse_triage(reply)
    except (ValueError, ValidationError) as first:
        repair = (
            f"{full}\n\nYour previous reply was rejected: {str(first)[:300]}\n"
            "Reply again with only the corrected JSON object."
        )
        reply = ai.complete(repair, max_tokens=1500, json_mode=True)
        try:
            return parse_triage(reply)
        except (ValueError, ValidationError) as second:
            raise TriageFailed(f"model returned an unusable verdict: {str(second)[:200]}") from second


__all__ = ["Triage", "TriageFailed", "AIModelUnavailable", "parse_triage", "run_triage"]
