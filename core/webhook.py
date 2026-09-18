"""The one place that actually sends a webhook POST.

Both alert delivery and feedback notifications go through this — one place
that validates the target and makes the HTTP call, rather than two copies of
the same SSRF check and the same timeout handling drifting apart over time.
"""

import json
import logging
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Sequence, Tuple

from core.urlguard import check_webhook_url

logger = logging.getLogger(__name__)

TIMEOUT = 5

# Delivery runs off the worker's main loop, in parallel, so N slow webhooks
# cost roughly TIMEOUT total instead of N * TIMEOUT serially. Small on purpose
# — this is notification fan-out, not a request-serving pool.
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="klaxon-webhook")


def deliver(url: str, payload: dict) -> Tuple[bool, str]:
    """POST payload to url. Returns (delivered, reason) — reason is empty on
    success, and worth logging (not necessarily to the caller) on failure."""
    allowed, why = check_webhook_url(url)
    if not allowed:
        return False, why

    body = json.dumps(payload).encode()
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT):
            return True, ""
    except Exception as e:
        return False, str(e)


def deliver_many(items: Sequence[Tuple[str, dict]]) -> list[Tuple[bool, str]]:
    """Deliver a batch in parallel. Same order as `items`."""
    if not items:
        return []
    return list(_pool.map(lambda it: deliver(*it), items))
