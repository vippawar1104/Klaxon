#!/usr/bin/env bash
#
# One command that answers "does Klaxon actually work end to end?"
#
#   ./scripts/test_all.sh
#
# Hits your REAL server on localhost:8000 — the same one demo.html and the
# dashboard talk to — using your REAL klaxon.db, not a throwaway copy. If a
# server is already running there, this uses it as-is and leaves it running.
# If none is running, this starts one (against the real database) and leaves
# it running afterward so you can immediately open the dashboard and see what
# this test just did.
#
# This DOES write real data: a handful of test accounts (emails tagged
# concurrency-*/sec-*/brute-*@t.test) and a few issues/alerts, same as running
# scripts/test_backend.sh by hand. Nothing is deleted and nothing pre-existing
# is touched.
#
# What it checks, in order:
#   1. Unit tests            — pytest, the fast per-function checks
#   2. Server reachable      — starts it if nothing answers /api/health yet
#   3. End-to-end HTTP       — scripts/test_backend.sh: every route, real auth,
#                              real tenancy, real alert delivery
#   4. Concurrency           — the dedup ledger under genuinely parallel
#                              duplicate submissions (not just sequential ones)
#   5. Security, live        — SSRF-blocked webhook targets, brute-force
#                              login throttling — proven against the real HTTP
#                              stack, not just the unit tests for the guards
#   6. Frontend build        — the dashboard actually compiles
#
# Exits 0 only if everything passed.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=8000
API="http://127.0.0.1:$PORT/api"
LOG="$(mktemp)"
WE_STARTED_SERVER=0

STEP_RESULTS=()
OVERALL=0

pass_step() { STEP_RESULTS+=("PASS  $1"); }
fail_step() { STEP_RESULTS+=("FAIL  $1"); OVERALL=1; }

header() { printf "\n\033[1m── %s ──\033[0m\n" "$1"; }

cleanup() {
  # Deliberately never kills the server, whether we started it or it was
  # already running: the point is to leave it up so you can look at what this
  # just did in the dashboard. Only the scratch log file is removed.
  rm -f "$LOG" "$LOG.pytest" "$LOG.frontend"
}
trap cleanup EXIT

echo "Klaxon — full architecture test"
echo "Target: $API  (your real klaxon.db)"

# --- 1. unit tests -----------------------------------------------------
header "1. Unit tests (pytest)"
if python -m pytest tests/ -q 2>&1 | tee "$LOG.pytest"; then
  pass_step "unit tests ($(tail -1 "$LOG.pytest" | tr -d '\r'))"
else
  fail_step "unit tests ($(tail -1 "$LOG.pytest" | tr -d '\r'))"
fi

# --- 2. make sure the real server is reachable ---------------------------
header "2. Server on $API"
if curl -sf "$API/health" >/dev/null 2>&1; then
  echo "  already running — using it as-is"
else
  echo "  nothing answering — starting it against your real klaxon.db"
  nohup python -m uvicorn backend.main:app --port "$PORT" >"$LOG" 2>&1 &
  disown
  WE_STARTED_SERVER=1
fi

up=0
for _ in $(seq 1 40); do
  if curl -sf "$API/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 0.5
done

if [ "$up" = "1" ]; then
  pass_step "server answers /api/health"
else
  fail_step "server answers /api/health"
  echo "  --- server log ---"
  tail -30 "$LOG" | sed 's/^/  /'
  echo "  Cannot continue without a live server — stopping here."
  header "Summary"
  for r in "${STEP_RESULTS[@]}"; do echo "  $r"; done
  exit 1
fi

# --- 3. full end-to-end HTTP suite --------------------------------------
header "3. End-to-end HTTP (every route, real auth, real tenancy)"
if API="$API" bash scripts/test_backend.sh; then
  pass_step "end-to-end HTTP suite"
else
  fail_step "end-to-end HTTP suite"
fi

