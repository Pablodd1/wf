"""Read-only, redacted fixed-ID provenance verifier.

Returns no raw messages, payloads, seller names, or contacts.
"""
import json
import os
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

source_ids = sys.argv[1:]
if not source_ids:
    print(json.dumps([]))
    raise SystemExit(0)

conn = psycopg2.connect(os.environ["DATABASE_URL"], options="-c timezone=UTC")
conn.set_session(readonly=True, autocommit=False)
cur = conn.cursor(cursor_factory=RealDictCursor)
cur.execute(
    """
    SELECT
      r.source_id,
      r.source_hash AS raw_source_hash,
      p.source_hash AS proposal_source_hash,
      c.source_hash AS canary_source_hash,
      v.source_hash AS view_source_hash,
      p.brand AS proposal_brand, c.brand AS canary_brand, v.brand AS view_brand,
      p.model AS proposal_model, c.model AS canary_model, v.model AS view_model,
      p.reference AS proposal_reference, c.reference AS canary_reference,
      v.reference AS view_reference,
      p.intent AS proposal_intent, c.intent AS canary_intent, v.intent AS view_intent,
      p.price_usd AS proposal_price_usd, c.price_usd AS canary_price_usd,
      v.price_usd AS view_price_usd,
      p.condition AS proposal_condition, c.condition AS canary_condition,
      v.condition AS view_condition,
      c.dial_color AS canary_dial_color, v.dial_color AS view_dial_color,
      c.image_key AS canary_image_key, v.image_key AS view_image_key,
      c.price_status AS canary_price_status, v.price_status AS view_price_status,
      c.contact_available AS canary_contact_available,
      v.contact_available AS view_contact_available,
      c.listing_id AS canary_listing_id, v.listing_id AS view_listing_id
    FROM wf_canonical_staging.mariadb_raw_source_rows r
    JOIN wf_canonical_staging.mariadb_normalized_proposals_v2 p
      ON p.source_system = r.source_system
     AND p.source_database = r.source_database
     AND p.source_table = r.source_table
     AND p.source_id = r.source_id
     AND p.source_hash = r.source_hash
    JOIN wf_canonical_staging.mariadb_canary_published_listings_v2 c
      ON c.source_id = p.source_id AND c.source_hash = p.source_hash
    JOIN public.trading_floor_ready_view_v2 v
      ON v.listing_id = c.listing_id
     AND v.source_id = c.source_id
     AND v.source_hash = c.source_hash
    WHERE r.source_table = 'auctions'
      AND r.source_id = ANY(%s)
    ORDER BY r.source_id, c.listing_id
    """,
    (source_ids,),
)

rows = cur.fetchall()
for row in rows:
    for key, value in list(row.items()):
        if hasattr(value, "as_tuple"):
            row[key] = float(value)

conn.rollback()
cur.close()
conn.close()
print(json.dumps(rows, default=str))
