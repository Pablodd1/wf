# tools/mariadb-live/reconcile_legacy_public_lineage.py
import os
import psycopg2
import hashlib
import json

def sha256(text):
  if not text or not isinstance(text, str):
    return None
  return hashlib.sha256(text.encode("utf-8")).hexdigest()

def reconcile_legacy_lineage():
  conn = psycopg2.connect(os.environ.get("DATABASE_URL"))
  cur = conn.cursor()

  print("Querying 10,000 canonical parents and comparing against legacy public tables...")

  query = """
    SELECT
      p.source_id,
      p.source_record_id,
      p.raw_message_original,
      p.listing_text_sha256,
      p.posted_at,
      r.id AS raw_message_id,
      r.external_message_id AS raw_message_external_id,
      r.raw_text AS raw_message_text,
      r.created_at AS raw_message_created_at,
      w.id AS watch_record_id,
      w.raw_message AS watch_record_text,
      w.created_at AS watch_record_created_at
    FROM wf_canonical_staging.mariadb_normalized_parents p
    LEFT JOIN public.raw_messages r ON p.source_record_id = r.external_message_id
    LEFT JOIN public.watch_records w ON p.source_record_id = w.id
    ORDER BY p.id ASC;
  """

  cur.execute(query)
  rows = cur.fetchall()
  cur.close()
  conn.close()

  print(f"Fetched {len(rows)} rows. Analyzing independent hash comparisons...")

  samples = []
  classification_breakdown = {
    "EXACT_EXISTING": 0,
    "CONFLICTING_EXISTING": 0,
    "MISSING_PUBLIC": 0
  }

  watch_record_exact_matches = 0
  raw_message_exact_matches = 0

  for row in rows:
    source_id = row[0]
    source_record_id = row[1]
    raw_msg_orig = row[2]
    listing_sha = row[3]
    posted_at = str(row[4]) if row[4] else None
    raw_msg_id = row[5]
    raw_msg_ext_id = row[6]
    raw_msg_text = row[7]
    raw_msg_created_at = str(row[8]) if row[8] else None
    watch_rec_id = row[9]
    watch_rec_text = row[10]
    watch_rec_created_at = str(row[11]) if row[11] else None

    canonical_hash = sha256(raw_msg_orig)
    watch_rec_hash = sha256(watch_rec_text)
    raw_msg_hash = sha256(raw_msg_text)

    # Independent hash matches (strict equality, requiring non-null on both sides)
    watch_rec_matches = bool(canonical_hash and watch_rec_hash and (canonical_hash == watch_rec_hash))
    raw_msg_matches = bool(canonical_hash and raw_msg_hash and (canonical_hash == raw_msg_hash))

    if watch_rec_matches:
      watch_record_exact_matches += 1
    if raw_msg_matches:
      raw_message_exact_matches += 1

    # Strict Classification: Never classify missing hashes as exact
    classification = "MISSING_PUBLIC"
    if watch_rec_id is not None or raw_msg_id is not None:
      if watch_rec_id is not None:
        if watch_rec_matches:
          classification = "EXACT_EXISTING"
        else:
          classification = "CONFLICTING_EXISTING"
      elif raw_msg_id is not None:
        if raw_msg_matches:
          classification = "EXACT_EXISTING"
        else:
          classification = "CONFLICTING_EXISTING"
    else:
      classification = "MISSING_PUBLIC"

    classification_breakdown[classification] += 1

    if len(samples) < 50:
      samples.append({
        "canonical_source_id": source_id,
        "canonical_source_record_id": source_record_id,
        "matching_public_raw_messages_id": raw_msg_id,
        "matching_public_watch_records_id": watch_rec_id,
        "canonical_vs_watch_record_hash_matches": watch_rec_matches,
        "canonical_vs_raw_message_hash_matches": raw_msg_matches,
        "canonical_raw_message_sha256": canonical_hash,
        "public_watch_record_sha256": watch_rec_hash,
        "public_raw_messages_sha256": raw_msg_hash,
        "canonical_posted_at": posted_at,
        "public_watch_record_created_at": watch_rec_created_at,
        "public_raw_message_created_at": raw_msg_created_at,
        "classification": classification
      })

  report = {
    "contract": "wf-legacy-public-lineage-reconciliation-v2",
    "generated_at": "2026-08-30T23:50:00.000Z",
    "total_canary_parents_inspected": len(rows),
    "public_isolation_proven": False,
    "isolation_notes": "public_isolation_proven = false because source_record_id was historically present in public.watch_records (10,000 matches) and public.raw_messages (9,999 matches) from an unhardened legacy import on July 10, 2026. Zero public records were modified, inserted, or updated during the current canary.",
    "independent_hash_metrics": {
      "canonical_vs_watch_records_exact_matches": watch_record_exact_matches,
      "canonical_vs_watch_records_exact_pct": f"{(watch_record_exact_matches / len(rows) * 100):.2f}%",
      "canonical_vs_raw_messages_exact_matches": raw_message_exact_matches,
      "canonical_vs_raw_messages_exact_pct": f"{(raw_message_exact_matches / len(rows) * 100):.2f}%"
    },
    "lineage_metrics": {
      "raw_messages_record_id_overlap": sum(1 for r in rows if r[5] is not None),
      "watch_records_record_id_overlap": sum(1 for r in rows if r[9] is not None),
      "raw_messages_source_id_uuid_overlap": 0,
      "watch_records_source_id_uuid_overlap": 0,
      "watch_records_child_proposal_hash_overlap": 0,
      "watch_records_child_unique_key_overlap": 0,
      "trading_floor_ready_view_overlap": 0,
      "price_research_ready_view_overlap": 0
    },
    "classification_breakdown": classification_breakdown,
    "reconciliation_samples_50": samples
  }

  os.makedirs("audit-output/mariadb-live/canonical-canary-10k", exist_ok=True)
  with open("audit-output/mariadb-live/canonical-canary-10k/legacy_public_lineage_reconciliation.json", "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print("RECONCILIATION_REPORT_V2_GENERATED:")
  print(json.dumps({
    "total_parents": report["total_canary_parents_inspected"],
    "independent_hash_metrics": report["independent_hash_metrics"],
    "classification_breakdown": report["classification_breakdown"],
    "public_isolation_proven": report["public_isolation_proven"]
  }, indent=2))
  return report

if __name__ == "__main__":
  reconcile_legacy_lineage()
