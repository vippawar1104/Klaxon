#!/usr/bin/env bash
# End-to-end exercise of every Klaxon endpoint against a running server.
#
# Talks to whatever is at $API (default: a server on localhost:8000) — it does
# not start or stop anything itself. Run directly against a dev server, or via
# test_all.sh, which boots an isolated instance first so this never touches
# real project data.
set -uo pipefail
API="${API:-http://localhost:8000/api}"
pass=0; fail=0

ok()   { printf "  \033[32mPASS\033[0m  %s %s\n" "$1" "${2:-}"; pass=$((pass+1)); }
bad()  { printf "  \033[31mFAIL\033[0m  %s %s\n" "$1" "${2:-}"; fail=$((fail+1)); }
is() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then ok "$label" "($got)"; else bad "$label" "expected $want, got $got"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
jq_()  { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "=== 1. health ==="
is "health returns ok" "$(curl -s $API/health | jq_ "d['status']")" "ok"

echo "=== 2. auth ==="
EMAIL="t$(date +%s)@example.com"
BODY="{\"email\":\"$EMAIL\",\"password\":\"hunter2hunter2\"}"
JSON='Content-Type: application/json'

SIGNUP=$(curl -s -X POST $API/auth/signup -H "$JSON" -d "$BODY")
TOKEN=$(echo "$SIGNUP" | jq_ "d['token']")
[ -n "$TOKEN" ] && ok "signup returns a token" || bad "signup returns a token"

# Every dashboard endpoint is scoped to the signed-in account, so each of the
# calls below carries the token. Anything that reads or writes issues, alerts
# or projects without it is a cross-tenant hole, and section 11 asserts that.
AUTH=(-H "Authorization: Bearer $TOKEN")

# Capture each status into a variable first. Nesting a command substitution
# directly in the call corrupted the argument list, so the expected value was
# silently replaced by the observed one and the assertions could never fail.
dup=$(code -X POST $API/auth/signup -H "$JSON" -d "$BODY")
short=$(code -X POST $API/auth/signup -H "$JSON" -d '{"email":"x@y.co","password":"short"}')
bademail=$(code -X POST $API/auth/signup -H "$JSON" -d '{"email":"notanemail","password":"hunter2hunter2"}')
badpw=$(code -X POST $API/auth/login -H "$JSON" -d "{\"email\":\"$EMAIL\",\"password\":\"wrongwrongwrong\"}")
goodpw=$(code -X POST $API/auth/login -H "$JSON" -d "$BODY")
nome=$(code $API/auth/me)
withme=$(code $API/auth/me -H "Authorization: Bearer $TOKEN")
badme=$(code $API/auth/me -H 'Authorization: Bearer nonsense')

is "duplicate email rejected" "$dup" "409"
is "short password rejected" "$short" "422"
is "invalid email rejected" "$bademail" "422"
is "login with wrong password" "$badpw" "401"
is "login with correct password" "$goodpw" "200"
is "/me without token" "$nome" "401"
is "/me with token" "$withme" "200"
is "/me with garbage token" "$badme" "401"

echo "=== 3. projects ==="
NEW=$(curl -s -X POST $API/projects "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"name":"e2e-test"}')
PID=$(echo "$NEW" | jq_ "d['id']")
KEY=$(echo "$NEW" | jq_ "d['public_key']")
[ -n "$PID" ] && ok "project created" "(id=$PID)" || bad "project created"
echo "$NEW" | grep -q '"dsn"' && ok "returns a DSN" || bad "returns a DSN"
echo "$KEY" | grep -q '^pk_' && ok "key is server-generated" || bad "key is server-generated"
is "default rules created" "$(curl -s "$API/alerts/rules?project_id=$PID" "${AUTH[@]}" | jq_ "len(d)")" "3"

echo "=== 4. ingest auth ==="
EV='{"event_id":"'"$(uuidgen)"'","type":"TypeError","value":"boom","stacktrace":"TypeError: boom\n    at renderCart (https://shop.com/assets/cart.js:42:18)"}'
is "valid key accepted" \
  "$(code -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" -d "$EV")" "202"
is "wrong key rejected" \
  "$(code -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: wrong" -d "$EV")" "403"
is "missing key rejected" \
  "$(code -X POST "$API/$PID/store" -H 'Content-Type: application/json' -d "$EV")" "403"
is "unknown project rejected" \
  "$(code -X POST "$API/999999/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" -d "$EV")" "403"
is "key via query param (sendBeacon path)" \
  "$(code -X POST "$API/$PID/store?key=$KEY" -H 'Content-Type: application/json' -d '{"event_id":"'"$(uuidgen)"'","type":"E","value":"v"}')" "202"
is "malformed payload rejected" \
  "$(code -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" -d '{"nope":1}')" "422"

