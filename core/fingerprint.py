"""Grouping: collapse many crash events into one issue.

The fingerprint must stay stable across cosmetic change (a different user id in
the message, an edit that shifts line numbers) while still separating genuinely
different bugs. Everything here is pure so it can be tested without a database.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import List, Optional

# Frames from these paths are framework/vendor noise: they are identical across
# unrelated bugs, so grouping on them would merge everything into one issue.
VENDOR_MARKERS = (
    "node_modules",
    "/dist/",
    "webpack-internal",
    "chrome-extension://",
    "<anonymous>",
)

# Order matters: UUID and hex before the bare-integer rule, or the integer rule
# eats their digits first and the two stop collapsing to the same placeholder.
_NORMALISERS = (
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I), "<uuid>"),
    (re.compile(r"\b0x[0-9a-f]+\b", re.I), "<hex>"),
    (re.compile(r"\b[0-9a-f]{32,}\b", re.I), "<hash>"),
    (re.compile(r"'[^']*'"), "<str>"),
    (re.compile(r'"[^"]*"'), "<str>"),
    (re.compile(r"\b\d[\d,.]*\b"), "<int>"),
    (re.compile(r"(/[\w.\-]+){2,}"), "<path>"),
)


@dataclass
class Frame:
    function: Optional[str] = None
    module: Optional[str] = None
    filename: Optional[str] = None
    lineno: Optional[int] = None
    colno: Optional[int] = None

    @property
    def in_app(self) -> bool:
        haystack = (self.filename or self.module or "").lower()
        return bool(haystack) and not any(m in haystack for m in VENDOR_MARKERS)


@dataclass
class ParsedEvent:
    type: str = "Error"
    value: str = ""
    frames: List[Frame] = field(default_factory=list)


def normalise_message(message: str) -> str:
    """Replace variable data with placeholders so one bug yields one string."""
    out = message.strip()
    for pattern, placeholder in _NORMALISERS:
        out = pattern.sub(placeholder, out)
    return re.sub(r"\s+", " ", out)


def _frame_signature(frame: Frame) -> str:
    # Deliberately excludes lineno/colno: an edit above the throw site shifts
    # every line number, and grouping on them would split one bug into two.
    location = frame.module or frame.filename or "?"
    location = re.sub(r"\?.*$", "", location)            # drop query strings
    location = re.sub(r"[.-][0-9a-f]{6,}(?=\.\w+$)", "", location)  # drop build hashes
    return f"{location}:{frame.function or '?'}"


def compute_fingerprint(event: ParsedEvent) -> str:
    """Derive a stable 16-char group key from the most reliable signal present.

    The exception type always participates: a TypeError and a ReferenceError
    thrown from the same click handler share a top frame but are different
    bugs, and grouping them together hides one behind the other.
    """
    in_app = [f for f in event.frames if f.in_app][:5]
    if in_app:
        basis = [event.type] + [_frame_signature(f) for f in in_app]
    elif event.frames:
        basis = [event.type] + [_frame_signature(f) for f in event.frames[:5]]
    else:
        basis = [event.type, normalise_message(event.value)]

    digest = hashlib.sha256("|".join(basis).encode("utf-8")).hexdigest()
    return digest[:16]


def culprit(event: ParsedEvent) -> str:
    """Human-readable location shown next to the issue title."""
    for frame in event.frames:
        if frame.in_app:
            where = frame.filename or frame.module or "?"
            return f"{where}:{frame.lineno}" if frame.lineno else where
    return event.type
