'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const OUTPUT_PATH = String(process.env.DEALER_OVERLAP_OUTPUT || '').trim();

async function rows(sourceSystem, select = 'source_id') {
  const result = [];
  for (let offset = 0;; offset += 1000) {
    const params = new URLSearchParams({
      select,
      source_system: `eq.${sourceSystem}`,
      order: 'id.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/dealer_directory_import_staging?${params}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const page = await response.json();
    result.push(...page);
    if (page.length < 1000) return result;
  }
}

function overlapCounts(sourceRows, directoryRows) {
  const sourceIds = new Set(sourceRows.map(row => String(row.source_id || '')).filter(Boolean));
  const directoryIds = new Set(directoryRows.map(row => String(row.source_id || '')).filter(Boolean));
  return {
    source_candidates: sourceIds.size,
    directory_candidates: directoryIds.size,
    exact_source_id_matches: [...directoryIds].filter(id => sourceIds.has(id)).length,
  };
}

function phoneOverlapCounts(sellerRows, directoryRows) {
  const normalize = value => String(value || '').replace(/\D/g, '');
  const directoryPhones = new Set(directoryRows.map(row => normalize(row.phone_normalized)).filter(Boolean));
  const matchingRows = sellerRows.filter(row => directoryPhones.has(normalize(row.source_identity)));
  return {
    seller_lineage_rows: sellerRows.length,
    directory_phone_identities: directoryPhones.size,
    phone_supported_listing_rows: matchingRows.length,
    phone_supported_unique_identities: new Set(matchingRows.map(row => normalize(row.source_identity))).size,
  };
}

function reviewCandidates(sellerRows, directoryRows) {
  const normalize = value => String(value || '').replace(/\D/g, '');
  const directoryByPhone = new Map(
    directoryRows.map(row => [normalize(row.phone_normalized), row.source_id]).filter(([phone]) => phone)
  );
  return sellerRows
    .filter(row => directoryByPhone.has(normalize(row.source_identity)))
    .map(row => ({
      directory_source_id: directoryByPhone.get(normalize(row.source_identity)),
      source_record_id: row.source_record_id,
      seller_listing_id: row.seller_listing_id,
      evidence: 'EXACT_NORMALIZED_PHONE_SUPPORT',
      auto_verified: false,
      contact_consent: false,
    }));
}

async function run() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase server credentials are required');
  const [sourceRows, directoryRows, sellerRows] = await Promise.all([
    rows('RAW_RECORDS_COMPANY_ID'),
    rows('WATCHFACTS_RATED_DEALERS_AUTHENTICATED', 'source_id,phone_normalized'),
    (async () => {
      const result = [];
      for (let offset = 0;; offset += 1000) {
        const params = new URLSearchParams({
          select: 'source_identity,source_record_id,seller_listing_id',
          match_status: 'in.(MATCH_READY,REVIEW_REQUIRED)',
          order: 'id.asc',
          limit: '1000',
          offset: String(offset),
        });
        const response = await fetch(`${SUPABASE_URL}/rest/v1/seller_listing_lineage_staging?${params}`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 300)}`);
        const page = await response.json();
        result.push(...page);
        if (page.length < 1000) return result;
      }
    })(),
  ]);
  const candidates = reviewCandidates(sellerRows, directoryRows);
  if (OUTPUT_PATH) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify({ generated_at: new Date().toISOString(), rows: candidates }, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    event: 'dealer_source_overlap_audit',
    readOnly: true,
    ...overlapCounts(sourceRows, directoryRows),
    ...phoneOverlapCounts(sellerRows, directoryRows),
    review_manifest_rows: candidates.length,
    review_manifest_path: OUTPUT_PATH ? path.resolve(OUTPUT_PATH) : null,
    inferred_matches: 0,
  }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'dealer_source_overlap_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { overlapCounts, phoneOverlapCounts, reviewCandidates };
