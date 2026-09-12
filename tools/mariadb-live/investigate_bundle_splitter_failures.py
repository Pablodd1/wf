import os, sys, json, subprocess, psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(db_url, options="-c timezone=UTC", keepalives=1, keepalives_idle=30, keepalives_interval=10)
cur = conn.cursor()

print("================================================================================")
print("PHASE 2: INVESTIGATE BUNDLE SPLITTER FAILURES ACROSS 5,000 BUNDLE PARENTS")
print("================================================================================\n")

cur.execute("""
    SELECT source_id, source_system, source_database, source_table, source_record_id,
           source_created_on, source_hash, brand, reference, model, year, condition, intent,
           original_price_amount, original_price_currency, price_usd, fx_rate, fx_source, fx_date,
           currency_status, seller_name, seller_contact, image_key, image_evidence_type,
           trading_floor_status, trading_floor_eligible, price_research_status, price_research_eligible,
           is_bundle, included_in_statistics, listing_text_source, listing_text_sha256,
           reconciliation_category, review_flags, exclusion_reasons, raw_payload
    FROM wf_canonical_staging.mariadb_normalized_proposals_v2
    WHERE is_bundle = TRUE
    LIMIT 5000;
""")

cols = [d[0] for d in cur.description]
bundle_parents = [dict(zip(cols, r)) for r in cur.fetchall()]
print(f"Loaded {len(bundle_parents):,} bundle parent rows for failure classification.")

# Pass rows to Node.js debug worker to classify candidate segmentation
staged_rows = []
for p in bundle_parents:
    raw = p.get("raw_payload") or {}
    staged = dict(raw) if isinstance(raw, dict) else {}
    staged["source_id"] = p["source_id"]
    staged["source_hash"] = p["source_hash"]
    staged["source_system"] = p["source_system"]
    staged["source_database"] = p["source_database"]
    staged["source_table"] = p["source_table"]
    staged["source_record_id"] = p["source_record_id"]
    staged["source_created_on"] = p["source_created_on"]
    staged["raw_payload"] = raw
    staged_rows.append(staged)

in_file = "audit_bundle_in.json"
out_file = "audit_bundle_out.json"

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        import decimal
        if isinstance(o, decimal.Decimal): return float(o)
        return super().default(o)

with open(in_file, "w", encoding="utf-8") as f:
    json.dump(staged_rows, f, cls=DecimalEncoder)

# Run debug analysis in Node
node_code = """
const fs = require('fs');
const { segmentDealerMessage, resolveSourceTextEvidence } = require('./tools/mariadb-live/authoritative-evidence-normalizer.cjs');

const rows = JSON.parse(fs.readFileSync('audit_bundle_in.json', 'utf-8'));
const categories = {
  SINGLE_ITEM_FALSE_BUNDLE: [],
  MISSING_LINE_BREAKS_MULTIPLE_ITEMS: [],
  MULTIPLE_ITEMS_UNRECOGNIZED_REFERENCE: [],
  COMPLEX_LOT_PROSE: [],
  NO_TEXT_EVIDENCE: []
};

rows.forEach((r, idx) => {
  const ev = resolveSourceTextEvidence(r);
  const text = ev.text || '';
  if (!text) {
    categories.NO_TEXT_EVIDENCE.push({ id: r.source_id, text: null, is_explicit_bundle: Number(r.is_bundle) === 1 });
    return;
  }
  const candidates = segmentDealerMessage(text);
  if (candidates.length < 2) {
    // Classify failure
    const lines = text.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
    const hasMultipleWatchTokens = (text.match(/\\b(?:rolex|patek|audemars|cartier|omega|tudor|vacheron|hublot|breitling|jaeger|panerai|iwc)\\b/gi) || []).length >= 2;
    
    if (lines.length <= 1 && !hasMultipleWatchTokens) {
      categories.SINGLE_ITEM_FALSE_BUNDLE.push({ id: r.source_id, text: text.slice(0, 150), line_count: lines.length });
    } else if (hasMultipleWatchTokens && lines.length <= 1) {
      categories.MISSING_LINE_BREAKS_MULTIPLE_ITEMS.push({ id: r.source_id, text: text.slice(0, 200), line_count: lines.length });
    } else if (lines.length >= 2) {
      categories.MULTIPLE_ITEMS_UNRECOGNIZED_REFERENCE.push({ id: r.source_id, text: text.slice(0, 200), line_count: lines.length });
    } else {
      categories.COMPLEX_LOT_PROSE.push({ id: r.source_id, text: text.slice(0, 150), line_count: lines.length });
    }
  }
});

console.log(JSON.stringify({
  total_processed: rows.length,
  failure_categories: {
    SINGLE_ITEM_FALSE_BUNDLE: categories.SINGLE_ITEM_FALSE_BUNDLE.length,
    MISSING_LINE_BREAKS_MULTIPLE_ITEMS: categories.MISSING_LINE_BREAKS_MULTIPLE_ITEMS.length,
    MULTIPLE_ITEMS_UNRECOGNIZED_REFERENCE: categories.MULTIPLE_ITEMS_UNRECOGNIZED_REFERENCE.length,
    COMPLEX_LOT_PROSE: categories.COMPLEX_LOT_PROSE.length,
    NO_TEXT_EVIDENCE: categories.NO_TEXT_EVIDENCE.length
  },
  samples: {
    SINGLE_ITEM_FALSE_BUNDLE: categories.SINGLE_ITEM_FALSE_BUNDLE.slice(0, 3),
    MISSING_LINE_BREAKS_MULTIPLE_ITEMS: categories.MISSING_LINE_BREAKS_MULTIPLE_ITEMS.slice(0, 3),
    MULTIPLE_ITEMS_UNRECOGNIZED_REFERENCE: categories.MULTIPLE_ITEMS_UNRECOGNIZED_REFERENCE.slice(0, 3)
  }
}, null, 2));
"""

with open("run_audit.cjs", "w", encoding="utf-8") as f:
    f.write(node_code)

res = subprocess.run(["node", "run_audit.cjs"], capture_output=True, text=True)
print(res.stdout)

for p in [in_file, out_file, "run_audit.cjs"]:
    if os.path.exists(p): os.remove(p)

cur.close()
conn.close()
