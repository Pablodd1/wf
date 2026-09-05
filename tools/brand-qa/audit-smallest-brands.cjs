'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { lookupCatalog } = require('../../api/_lib/catalog.js');
const { classifyDemandEligibility, classifyResearchEligibility } = require('../../api/_lib/price-research-eligibility.cjs');
const { signaturesFor } = require('../duplicate-audit/duplicate-signatures.cjs');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');

const BRANDS = String(process.env.BRAND_QA_BRANDS || 'Bell & Ross,Grand Seiko,MB&F,F.P. Journe,TAG Heuer')
  .split(',').map(value => value.trim()).filter(Boolean);
const OUTPUT = path.resolve(process.env.BRAND_QA_OUTPUT || 'audit-output/brand-qa-smallest.json');
const PAGE_SIZE = 1000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function bump(target, key) {
  const label = key || 'UNKNOWN';
  target[label] = (target[label] || 0) + 1;
}

async function fetchBrand(baseUrl, key, brand) {
  const all = [];
  let lastId = '';
  while (true) {
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,condition,verdict,parser_version,created_at,seller_phone,seller_name,source,source_type,flags',
      brand: `eq.${brand}`,
      order: 'id.asc',
      limit: String(PAGE_SIZE),
    });
    if (lastId) params.set('id', `gt.${lastId}`);
    const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`${brand}: Supabase ${response.status}: ${await response.text()}`);
    const rows = await response.json();
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    lastId = rows[rows.length - 1].id;
  }
  return all;
}

function auditBrand(brand, rows) {
  const metrics = {
    brand,
    rows: rows.length,
    listingTypes: {},
    verdicts: {},
    eligibility: {},
    shadowFlags: {},
    catalogConfirmed: 0,
    analyticsEligible: 0,
    demandEligible: 0,
    unknownDials: 0,
    bundleRows: 0,
    bundleCandidates: 0,
    exactRawDuplicateMembers: 0,
    referencesWithFiveAnalyticsPoints: 0,
  };
  const rawSignatures = new Set();
  const eligibleReferences = new Map();

  for (const row of rows) {
    bump(metrics.listingTypes, String(row.listing_type || 'UNKNOWN').toUpperCase());
    bump(metrics.verdicts, String(row.verdict || 'UNKNOWN').toUpperCase());
    if (!row.dial_color || /^(?:unknown|unspecified|n\/?a|null|-+)$/i.test(String(row.dial_color).trim())) metrics.unknownDials += 1;

    const analyzed = analyzeRecord(row);
    if (analyzed.candidate_count > 1) {
      metrics.bundleRows += 1;
      metrics.bundleCandidates += analyzed.candidate_count;
    }
    for (const flag of analyzed.change_flags) bump(metrics.shadowFlags, flag);

    const signature = signaturesFor(row).exactRaw;
    if (signature) {
      if (rawSignatures.has(signature)) metrics.exactRawDuplicateMembers += 1;
      else rawSignatures.add(signature);
    }

    const catalog = row.reference ? lookupCatalog(row.reference, brand) : null;
    if (catalog?.found && catalog.model) metrics.catalogConfirmed += 1;
    const type = String(row.listing_type || '').toUpperCase();
    const reason = type === 'WTB'
      ? classifyDemandEligibility({ ...row, bundle_candidate_count: analyzed.candidate_count }, catalog)
      : classifyResearchEligibility({ ...row, bundle_candidate_count: analyzed.candidate_count }, catalog);
    bump(metrics.eligibility, reason || 'ELIGIBLE');
    if (!reason && type === 'WTB') metrics.demandEligible += 1;
    if (!reason && type !== 'WTB') {
      metrics.analyticsEligible += 1;
      const reference = String(row.reference).toUpperCase();
      eligibleReferences.set(reference, (eligibleReferences.get(reference) || 0) + 1);
    }
  }
  metrics.referencesWithFiveAnalyticsPoints = [...eligibleReferences.values()].filter(count => count >= 5).length;
  return metrics;
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const results = [];
  for (const brand of BRANDS) {
    const rows = await fetchBrand(baseUrl, key, brand);
    results.push(auditBrand(brand, rows));
    process.stdout.write(`${JSON.stringify({ event: 'brand_qa_complete', ...results.at(-1) })}\n`);
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), brands: results }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'brand_qa_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { auditBrand };
