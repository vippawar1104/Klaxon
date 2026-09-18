"""Per-project token bucket.

The design calls for Redis so the limit holds across processes. This is the
single-process equivalent: identical semantics, no infrastructure. Swapping the
store for Redis later only changes `_take`.
"""

import threading
import time
from dataclasses import dataclass
from typing import Dict, Tuple, Union

# Generous by default. A crash loop is exactly the traffic this product exists
# to absorb and group, so the limit is set to stop a pathological client from
# exhausting the service — not to meter normal load. An earlier 200/s default
# rejected 40% of a routine 1,500-event burst.
DEFAULT_RATE = 2000.0  # tokens added per second
DEFAULT_BURST = 5000.0  # tokens the bucket can hold


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    def __init__(self, rate: float = DEFAULT_RATE, burst: float = DEFAULT_BURST) -> None:
        self.rate = rate
        self.burst = burst
        # Keyed by project id for ingest, by source address for credentials.
        self._buckets: Dict[Union[int, str], _Bucket] = {}
        self._lock = threading.Lock()

    def _take(self, key: Union[int, str], now: float) -> Tuple[bool, float]:
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket(tokens=self.burst, updated=now)
                self._buckets[key] = bucket

            # Refill for the time that passed, capped at the burst size.
            elapsed = max(0.0, now - bucket.updated)
            bucket.tokens = min(self.burst, bucket.tokens + elapsed * self.rate)
            bucket.updated = now

            if bucket.tokens >= 1:
                bucket.tokens -= 1
                return True, 0.0

            # Seconds until one token is available again.
            return False, (1 - bucket.tokens) / self.rate

    def allow(self, key: Union[int, str]) -> Tuple[bool, int]:
        """Returns (allowed, retry_after_seconds)."""
        allowed, wait = self._take(key, time.monotonic())
        return allowed, max(1, int(wait + 0.999))

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


limiter = RateLimiter()

# Credential endpoints need the opposite posture to ingest. Ingest is generous
# because a crash loop is the traffic this product exists to absorb; login is
# tight because the only client sending thousands of attempts is guessing
# passwords. Keyed per source address rather than per account, so one attacker
# cannot be spread across many usernames — and so locking a victim out of their
# own account by hammering it is not possible either.
#
# Sized for a shared address, not a single person: an office or campus behind
# one NAT arrives as one key, so a burst tight enough to be interesting against
# a single attacker would lock out everyone signing in at 9am. 20 covers that
# opening rush; the slow refill is what makes sustained guessing pointless —
# roughly 43k attempts a day against PBKDF2 at 260k iterations gets nowhere.
AUTH_RATE = 0.5  # a sustained attempt every 2 seconds
AUTH_BURST = 20  # enough that real people never notice it

auth_limiter = RateLimiter(rate=AUTH_RATE, burst=AUTH_BURST)

# Public feedback form: no login required, so the only defense against a bot
# flooding it is the source address. Burst allows someone to fix a typo and
# resubmit without hitting a wall; the slow refill is what stops a script.
FEEDBACK_RATE = 1 / 30  # one submission every 30 seconds, sustained
FEEDBACK_BURST = 5

feedback_limiter = RateLimiter(rate=FEEDBACK_RATE, burst=FEEDBACK_BURST)
