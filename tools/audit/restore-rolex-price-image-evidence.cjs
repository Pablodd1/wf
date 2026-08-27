#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { HistoricalEcbResolver } = require('./phase7b-historical-fx.cjs');
const {
  CONTRACT,
  EVIDENCE_VERSION,
  buildImageEvidence,
  buildPriceEvidence,
  sha256,
} = require('./rolex-evidence-restoration-lib.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const RUN_ID = '17d6d831-86cd-5e67-9830-c881bcf16e0d';
const EXPECTED_ROLEX_CURRENT = 1_535_763;
const EXPECTED_EXISTING_VERIFIED_IMAGES = 255;
const MODES = new Set(['dry-run', 'canary', 'full']);
const PRICE_COLUMNS = [
  'run_id', 'current_listing_key', 'offer_state_key', 'latest_raw_occurrence_key', 'evidence_version',
  'exact_child_text_sha256', 'parent_raw_text_sha256', 'raw_text_sha256', 'child_text_scope',
  'source_price_text', 'source_price_amount', 'source_currency', 'source_span_start', 'source_span_end',
  'parser_rule', 'parser_version', 'decision', 'review_reason', 'price_evidence_classification',
  'normalized_usd_amount', 'display_price_verified', 'price_research_eligible', 'fx_contract',
  'fx_provider', 'fx_source_url', 'fx_applicable_date', 'fx_effective_date', 'fx_lookback_days',
  'fx_rate_direction', 'fx_rate', 'evidence_checksum',
];

function clean(value) {
  return String(value ?? '').trim();
}

function writeManifest(manifest, outputFile) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

function assertTarget(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== `${PROJECT_REF}.supabase.co`) {
    throw new Error('Rolex evidence restoration is pinned to canonical QNSA');
  }
}

function confirmationFor(mode) {
  if (mode === 'canary') return 'APPLY_QNSA_ROLEX_EVIDENCE_CANARY_V1';
  if (mode === 'full') return 'APPLY_QNSA_ROLEX_EVIDENCE_FULL_V1';
  return null;
}

function compactPriceRow(evidence) {
  return Object.fromEntries(PRICE_COLUMNS.map(column => [column, evidence[column] ?? null]));
}

