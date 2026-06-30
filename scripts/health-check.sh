#!/usr/bin/env bash
# WatchFacts health check script
# Pings /api/health every 5 minutes, alerts on failure
# Run: bash scripts/health-check.sh

set -euo pipefail

URL="${1:-https://watchfacts-poc.vercel.app}"
TIMEOUT=15
LOG_FILE="$HOME/.hermes/logs/wf-health-check.log"

# Ensure log dir exists
mkdir -p "$(dirname "$LOG_FILE")"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Checking $URL/api/health..." >> "$LOG_FILE"

# Health check
HTTP_CODE=$(curl -s -o /tmp/wf-health-resp.txt -w "%{http_code}" --max-time "$TIMEOUT" \
  -H "Cache-Control: no-cache" \
  "${URL}/api/health" 2>/dev/null || echo "000")

BODY=$(cat /tmp/wf-health-resp.txt 2>/dev/null || echo "")

if [ "$HTTP_CODE" != "200" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FAIL: HTTP $HTTP_CODE — $BODY" >> "$LOG_FILE"
  exit 1
fi

# Verify JSON response
if echo "$BODY" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  COUNT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('count',0))" 2>/dev/null || echo "?")
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] OK: 200, $COUNT records" >> "$LOG_FILE"
  exit 0
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FAIL: invalid JSON — ${BODY:0:200}" >> "$LOG_FILE"
  exit 1
fi