echo "=== 5. grouping ==="
# Same bug, varying message + line number: must stay one issue.
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" \
    -d "{\"event_id\":\"$(uuidgen)\",\"type\":\"TypeError\",\"value\":\"boom at user $i\",\"stacktrace\":\"TypeError: boom\\n    at renderCart (https://shop.com/assets/cart.js:4$i:18)\"}"
done
# Firefox-format trace for the same bug: must join the same group.
curl -s -o /dev/null -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" \
  -d "{\"event_id\":\"$(uuidgen)\",\"type\":\"TypeError\",\"value\":\"boom\",\"stacktrace\":\"renderCart@https://shop.com/assets/cart.js:42:18\"}"
# A genuinely different bug.
curl -s -o /dev/null -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" \
  -d "{\"event_id\":\"$(uuidgen)\",\"type\":\"ReferenceError\",\"value\":\"nope\",\"stacktrace\":\"ReferenceError: nope\\n    at applyDiscount (https://shop.com/assets/pricing.js:88:3)\"}"

# dedup: same event_id twice must count once
DUP=$(uuidgen)
for _ in 1 2; do
  curl -s -o /dev/null -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" \
    -d "{\"event_id\":\"$DUP\",\"type\":\"RangeError\",\"value\":\"dup\",\"stacktrace\":\"RangeError: dup\\n    at walk (https://shop.com/assets/tree.js:9:1)\"}"
done

sleep 3
ISSUES=$(curl -s "$API/issues?project_id=$PID&status=all" "${AUTH[@]}")
echo "$ISSUES" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('    issues:', len(d))
for i in d: print('     ', i['type'], i['culprit'], 'x'+str(i['times_seen']))
"
is "TypeError grouped despite line/message drift" \
  "$(echo "$ISSUES" | jq_ "[i['times_seen'] for i in d if i['culprit']=='cart.js:42'][0]")" "7"
is "different bug is its own issue" \
  "$(echo "$ISSUES" | jq_ "len([i for i in d if i['type']=='ReferenceError'])")" "1"
is "duplicate event_id counted once" \
  "$(echo "$ISSUES" | jq_ "[i['times_seen'] for i in d if i['type']=='RangeError'][0]")" "1"

echo "=== 6. issue detail + status ==="
IID=$(echo "$ISSUES" | jq_ "[i['id'] for i in d if i['culprit']=='cart.js:42'][0]")
DETAIL=$(curl -s "$API/issues/$IID" "${AUTH[@]}")
echo "$DETAIL" | grep -q '"fingerprint"' && ok "detail exposes fingerprint" || bad "detail exposes fingerprint"
echo "$DETAIL" | grep -q '"latest_event"' && ok "detail includes latest event" || bad "detail includes latest event"
is "unknown issue 404s" "$(code $API/issues/999999 "${AUTH[@]}")" "404"
is "resolve" "$(code -X POST "$API/issues/$IID/status?status=resolved" "${AUTH[@]}")" "200"
is "invalid status rejected" "$(code -X POST "$API/issues/$IID/status?status=bogus" "${AUTH[@]}")" "400"
is "open filter hides resolved" \
  "$(curl -s "$API/issues?project_id=$PID&status=open" "${AUTH[@]}" | jq_ "len([i for i in d if i['id']==$IID])")" "0"

echo "=== 7. regression detection ==="
curl -s -o /dev/null -X POST "$API/$PID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $KEY" \
  -d "{\"event_id\":\"$(uuidgen)\",\"type\":\"TypeError\",\"value\":\"back again\",\"stacktrace\":\"TypeError: boom\\n    at renderCart (https://shop.com/assets/cart.js:42:18)\"}"
sleep 2
is "resolved issue marked regressed" "$(curl -s "$API/issues/$IID" "${AUTH[@]}" | jq_ "d['status']")" "regressed"

echo "=== 8. alerts ==="
ALERTS=$(curl -s "$API/alerts?project_id=$PID" "${AUTH[@]}")
echo "$ALERTS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('    alerts sent:', len(d))
for a in d: print('     ', a['kind'], '-', a['reason'])
"
KINDS=$(echo "$ALERTS" | jq_ "sorted({a['kind'] for a in d})")
echo "$KINDS" | grep -q new_issue && ok "new_issue alert fired" || bad "new_issue alert fired"
echo "$KINDS" | grep -q regression && ok "regression alert fired" || bad "regression alert fired"

RULE=$(curl -s "$API/alerts/rules?project_id=$PID" "${AUTH[@]}" | jq_ "d[0]['id']")
BEFORE=$(curl -s "$API/alerts/rules?project_id=$PID" "${AUTH[@]}" | jq_ "d[0]['enabled']")
curl -s -o /dev/null -X POST "$API/alerts/rules/$RULE/toggle" "${AUTH[@]}"
AFTER=$(curl -s "$API/alerts/rules?project_id=$PID" "${AUTH[@]}" | jq_ "d[0]['enabled']")
[ "$BEFORE" != "$AFTER" ] && ok "rule toggles" "($BEFORE -> $AFTER)" || bad "rule toggles"
curl -s -o /dev/null -X POST "$API/alerts/rules/$RULE/toggle" "${AUTH[@]}"
is "toggling unknown rule 404s" "$(code -X POST "$API/alerts/rules/999999/toggle" "${AUTH[@]}")" "404"

echo "=== 9. cooldown: many events, one alert ==="
CD=$(curl -s -X POST $API/projects "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"name":"cooldown-test"}')
CPID=$(echo "$CD" | jq_ "d['id']"); CKEY=$(echo "$CD" | jq_ "d['public_key']")
for i in $(seq 1 60); do
  curl -s -o /dev/null -X POST "$API/$CPID/store" -H 'Content-Type: application/json' -H "X-Klaxon-Key: $CKEY" \
    -d "{\"event_id\":\"$(uuidgen)\",\"type\":\"TypeError\",\"value\":\"storm $i\",\"stacktrace\":\"TypeError: s\\n    at boom (https://shop.com/assets/storm.js:7:1)\"}"
done
sleep 4
EVENTS=$(curl -s "$API/issues?project_id=$CPID&status=all" "${AUTH[@]}" | jq_ "sum(i['times_seen'] for i in d)")
SENT=$(curl -s "$API/alerts?project_id=$CPID" "${AUTH[@]}" | jq_ "len(d)")
echo "    $EVENTS events -> $SENT alert(s)"
is "60 events produce 1 alert" "$SENT" "1"

echo "=== 10. queue + explain ==="
is "queue endpoint responds" "$(code $API/queue "${AUTH[@]}")" "200"
is "queue needs a token" "$(code $API/queue)" "401"
is "queue drained" "$(curl -s $API/queue "${AUTH[@]}" | jq_ "d['pending']")" "0"
EXPLAIN=$(code -X POST "$API/issues/$IID/explain" "${AUTH[@]}")
[ "$EXPLAIN" = "503" ] && ok "explain 503s without GEMINI_API_KEY (correct)" \
  || { [ "$EXPLAIN" = "200" ] && ok "explain returned an analysis" || bad "explain" "got $EXPLAIN"; }

echo "=== 11. tenancy ==="
# Every one of these used to return 200 to a stranger: issue lists, full crash
# payloads, the alert audit trail, and the mutations behind them.
is "issue list needs a token" "$(code "$API/issues?project_id=$PID")" "401"
is "issue detail needs a token" "$(code "$API/issues/$IID")" "401"
is "alert list needs a token" "$(code "$API/alerts?project_id=$PID")" "401"
is "rule list needs a token" "$(code "$API/alerts/rules?project_id=$PID")" "401"
is "status change needs a token" "$(code -X POST "$API/issues/$IID/status?status=ignored")" "401"
is "rule toggle needs a token" "$(code -X POST "$API/alerts/rules/$RULE/toggle")" "401"
is "vcs diff needs a token" "$(code "$API/vcs/diff")" "401"

# A second account must not reach the first one's project, even with a token.
OTHER=$(curl -s -X POST $API/auth/signup -H "$JSON" \
  -d "{\"email\":\"o$(date +%s)@example.com\",\"password\":\"hunter2hunter2\"}" | jq_ "d['token']")
OAUTH=(-H "Authorization: Bearer $OTHER")
is "another account cannot list the issues" \
  "$(code "$API/issues?project_id=$PID" "${OAUTH[@]}")" "404"
is "another account cannot read an issue" "$(code "$API/issues/$IID" "${OAUTH[@]}")" "404"
is "another account cannot resolve an issue" \
  "$(code -X POST "$API/issues/$IID/status?status=resolved" "${OAUTH[@]}")" "404"
is "another account cannot read the alerts" \
  "$(code "$API/alerts?project_id=$PID" "${OAUTH[@]}")" "404"
is "another account cannot add a webhook rule" \
  "$(code -X POST "$API/alerts/rules?project_id=$PID" "${OAUTH[@]}" -H "$JSON" \
     -d '{"kind":"new_issue","channel":"webhook","target":"http://attacker.example/x"}')" "404"
is "another account cannot disable a rule" \
  "$(code -X POST "$API/alerts/rules/$RULE/toggle" "${OAUTH[@]}")" "404"

echo
printf "=== %d passed, %d failed ===\n" "$pass" "$fail"
[ "$fail" -eq 0 ]