async function insertPriceEvidence(client, rows) {
  if (!rows.length) return;
  const { error } = await client.from('curated_luxury_rolex_price_evidence_shadow').upsert(rows, {
    onConflict: 'run_id,current_listing_key,latest_raw_occurrence_key,evidence_version',
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

async function insertImageEvidence(client, rows) {
  if (!rows.length) return;
  const assets = [...new Map(rows.map(row => [row.source_image_key, {
    source_image_key: row.source_image_key,
    source_url: row.source_url,
    source_asset_key: row.source_asset_key,
    evidence_source: row.evidence_source,
    customer_safe: true,
  }])).values()];
  const { error: assetError } = await client.from('curated_luxury_child_image_assets_shadow').upsert(assets, {
    onConflict: 'source_image_key', ignoreDuplicates: true,
  });
  if (assetError) throw assetError;
  const links = rows.map(row => ({
    run_id: row.run_id,
    current_listing_key: row.current_listing_key,
    raw_occurrence_key: row.raw_occurrence_key,
    source_image_key: row.source_image_key,
    image_ordinal: row.image_ordinal,
    association_method: row.association_method,
    image_evidence_type: row.image_evidence_type,
    association_evidence_sha256: row.association_evidence_sha256,
  }));
  const { error: linkError } = await client.from('curated_luxury_child_image_links_shadow').upsert(links, {
    onConflict: 'run_id,current_listing_key,source_image_key', ignoreDuplicates: true,
  });
  if (linkError) throw linkError;
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

async function run(options = {}) {
  const mode = clean(options.mode || process.env.ROLEX_EVIDENCE_MODE || 'dry-run').toLowerCase();
  if (!MODES.has(mode)) throw new Error('ROLEX_EVIDENCE_MODE must be dry-run, canary, or full');
  const url = clean(options.url || process.env.SUPABASE_URL);
  const key = clean(options.key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  assertTarget(url);
  const requiredConfirmation = confirmationFor(mode);
  if (requiredConfirmation && clean(options.confirmation || process.env.ROLEX_EVIDENCE_CONFIRMATION) !== requiredConfirmation) {
    throw new Error(`Exact confirmation ${requiredConfirmation} is required`);
  }
  const outputFile = path.resolve(options.outputFile || process.env.ROLEX_EVIDENCE_OUTPUT
    || path.join('audit-output', 'rolex-evidence-restoration', `${mode}-${Date.now()}.json`));
  const runId = clean(options.runId || process.env.ROLEX_EVIDENCE_RUN_ID || RUN_ID);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error('ROLEX_EVIDENCE_RUN_ID must be a UUID');
  }
  if (fs.existsSync(outputFile)) throw new Error(`Refusing to overwrite existing manifest: ${outputFile}`);
  const client = options.client || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const resolver = options.resolver || new HistoricalEcbResolver();
  const batchSize = Math.min(1000, Math.max(1, Number(options.batchSize || process.env.ROLEX_EVIDENCE_BATCH_SIZE || 500)));
  const canaryLimit = Math.max(1, Number(options.canaryLimit || process.env.ROLEX_EVIDENCE_CANARY_LIMIT || 1000));
  const apply = mode !== 'dry-run';
  const preflight = await rpc(client, 'curated_luxury_rolex_evidence_reconciliation_v1', { p_run_id: runId });
  if (runId === RUN_ID && Number(preflight?.raw_current_rows) !== EXPECTED_ROLEX_CURRENT) {
    throw new Error(`Frozen Rolex current count changed: ${preflight?.raw_current_rows}`);
  }
  if (Number(preflight?.canonical_current_rows) > Number(preflight?.raw_current_rows)) {
    throw new Error('Canonical Rolex count cannot exceed raw current count');
  }
  if (runId === RUN_ID && Number(preflight?.verified_image_listings) < EXPECTED_EXISTING_VERIFIED_IMAGES) {
    throw new Error(`Existing verified Rolex image regression: ${preflight?.verified_image_listings}`);
  }
  const counters = {
    candidate_rows: 0,
    existing_verified_prices: 0,
    verified_direct_usd: 0,
    verified_dated_fx: 0,
    price_review_required: 0,
    price_rows_written: 0,
    image_urls_recovered: 0,
    image_links_written: 0,
    ambiguous_image_assignments: 0,
    wrong_child_assignments: 0,
  };
  let afterKey = null;
  let hasMore = true;
  while (hasMore) {
    const page = await rpc(client, 'curated_luxury_rolex_evidence_candidates_v1', {
      p_run_id: runId, p_after_key: afterKey, p_limit: batchSize,
    });
    let rows = Array.isArray(page?.rows) ? page.rows : [];
    if (mode === 'canary') rows = rows.slice(0, Math.max(0, canaryLimit - counters.candidate_rows));
    if (!rows.length) break;
    counters.candidate_rows += rows.length;
    const priceEvidence = await Promise.all(rows.map(async row => {
      if (row.price_verified === true) {
        counters.existing_verified_prices += 1;
        return null;
      }
      const evidence = await buildPriceEvidence(row, resolver);
      if (evidence.decision === 'VERIFIED') {
        if (evidence.price_evidence_classification === 'DATED_VERIFIED_FX') counters.verified_dated_fx += 1;
        else counters.verified_direct_usd += 1;
      } else counters.price_review_required += 1;
      return compactPriceRow(evidence);
    }));
    const priceRows = priceEvidence.filter(Boolean);
    const imageRows = rows.flatMap(buildImageEvidence);
    counters.image_urls_recovered += imageRows.length;
    if (apply) {
      await insertPriceEvidence(client, priceRows);
      await insertImageEvidence(client, imageRows);
      counters.price_rows_written += priceRows.length;
      counters.image_links_written += imageRows.length;
    }
    afterKey = page?.next_key || rows.at(-1)?.current_listing_key || null;
    hasMore = page?.has_more === true && Boolean(afterKey);
    if (mode === 'canary' && counters.candidate_rows >= canaryLimit) break;
  }
  let facetRefresh = null;
  if (apply) {
    facetRefresh = await rpc(client, 'curated_luxury_refresh_rolex_effective_facets_v1', { p_run_id: runId });
  }
  const reconciliation = await rpc(client, 'curated_luxury_rolex_evidence_reconciliation_v1', { p_run_id: runId });
  const manifest = {
    contract: CONTRACT,
    evidence_version: EVIDENCE_VERSION,
    project_ref: PROJECT_REF,
    run_id: runId,
    brand: 'Rolex',
    mode,
    applied: apply,
    generated_at: new Date().toISOString(),
    expected_rolex_current: runId === RUN_ID ? EXPECTED_ROLEX_CURRENT : null,
    counters,
    preflight,
    facet_refresh: facetRefresh,
    reconciliation,
    duplicate_details_exposed: false,
    raw_or_source_tables_mutated: false,
    patek_modified: false,
  };
  manifest.manifest_sha256 = sha256(JSON.stringify(manifest));
  writeManifest(manifest, outputFile);
  return { manifest, outputFile };
}

if (require.main === module) {
  run().then(({ manifest, outputFile }) => {
    process.stdout.write(`${JSON.stringify({ output_file: outputFile, ...manifest })}\n`);
  }).catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_EXISTING_VERIFIED_IMAGES,
  EXPECTED_ROLEX_CURRENT,
  PROJECT_REF,
  RUN_ID,
  compactPriceRow,
  confirmationFor,
  insertImageEvidence,
  insertPriceEvidence,
  run,
};
