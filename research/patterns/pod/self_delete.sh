#!/usr/bin/env bash
# Safety net: delete (terminate) this pod after N hours, even if nobody remembers to.
# Uses the pod's own RUNPOD_POD_ID / RUNPOD_API_KEY that RunPod injects ("Pod-scoped API key").
# Whether that key may delete the pod cannot be tested without deleting it, so this script only
# checks what can be checked (variables present, key accepted for a read call) and reports it.
#
# Usage: self_delete.sh [hours=3]       Cancel: kill $(cat /root/self_delete.pid)
set -uo pipefail
HOURS="${1:-3}"
SECS=$(awk "BEGIN{print int($HOURS*3600)}")
LOG=/root/self_delete.log

# Variables injected into PID 1's environment (an SSH shell may not have them).
for v in RUNPOD_POD_ID RUNPOD_API_KEY; do
  if [ -z "${!v:-}" ] && [ -r /proc/1/environ ]; then
    val=$(tr '\0' '\n' < /proc/1/environ | sed -n "s/^$v=//p")
    [ -n "$val" ] && export "$v=$val"
  fi
done
for v in RUNPOD_POD_ID RUNPOD_API_KEY; do  # never print the key itself
  if [ -n "${!v:-}" ]; then echo "$v: present"; else echo "$v: MISSING"; fi
done
[ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ] || { echo "cannot arm the timer"; exit 1; }

echo "runpodctl: $(command -v runpodctl || echo 'not installed') $(runpodctl version 2>/dev/null | head -1)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RUNPOD_API_KEY" \
  "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID")
echo "read check (GET rest.runpod.io/v1/pods/<id>): HTTP $code"
code2=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RUNPOD_API_KEY" \
  "https://api.runpod.io/v2/pods/$RUNPOD_POD_ID")
echo "read check (GET api.runpod.io/v2/pods/<id>): HTTP $code2"

delete_pod() {
  # Try every documented way; stop at the first that succeeds.
  if command -v runpodctl >/dev/null; then
    RUNPOD_API_KEY="$RUNPOD_API_KEY" runpodctl pod delete "$RUNPOD_POD_ID" && return 0
    runpodctl config --apiKey "$RUNPOD_API_KEY" >/dev/null 2>&1
    runpodctl remove pod "$RUNPOD_POD_ID" && return 0
  fi
  for url in "https://api.runpod.io/v2/pods/$RUNPOD_POD_ID" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID"; do
    c=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" "$url")
    echo "DELETE $url -> HTTP $c"
    case "$c" in 2*) return 0 ;; esac
  done
  # GraphQL: the pod key is accepted there for reads (checked 2026-10-14)
  r=$(curl -s -H "Content-Type: application/json" -H "Authorization: Bearer $RUNPOD_API_KEY" \
    -d "{\"query\":\"mutation { podTerminate(input: {podId: \\\"$RUNPOD_POD_ID\\\"}) }\"}" https://api.runpod.io/graphql)
  echo "graphql podTerminate -> $r"
  case "$r" in *error*) return 1 ;; *) return 0 ;; esac
}
export -f delete_pod
export RUNPOD_POD_ID RUNPOD_API_KEY

setsid nohup bash -c "sleep $SECS; date; delete_pod" >"$LOG" 2>&1 < /dev/null &
echo $! > /root/self_delete.pid
echo "armed: pod will be deleted at $(date -d "+$SECS seconds" '+%H:%M:%S %Z') (pid $(cat /root/self_delete.pid), log $LOG)"
