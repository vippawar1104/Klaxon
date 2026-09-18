#!/usr/bin/env bash
#
# The entire Klaxon setup, one command:
#   ./scripts/install.sh /path/to/your/portfolio
#
# Starts the backend, starts the tunnel, finds your project's real script
# tag, and patches it directly into your site's layout file. No copying
# URLs between terminals, no guessing which folder a step belongs in.
#
set -euo pipefail
cd "$(dirname "$0")/.."

SITE="${1:-}"
MODE="${2:-tunnel}"
if [ -z "$SITE" ]; then
  echo "usage: ./scripts/install.sh /path/to/your/portfolio [--local]"
  echo
  echo "  (default)  public tunnel, for a deployed site"
  echo "  --local    point at http://localhost:8000 — no tunnel, no DNS, nothing"
  echo "             to block it. Use when running your site with 'npm run dev'."
  exit 1
fi
# Next.js App Router lives at app/layout.tsx normally, or src/app/layout.tsx
# when the project uses the src/ convention — both are common, so try both.
LAYOUT="$SITE/app/layout.tsx"
if [ ! -f "$LAYOUT" ]; then
  LAYOUT="$SITE/src/app/layout.tsx"
fi
if [ ! -f "$LAYOUT" ]; then
  echo "no app/layout.tsx or src/app/layout.tsx under $SITE — is that a Next.js App Router project?"
  exit 1
fi
echo "==> found $LAYOUT"

# --- 1. backend -------------------------------------------------------
if ! curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
  echo "==> starting backend"
  nohup python -m uvicorn backend.main:app --port 8000 > /tmp/klaxon_backend.log 2>&1 &
  for _ in $(seq 1 40); do
    curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

# --- 2. where the browser will reach the API ------------------------------
if [ "$MODE" = "--local" ]; then
  # No tunnel at all. Nothing between the browser and the API, so no
  # interstitial page and no public DNS to resolve — the two things that
  # broke this on ngrok and on Cloudflare respectively.
  URL="http://localhost:8000"
  echo "==> local mode: $URL (your site must run on this machine)"

  # KLAXON_INGEST_ORIGIN overrides the forwarded host when building the DSN,
  # and tunnel.sh sets it. Left alone, local mode would hand out the tunnel's
  # URL — exactly the unreachable address we are working around. Restarting
  # unconditionally is a second or two and is always right; sniffing whether
  # the running process has it set is not.
  echo "==> restarting backend without a tunnel origin"
  pkill -f "uvicorn backend.main" 2>/dev/null || true
  sleep 1
  env -u KLAXON_INGEST_ORIGIN nohup python -m uvicorn backend.main:app --port 8000 \
    > /tmp/klaxon_backend.log 2>&1 &
  for _ in $(seq 1 40); do
    curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1 && break
    sleep 0.5
  done
else
  # Cloudflare rather than ngrok: ngrok's free tier answers browser requests
  # with an HTML interstitial unless they carry a header a <script src>
  # cannot set, so the SDK silently failed to load in a real browser while
  # looking fine to curl.
  if ! pgrep -f "cloudflared tunnel" >/dev/null 2>&1; then
    echo "==> starting tunnel"
    nohup cloudflared tunnel --url http://localhost:8000 > /tmp/klaxon_cf.log 2>&1 &
  fi

  URL=""
  for _ in $(seq 1 40); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/klaxon_cf.log 2>/dev/null | head -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -z "$URL" ]; then
    echo "tunnel did not come up; see /tmp/klaxon_cf.log"
    exit 1
  fi

  # The tunnel being up is not the same as the browser being able to reach it:
  # this machine's resolver returned NXDOMAIN for a live quick-tunnel hostname.
  # Fail loudly here rather than writing an unreachable URL into someone's app.
  if ! curl -sf -o /dev/null --max-time 10 "$URL/api/health"; then
    echo
    echo "  Tunnel started at $URL but this machine cannot reach it."
    echo "  Usually DNS: your resolver may not resolve *.trycloudflare.com."
    echo
    echo "  Re-run with --local instead, and run your site locally:"
    echo "      ./scripts/install.sh \"$SITE\" --local"
    exit 1
  fi
  echo "==> tunnel $URL"
fi
# No backend restart needed: the projects request below forwards this host, and
# the API derives the DSN from that (origin_from_request in core/projects.py).

