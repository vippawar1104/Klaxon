#!/usr/bin/env python3
"""Fire realistic crash traffic at a Klaxon ingest endpoint.

Verifies grouping behaviour and measures ingest latency. Every phase of the
build is checked with this — and the numbers it prints are the load-test
figures worth putting in the README.

    python scripts/generate_crashes.py --count 2000 --concurrency 32
"""

import argparse
import json
import random
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

# Each bug has a fixed trace (so it groups) and a message template with varying
# data (so it exercises normalisation). Weights make a few bugs dominate, which
# is how real crash traffic actually looks.
BUGS = [
    {
        "weight": 60,
        "type": "TypeError",
        "template": "Cannot read property 'total' of undefined at user {user}",
        "level": "error",
        "stack": (
            "TypeError: Cannot read property 'total' of undefined\n"
            "    at renderCart (https://shop.example.com/assets/cart.js:42:18)\n"
            "    at checkout (https://shop.example.com/assets/checkout.js:118:5)"
        ),
    },
    {
        "weight": 18,
        "type": "ReferenceError",
        "template": "applyCoupon is not defined",
        "level": "error",
        "stack": (
            "ReferenceError: applyCoupon is not defined\n"
            "    at applyDiscount (https://shop.example.com/assets/pricing.js:88:12)"
        ),
    },
    {
        "weight": 12,
        "type": "TypeError",
        "template": "Failed to fetch /api/inventory/{sku} after {ms} ms",
        "level": "warning",
        "stack": (
            "TypeError: Failed to fetch\n"
            "    at loadInventory (https://shop.example.com/assets/inventory.js:14:7)"
        ),
    },
    {
        "weight": 7,
        "type": "RangeError",
        "template": "Maximum call stack size exceeded",
        "level": "error",
        "stack": (
            "RangeError: Maximum call stack size exceeded\n"
            "    at walkTree (https://shop.example.com/assets/tree.js:31:9)\n"
            "    at walkTree (https://shop.example.com/assets/tree.js:34:11)"
        ),
    },
    {
        # Firefox-format trace for the same bug as the first entry: proves
        # cross-browser traces land in one group, not two.
        "weight": 3,
        "type": "TypeError",
        "template": "Cannot read property 'total' of undefined at user {user}",
        "level": "error",
        "stack": (
            "renderCart@https://shop.example.com/assets/cart.js:42:18\n"
            "checkout@https://shop.example.com/assets/checkout.js:118:5"
        ),
    },
]

BREADCRUMBS = [
    {"category": "click", "message": "button#checkout", "level": "info"},
    {"category": "fetch", "message": "GET /api/cart 200", "level": "info"},
    {"category": "navigation", "message": "/cart -> /checkout", "level": "info"},
]


def build_payload(rng: random.Random) -> dict:
    bug = rng.choices(BUGS, weights=[b["weight"] for b in BUGS], k=1)[0]
    message = bug["template"].format(
        user=rng.randint(1000, 99999),
        sku=uuid.uuid4().hex[:8],
        ms=rng.choice([1000, 3000, 5000, 9000]),
    )
    return {
        "event_id": str(uuid.uuid4()),
        "type": bug["type"],
        "value": message,
        "stacktrace": bug["stack"],
        "level": bug["level"],
        "environment": rng.choice(["production", "production", "staging"]),
        "release": rng.choice(["web@2.4.1", "web@2.4.2"]),
        "breadcrumbs": BREADCRUMBS,
        "tags": {"browser": rng.choice(["chrome", "firefox", "safari"])},
    }


def send(url: str, key: str, payload: dict, timeout: float) -> tuple[int, float]:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "X-Klaxon-Key": key},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            status = res.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception:
        status = 0
    return status, (time.perf_counter() - started) * 1000


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, int(round(p / 100 * (len(ordered) - 1))))
    return ordered[idx]


def main() -> int:
    ap = argparse.ArgumentParser(description="Fire crash traffic at Klaxon.")
    ap.add_argument("--host", default="http://localhost:8000")
    ap.add_argument("--project", type=int, default=1)
    ap.add_argument("--key", default="pk_demo")
    ap.add_argument("--count", type=int, default=1000)
    ap.add_argument("--concurrency", type=int, default=16)
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    url = f"{args.host}/api/{args.project}/store"
    rng = random.Random(args.seed)
    payloads = [build_payload(rng) for _ in range(args.count)]

    print(f"→ {args.count} events to {url} at concurrency {args.concurrency}\n")

    latencies: list[float] = []
    statuses: Counter = Counter()
    lock = threading.Lock()
    done = 0

    def run(payload: dict) -> None:
        nonlocal done
        status, ms = send(url, args.key, payload, args.timeout)
        with lock:
            latencies.append(ms)
            statuses[status] += 1
            done += 1
            if done % max(1, args.count // 20) == 0:
                pct = done / args.count * 100
                sys.stdout.write(f"\r  {done}/{args.count} ({pct:.0f}%)")
                sys.stdout.flush()

    wall_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        list(pool.map(run, payloads))
    wall = time.perf_counter() - wall_start

    accepted = statuses.get(202, 0)
    print(f"\r  {args.count}/{args.count} (100%)\n")
    print(f"  wall time     {wall:.2f}s")
    print(f"  throughput    {args.count / wall:,.0f} events/sec")
    print(f"  accepted      {accepted}/{args.count}")
    if statuses.keys() - {202}:
        print(f"  other status  {dict(statuses)}")
    print()
    print(f"  mean          {statistics.fmean(latencies):.1f} ms")
    print(f"  p50           {percentile(latencies, 50):.1f} ms")
    print(f"  p95           {percentile(latencies, 95):.1f} ms")
    print(f"  p99           {percentile(latencies, 99):.1f} ms")
    print(f"  max           {max(latencies):.1f} ms")

    try:
        with urllib.request.urlopen(
            f"{args.host}/api/issues?project_id={args.project}&status=all", timeout=args.timeout
        ) as res:
            issues = json.loads(res.read())
        total = sum(i["times_seen"] for i in issues)
        print(f"\n  {total:,} events grouped into {len(issues)} issues\n")
        for issue in sorted(issues, key=lambda i: -i["times_seen"]):
            print(f"    {issue['times_seen']:>7,}  {issue['type']:<16} {issue['culprit']}")
    except Exception as e:
        print(f"\n  (could not read issues back: {e})")

    return 0 if accepted == args.count else 1


if __name__ == "__main__":
    raise SystemExit(main())
