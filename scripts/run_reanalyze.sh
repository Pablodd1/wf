#!/bin/bash
# WatchFacts Batch Re-Analysis Runner
# Runs reanalyze_batch.cjs with correct Supabase credentials

export SUPABASE_URL="https://bptrvfncppbjnchsaxtb.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbG...SU"

cd /home/jasme/wf
echo "[runner] Starting re-analysis at $(date)"
node scripts/reanalyze_batch.cjs "$@"
echo "[runner] Done at $(date)"