# --- 4. dedup under real concurrency ------------------------------------
header "4. Dedup ledger under genuinely parallel duplicate submissions"
CONCURRENCY_RESULT=$(python3 - "$API" <<'EOF'
import json, sys, uuid, concurrent.futures, urllib.request, urllib.error

api = sys.argv[1]

def post(email_pw):
    body = json.dumps(email_pw).encode()
    req = urllib.request.Request(f"{api}/auth/signup", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

signup = post({"email": f"concurrency-{uuid.uuid4()}@t.test", "password": "hunter2hunter2"})
token = signup["token"]

req = urllib.request.Request(f"{api}/projects", headers={"Authorization": f"Bearer {token}"})
with urllib.request.urlopen(req) as r:
    projects = json.load(r)
project_id, public_key = projects[0]["id"], projects[0]["public_key"]

event_id = str(uuid.uuid4())
event_body = json.dumps({
    "event_id": event_id, "type": "ConcurrencyProof", "value": "20 parallel identical posts",
    "stacktrace": "ConcurrencyProof: p\n    at proof (https://t.test/p.js:1:1)",
}).encode()

def fire(_):
    req = urllib.request.Request(
        f"{api}/{project_id}/store?key={public_key}", data=event_body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
    codes = list(ex.map(fire, range(20)))

import time
match = None
for _ in range(30):
    req = urllib.request.Request(f"{api}/issues?project_id={project_id}&status=all",
                                 headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        issues = json.load(r)
    match = next((i for i in issues if i["value"] == "20 parallel identical posts"), None)
    if match:
        break
    time.sleep(0.2)

if not match:
    print("FAIL: issue never appeared")
elif all(c == 202 for c in codes) and match["times_seen"] == 1:
    print(f"PASS: 20 parallel identical posts -> times_seen={match['times_seen']}")
else:
    print(f"FAIL: codes={codes} times_seen={match['times_seen']} (want all 202, times_seen=1)")
EOF
)
echo "  $CONCURRENCY_RESULT"
if [[ "$CONCURRENCY_RESULT" == PASS:* ]]; then
  pass_step "dedup holds under 20 parallel identical posts"
else
  fail_step "dedup holds under 20 parallel identical posts"
fi

# --- 5. security, live ----------------------------------------------------
header "5. Security guards, live against real HTTP"

SECURITY_RESULT=$(python3 - "$API" <<'EOF'
import json, sys, uuid, urllib.request, urllib.error

api = sys.argv[1]
ok = True
lines = []

def call(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{api}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

_, signup = call("POST", "/auth/signup",
                 body={"email": f"sec-{uuid.uuid4()}@t.test", "password": "hunter2hunter2"})
token = signup["token"]
_, projects = call("GET", "/projects", token=token)
project_id = projects[0]["id"]

# 5a. SSRF: internal targets must be refused when adding a webhook rule.
for target, name in [
    ("http://169.254.169.254/latest/meta-data/", "cloud metadata address"),
    ("http://127.0.0.1:8000/api/health", "loopback"),
    ("http://10.0.0.5/admin", "private RFC1918 range"),
]:
    status, resp = call("POST", f"/alerts/rules?project_id={project_id}", token=token,
                        body={"kind": "new_issue", "channel": "webhook", "target": target})
    good = status == 400
    lines.append(f"  {'ok' if good else 'FAIL'}  webhook to {name} refused ({status})")
    ok = ok and good

# 5b. A normal public webhook target must still be accepted.
status, _ = call("POST", f"/alerts/rules?project_id={project_id}", token=token,
                 body={"kind": "regression", "channel": "webhook",
                       "target": "https://example.com/hooks/klaxon"})
good = status == 201
lines.append(f"  {'ok' if good else 'FAIL'}  a public https webhook target is accepted ({status})")
ok = ok and good

# 5c. Brute-force login throttling: enough wrong passwords must eventually 429.
email = f"brute-{uuid.uuid4()}@t.test"
call("POST", "/auth/signup", body={"email": email, "password": "hunter2hunter2"})
codes = []
for _ in range(30):
    status, _ = call("POST", "/auth/login", body={"email": email, "password": "wrongwrongwrong"})
    codes.append(status)
    if status == 429:
        break
throttled = 429 in codes
first_was_401 = codes[0] == 401  # a genuine typo must never be blocked outright
lines.append(f"  {'ok' if throttled else 'FAIL'}  repeated wrong passwords are eventually throttled (429 seen: {throttled})")
lines.append(f"  {'ok' if first_was_401 else 'FAIL'}  the first wrong attempt is a normal 401, not throttled")
ok = ok and throttled and first_was_401

for line in lines:
    print(line)
print("RESULT: " + ("PASS" if ok else "FAIL"))
EOF
)
echo "$SECURITY_RESULT" | sed '/^RESULT:/d'
if echo "$SECURITY_RESULT" | grep -q "^RESULT: PASS"; then
  pass_step "SSRF guard + brute-force throttle, live"
else
  fail_step "SSRF guard + brute-force throttle, live"
fi

# --- 6. frontend build ---------------------------------------------------
header "6. Frontend build"
if [ -d frontend/node_modules ]; then
  if (cd frontend && npm run build) >"$LOG.frontend" 2>&1; then
    pass_step "frontend builds"
  else
    fail_step "frontend builds"
    tail -30 "$LOG.frontend" | sed 's/^/  /'
  fi
else
  STEP_RESULTS+=("SKIP  frontend builds (run 'npm install' in frontend/ first)")
fi

# --- summary --------------------------------------------------------------
header "Summary"
for r in "${STEP_RESULTS[@]}"; do
  case "$r" in
    PASS*) printf "  \033[32m%s\033[0m\n" "$r" ;;
    FAIL*) printf "  \033[31m%s\033[0m\n" "$r" ;;
    *)     printf "  \033[33m%s\033[0m\n" "$r" ;;
  esac
done

echo
if [ "$OVERALL" -eq 0 ]; then
  printf "\033[32m\033[1mEverything passed.\033[0m Klaxon's ingest, grouping, alerting, auth,\n"
  echo "tenancy and security guards all work end to end against your real server."
else
  printf "\033[31m\033[1mSomething is broken.\033[0m See the FAIL lines above for which layer\n"
  echo "and scroll up to that section's output for the detail."
fi

if [ "$WE_STARTED_SERVER" = "1" ]; then
  echo
  echo "The server is still running (this script started it) — open the"
  echo "dashboard now to see the test accounts and issues this just created,"
  echo "or open sdk/demo.html and throw a real error yourself."
  echo "To stop it: pkill -f 'uvicorn backend.main'"
fi

exit "$OVERALL"
