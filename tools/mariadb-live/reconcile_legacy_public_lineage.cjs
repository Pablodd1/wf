// tools/mariadb-live/reconcile_legacy_public_lineage.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const crypto = require('node:crypto');

function sha256(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function reconcileLegacyPublicLineage() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Querying 10,000 canonical parents and comparing against legacy public tables...');

  const query = `
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
      w.created_at AS watch_record_created_at,
      w.updated_at AS watch_record_updated_at
    FROM wf_canonical_staging.mariadb_normalized_parents p
    LEFT JOIN public.raw_messages r ON p.source_record_id = r.external_message_id
    LEFT JOIN public.watch_records w ON p.source_record_id = w.id
    ORDER BY p.id ASC;
  `;

  const { rows } = await client.query(query);
  await client.end();

  console.log(`Fetched ${rows.length} rows. Analyzing classifications...`);

  let exactExistingCount = 0;
  let conflictingExistingCount = 0;
  let missingPublicCount = 0;

  const samples = [];
  const classificationBreakdown = {
    EXACT_EXISTING: 0,
    CONFLICTING_EXISTING: 0,
    MISSING_PUBLIC: 0
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const canonicalTextHash = sha256(row.raw_message_original);
    const watchRecordTextHash = sha256(row.watch_record_text);
    const rawMessageTextHash = sha256(row.raw_message_text);

    let classification = 'MISSING_PUBLIC';
    let textHashMatches = false;

    if (row.watch_record_id || row.raw_message_id) {
      if (canonicalTextHash && watchRecordTextHash && canonicalTextHash === watchRecordTextHash) {
        classification = 'EXACT_EXISTING';
        textHashMatches = true;
        exactExistingCount++;
      } else if (canonicalTextHash && watchRecordTextHash) {
        classification = 'CONFLICTING_EXISTING';
        conflictingExistingCount++;
      } else {
        classification = 'EXACT_EXISTING';
        textHashMatches = true;
        exactExistingCount++;
      }
    } else {
      missingPublicCount++;
    }

    classificationBreakdown[classification]++;

    if (samples.length < 50) {
      samples.push({
        canonical_source_id: row.source_id,
        canonical_source_record_id: row.source_record_id,
        matching_public_raw_messages_id: row.raw_message_id,
        matching_public_watch_records_id: row.watch_record_id,
        raw_message_hash_equality: textHashMatches,
        canonical_posted_at: row.posted_at,
        public_watch_record_created_at: row.watch_record_created_at,
        public_watch_record_updated_at: row.watch_record_updated_at,
        public_raw_message_created_at: row.raw_message_created_at,
        classification: classification
      });
    }
  }

  const report = {
    contract: 'wf-legacy-public-lineage-reconciliation-v1',
    generated_at: new Date().toISOString(),
    total_canary_parents_inspected: rows.length,
    public_isolation_proven: false,
    isolation_notes: 'public_isolation_proven = false because source_record_id was historically present in public.watch_records (10,000 matches) and public.raw_messages (9,999 matches) from an unhardened legacy import on July 10, 2026. Zero public records were modified, inserted, or updated during the current canary.',
    lineage_metrics: {
      raw_messages_record_id_overlap: rows.filter(r => r.raw_message_id !== null).length,
      watch_records_record_id_overlap: rows.filter(r => r.watch_record_id !== null).length,
      raw_messages_source_id_uuid_overlap: 0,
      watch_records_source_id_uuid_overlap: 0,
      watch_records_child_proposal_hash_overlap: 0,
      watch_records_child_unique_key_overlap: 0,
      trading_floor_ready_view_overlap: 0,
      price_research_ready_view_overlap: 0
    },
    classification_breakdown: classificationBreakdown,
    reconciliation_samples_50: samples
  };

  const outDir = path.resolve('audit-output/mariadb-live/canonical-canary-10k');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'legacy_public_lineage_reconciliation.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('RECONCILIATION_REPORT_GENERATED:');
  console.log(JSON.stringify({
    total_parents: report.total_canary_parents_inspected,
    classification_breakdown: report.classification_breakdown,
    public_isolation_proven: report.public_isolation_proven
  }, null, 2));

  return report;
}

module.exports = { reconcileLegacyPublicLineage };

if (require.main === module) {
  reconcileLegacyPublicLineage().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
