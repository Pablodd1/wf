"""Production Duplicate Reconciliation Module.

Reconciles raw source observations across staging partitions:
- Identical canonical hashes: persists 1 canonical proposal, logs 1 duplicate resolution.
- Conflicting hashes: produces 0 canonical proposals, persists 1 quarantine conflict record.
"""
import os
import sys
import json
import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

def reconcile_source_revisions(conn, run_id: str = None) -> dict:
    """Executes production duplicate reconciliation.
    Persists actual proposals, duplicate ledger rows, and quarantine records."""
    cur = conn.cursor(cursor_factory=RealDictCursor)

    where_alpha = "WHERE payload->>'test_run_id' = %s" if run_id else ""
    where_beta = "WHERE payload->>'test_run_id' = %s" if run_id else ""
    params = (run_id, run_id) if run_id else ()

    query = f"""
    WITH combined_raw AS (
        SELECT source_id, source_hash, 'raw_partition_alpha' AS partition_name, payload, created_at
        FROM wf_canonical_staging.raw_partition_alpha
        {where_alpha}
        UNION ALL
        SELECT source_id, source_hash, 'raw_partition_beta' AS partition_name, payload, created_at
        FROM wf_canonical_staging.raw_partition_beta
        {where_beta}
    )
    SELECT
        source_id,
        COUNT(*) AS raw_count,
        COUNT(DISTINCT source_hash) AS distinct_hashes,
        ARRAY_AGG(DISTINCT source_hash) AS hashes,
        ARRAY_AGG(partition_name) AS partitions,
        ARRAY_AGG(created_at) AS timestamps,
        (ARRAY_AGG(payload))[1] AS sample_payload
    FROM combined_raw
    GROUP BY source_id;
    """
    cur.execute(query, params)
    reconciled_groups = cur.fetchall()

    proposals_inserted = 0
    duplicates_logged = 0
    quarantine_inserted = 0

    for group in reconciled_groups:
        sid = group["source_id"]
        raw_count = group["raw_count"]
        distinct_hashes = group["distinct_hashes"]
        hashes = group["hashes"]
        payload = group["sample_payload"]

        if distinct_hashes == 1:
            canonical_hash = hashes[0]
            row_test_run_id = payload.get("test_run_id") if isinstance(payload, dict) else run_id
            cur.execute("""
            INSERT INTO wf_canonical_staging.mariadb_normalized_proposals_v2
            (source_id, source_record_id, source_created_on, source_hash, brand, model, reference, price_usd, raw_payload, test_run_id)
            VALUES (%s, %s, NOW()::text, %s, %s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (source_id) DO UPDATE
            SET source_hash = EXCLUDED.source_hash, test_run_id = EXCLUDED.test_run_id;
            """, (sid, sid, canonical_hash, payload.get("brand"), payload.get("model"),
                  payload.get("reference"), payload.get("price"), json.dumps(payload), row_test_run_id))
            proposals_inserted += 1

            cur.execute("""
            INSERT INTO wf_canonical_staging.raw_duplicate_reconciliation_ledger
            (source_id, test_run_id, resolution_status, raw_count, distinct_hashes)
            VALUES (%s, %s, 'IDENTICAL_DUPLICATE_RECONCILED', %s, 1);
            """, (sid, run_id or "default", raw_count))
            duplicates_logged += (raw_count - 1)

        else:
            hash_a = hashes[0]
            hash_b = hashes[1] if len(hashes) > 1 else hashes[0]
            ts_a = group["timestamps"][0]
            ts_b = group["timestamps"][1] if len(group["timestamps"]) > 1 else group["timestamps"][0]
            part_a = group["partitions"][0]
            part_b = group["partitions"][1] if len(group["partitions"]) > 1 else group["partitions"][0]

            cur.execute("""
            INSERT INTO wf_canonical_staging.quarantined_conflicting_revisions
            (source_id, test_run_id, conflict_reason, partition_a, hash_a, timestamp_a, partition_b, hash_b, timestamp_b, remediation_status)
            VALUES (%s, %s, 'SOURCE_HASH_REVISION_CONFLICT', %s, %s, %s, %s, %s, %s, 'PENDING_HUMAN_REVIEW');
            """, (sid, run_id or "default", part_a, hash_a, ts_a, part_b, hash_b, ts_b))
            quarantine_inserted += 1

    cur.close()
    return {
        "groups_evaluated": len(reconciled_groups),
        "proposals_inserted": proposals_inserted,
        "duplicates_logged": duplicates_logged,
        "quarantine_inserted": quarantine_inserted
    }
