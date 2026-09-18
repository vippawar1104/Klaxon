"""Parse raw JavaScript stack traces into structured frames.

Browsers disagree on format, so both shapes are handled:

  Chrome / Edge / Node   at renderCart (https://host/cart.js:42:18)
  Firefox / Safari       renderCart@https://host/cart.js:42:18
"""

import re
from typing import List, Optional
from urllib.parse import urlparse

from core.fingerprint import Frame, ParsedEvent

_CHROME = re.compile(
    r"^\s*at\s+(?:(?P<func>[^\s(]+)\s+\()?(?P<loc>[^()]+?)(?::(?P<line>\d+))?(?::(?P<col>\d+))?\)?\s*$"
)
_FIREFOX = re.compile(
    r"^\s*(?P<func>[^@\s]*)@(?P<loc>.+?)(?::(?P<line>\d+))?(?::(?P<col>\d+))?\s*$"
)
_HEADER = re.compile(r"^\s*(?P<type>[A-Za-z_$][\w$.]*(?:Error|Exception|Warning)?)\s*:\s*(?P<value>.*)$")


def _module_of(location: str) -> str:
    """Reduce a frame location to a stable module path.

    Absolute URLs vary by host and deploy, so keep only the path — the part
    that identifies the source file.
    """
    location = location.strip()
    if location.startswith(("http://", "https://")):
        parsed = urlparse(location)
        return parsed.path or location
    return location


def _int(value: Optional[str]) -> Optional[int]:
    return int(value) if value and value.isdigit() else None


def parse_frames(stack: str) -> List[Frame]:
    frames: List[Frame] = []
    for raw in stack.splitlines():
        line = raw.strip()
        if not line or _HEADER.match(line) and not line.startswith("at "):
            # Skip the "TypeError: ..." header line.
            if not line.startswith(("at ", "\tat ")) and "@" not in line:
                continue

        match = _CHROME.match(line) or _FIREFOX.match(line)
        if not match:
            continue

        loc = (match.group("loc") or "").strip()
        if not loc:
            continue

        func = (match.group("func") or "").strip() or None
        if func in ("<anonymous>", "Object.<anonymous>"):
            func = None

        module = _module_of(loc)
        frames.append(
            Frame(
                function=func,
                module=module,
                filename=module.rsplit("/", 1)[-1] or module,
                lineno=_int(match.group("line")),
                colno=_int(match.group("col")),
            )
        )
    return frames


def parse_event(exc_type: str, value: str, stack: Optional[str]) -> ParsedEvent:
    """Build the structure the fingerprinter consumes."""
    return ParsedEvent(
        type=exc_type or "Error",
        value=value or "",
        frames=parse_frames(stack) if stack else [],
    )
