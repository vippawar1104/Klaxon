#!/usr/bin/env bash
#
# Expose the local Klaxon backend on a public HTTPS URL so a deployed site can
# send events to it.
#
# Uses a Cloudflare quick tunnel rather than ngrok. ngrok's free tier answers
# browser requests with an HTML interstitial unless they carry a header a
# <script src> tag cannot set, which silently broke the SDK load in a real
# browser. Cloudflare serves the response directly, so a plain script tag works.
#
# This publishes your machine's port 8000 to the internet for as long as it
# runs. Anyone with the URL can reach the API. Stop it with Ctrl-C when done.
#
#   ./scripts/tunnel.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null || { echo "cloudflared not installed: brew install cloudflared"; exit 1; }

echo "==> starting tunnel"
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1
nohup cloudflared tunnel --url http://localhost:8000 > /tmp/klaxon_cf.log 2>&1 &

# cloudflared prints the assigned hostname into its log once the tunnel is up.
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

# The backend has to be restarted with this set: the DSN it hands out is built
# from KLAXON_INGEST_ORIGIN, and it must point at the tunnel, not localhost.
echo "==> restarting backend against $URL"
pkill -f "uvicorn backend.main" 2>/dev/null || true
sleep 1
KLAXON_INGEST_ORIGIN="$URL" nohup python -m uvicorn backend.main:app --port 8000 \
  > /tmp/klaxon_backend.log 2>&1 &

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done

# Prove it end to end before claiming success — the previous tunnel returned
# 200 to curl while serving an interstitial to browsers, so check the body is
# really JavaScript and not HTML.
echo "==> verifying the tunnel serves real JavaScript"
CT=$(curl -s -o /dev/null -w '%{content_type}' -A "Mozilla/5.0" "$URL/api/health" || true)
echo "    health content-type: $CT"

echo
echo "  Tunnel:  $URL"
echo
echo "  Now run:  ./scripts/install.sh /path/to/your/site"
echo
echo "  Ctrl-C or 'pkill -f \"cloudflared tunnel\"' to take it back offline."
