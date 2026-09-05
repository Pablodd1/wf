'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { confirmCatalogCandidate } = require('../shadow-reprocess/catalog-confirmation.cjs');

const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const outputPath = path.resolve(process.env.BUNDLE_REVIEW_OUTPUT || 'audit-output/bundle-canary-review-20260719/catalog-review.json');

if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');

async function rest(resource) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    signal: AbortSignal.timeout(60000),
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : [];
}

function substantiveFlags(flags = []) {
  return flags.filter(flag => !/^BUNDLE_(?:CHILD_CANARY|PARENT:|INDEX:)/.test(flag));
}

function review(row) {
  const catalog = confirmCatalogCandidate({
    brand: row.brand,
    reference: row.reference,
    dial_color: row.dial_color,
  });
  const blockers = [];
  if (!row.field_confidence?.exact_raw_lineage) blockers.push('RAW_LINEAGE_REQUIRED');
  if (!catalog.confirmed) blockers.push(catalog.reason || 'CATALOG_NOT_CONFIRMED');
  if (row.dial_color && catalog.confirmed && catalog.dialConfirmed !== true) {
    blockers.push(catalog.dialReason || 'CATALOG_DIAL_CONFLICT');
  }
  if (!row.brand) blockers.push('BRAND_REQUIRED');
  if (!row.reference) blockers.push('REFERENCE_REQUIRED');
  if (!row.dial_color) blockers.push('DIAL_REQUIRED');
  if (row.listing_type === 'WTS') {
    if (!(Number(row.price_usd) > 0)) blockers.push('PRICE_REQUIRED');
    if (!row.currency) blockers.push('CURRENCY_REQUIRED');
  }
  blockers.push(...substantiveFlags(row.flags));
  return {
    id: row.id,
    parent_id: row.field_confidence?.bundle_parent_id || null,
    raw_line: row.raw_message,
    brand: row.brand,
    reference: row.reference,
    dial_color: row.dial_color,
    listing_type: row.listing_type,
    price_usd: row.price_usd,
    currency: row.currency,
    catalog_confirmed: catalog.confirmed,
    catalog_dial_confirmed: catalog.dialConfirmed,
    flags: row.flags,
    blockers: [...new Set(blockers)],
  };
}

async function main() {
  const params = new URLSearchParams({
    select: 'id,raw_message,brand,reference,dial_color,price_usd,currency,listing_type,flags,field_confidence,verdict,confidence',
    flags: 'cs.["BUNDLE_CHILD_CANARY"]',
    order: 'id.asc',
    limit: '1000',
  });
  const rows = await rest(`watch_staging?${params}`);
  const reviewed = rows.map(review);
  const catalogClean = reviewed.filter(row => row.catalog_confirmed && row.catalog_dial_confirmed !== false);
  const promotionReady = reviewed.filter(row => row.blockers.length === 0);
  const blocked = reviewed.filter(row => row.blockers.length > 0);
  const blockerCounts = blocked.flatMap(row => row.blockers).reduce((counts, reason) => {
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const report = {
    generated_at: new Date().toISOString(),
    rows_reviewed: reviewed.length,
    parent_count: new Set(reviewed.map(row => row.parent_id)).size,
    catalog_clean: catalogClean.length,
    promotion_ready: promotionReady.length,
    blocked: blocked.length,
    blocker_counts: blockerCounts,
    safety: {
      production_rows_changed: 0,
      parent_rows_suppressed: 0,
      review_only: true,
    },
    promotion_ready_rows: promotionReady,
    blocked_rows: blocked,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    rows_reviewed: report.rows_reviewed,
    parent_count: report.parent_count,
    catalog_clean: report.catalog_clean,
    promotion_ready: report.promotion_ready,
    blocked: report.blocked,
    blocker_counts: report.blocker_counts,
    output: outputPath,
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'bundle_child_review_error', error: error.message }));
  process.exitCode = 1;
});
