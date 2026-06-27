#!/bin/bash
# WatchFacts Batch Re-Analysis Runner
# 
# USAGE:
#   export SUPABASE_URL="https://bptrvfncppbjnchsaxtb.supabase.co"
#   export SUPABASE_SERVICE_ROLE_KEY="<your-key>"
#   ./scripts/run_reanalyze.sh
#
# All credentials must be set as env vars — never hardcode them here.

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$SUPABASE_URL" ]; then
  echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as env vars"
  echo "  export SUPABASE_SERVICE_ROLE_KEY=<your-key>"
  exit 1
fi

cd /home/jasme/wf
echo "[runner] Starting re-analysis at $(date)"
node scripts/reanalyze_batch.cjs "$@"
echo "[runner] Done at $(date)"