# --- 3. find the real script tag for this account ------------------------
TOKEN_FILE="$HOME/.klaxon_token"
if [ ! -f "$TOKEN_FILE" ]; then
  echo
  echo "First run — sign in once:"
  read -rp "  email: " EMAIL
  read -rsp "  password: " PASSWORD
  echo
  # Built with json.dumps and piped in on stdin, not interpolated into a string
  # and passed as an argument: a password containing a quote or a backslash
  # produced malformed JSON and a 422 that read as "wrong password", and -d on
  # the command line puts the password in every local `ps` listing.
  LOGIN_BODY=$(KLAXON_EMAIL="$EMAIL" KLAXON_PASSWORD="$PASSWORD" python3 -c '
import json, os
print(json.dumps({"email": os.environ["KLAXON_EMAIL"], "password": os.environ["KLAXON_PASSWORD"]}))')
  RESP=$(printf '%s' "$LOGIN_BODY" | curl -s -X POST http://127.0.0.1:8000/api/auth/login \
    -H 'Content-Type: application/json' --data-binary @-)
  TOKEN=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
  if [ -z "$TOKEN" ]; then
    echo "login failed: $RESP"
    exit 1
  fi
  echo "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
TOKEN=$(cat "$TOKEN_FILE")

WHOAMI=$(curl -s http://127.0.0.1:8000/api/auth/me -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('email',''))" 2>/dev/null || true)
if [ -z "$WHOAMI" ]; then
  # A saved token from a deleted or expired session — same fix either way.
  echo "saved session is no longer valid — run 'rm ~/.klaxon_token' and try again"
  exit 1
fi
echo "==> signed in as $WHOAMI"

if [ "$MODE" = "--local" ]; then
  FWD_HEADERS=(-H "X-Forwarded-Proto: http" -H "X-Forwarded-Host: localhost:8000")
else
  FWD_HEADERS=(-H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: ${URL#https://}")
fi

PROJECTS=$(curl -s http://127.0.0.1:8000/api/projects -H "Authorization: Bearer $TOKEN" "${FWD_HEADERS[@]}")
HAS_PROJECT=$(echo "$PROJECTS" | python3 -c "import json,sys; print('yes' if json.load(sys.stdin) else 'no')")

if [ "$HAS_PROJECT" = "no" ]; then
  # Accounts created before auto-provisioning (or any account someone signs
  # into here for the first time) start with none — self-heal instead of
  # making that the user's problem to diagnose.
  echo "==> this account has no project yet — creating one"
  # json.dumps again: a directory name with a quote or a backslash in it would
  # otherwise produce a body the API rejects as malformed.
  NAME_BODY=$(KLAXON_NAME="$(basename "$SITE")" python3 -c '
import json, os
print(json.dumps({"name": os.environ["KLAXON_NAME"]}))')
  PROJECTS=$(printf '%s' "$NAME_BODY" | curl -s -X POST http://127.0.0.1:8000/api/projects \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data-binary @- "${FWD_HEADERS[@]}" \
    | python3 -c "import json,sys; print(json.dumps([json.load(sys.stdin)]))")
fi

TAG=$(echo "$PROJECTS" | python3 -c "
import json, sys
projects = json.load(sys.stdin)
url = projects[0]['loader_url']
# A plain script tag, deliberately. An earlier version wrapped this in
# fetch()+eval() to send the header ngrok's free tier demands before it will
# serve JS instead of an HTML interstitial. Cloudflare needs no such header,
# so the workaround — and the eval, and the JSX brace-escaping it forced —
# is gone.
print('<script src=' + json.dumps(url) + '></script>')
")

# --- 4. patch it into layout.tsx, idempotently ---------------------------
# Prints PATCHED or MANUAL on the last line so this script never claims
# success when it didn't actually change anything.
RESULT=$(python3 - "$LAYOUT" "$TAG" <<'PY'
import re, sys
path, tag = sys.argv[1], sys.argv[2]
src = open(path, encoding="utf-8").read()

marker_start, marker_end = "{/* klaxon:start */}", "{/* klaxon:end */}"
# tag already the complete snippet — do not rebuild it, or a fetch()-based
# tag silently collapses back into something other than what was generated.
block = f"{marker_start}\n        {tag}\n        {marker_end}"

if marker_start in src:
    # Already installed once — replace so a tunnel restart just updates the URL.
    src = re.sub(re.escape(marker_start) + r".*?" + re.escape(marker_end), block, src, flags=re.S)
else:
    # <body> commonly carries attributes (className, a template literal for
    # font variables, etc.) — matching only the bare tag missed real projects.
    match = re.search(r"<body\b[^>]*>", src)
    if not match:
        print("MANUAL")
        sys.exit(0)
    src = src[: match.end()] + f"\n        {block}" + src[match.end() :]

open(path, "w", encoding="utf-8").write(src)
print("PATCHED")
PY
)

echo
if [ "$RESULT" = "PATCHED" ]; then
  echo "  Done. $LAYOUT now points at:"
  echo "  $URL"
  echo
  if [ "$MODE" = "--local" ]; then
    # Nothing to deploy: localhost only resolves on this machine, so pushing
    # this would point the live site at the visitor's own computer.
    echo "  Now run your site locally and open it:"
    echo
    echo "    cd \"$SITE\" && npm run dev"
    echo
    echo "  Then in that page's console:  setTimeout(() => { null.crash() })"
    echo "  Do NOT commit this — localhost is only reachable from this machine."
  else
    echo "  Next: commit and push that file. That's the only manual step left."
    echo
    echo "    cd \"$SITE\" && git add \"${LAYOUT#$SITE/}\" && git commit -m 'error tracking' && git push"
  fi
else
  echo "  Could not find a <body> tag to patch automatically."
  echo "  Paste this into $LAYOUT yourself, just inside <body>:"
  echo
  echo "    $TAG"
fi
