#!/usr/bin/env node
'use strict';

const REFERENCES = ['126334', '126300', '228235', '228238', '126333'];
const BASE_URL = String(process.env.WATCHFACTS_BASE_URL || 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');

async function json(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'watchfacts-phase3-rolex-five-reference-shadow/1.0' },
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body.slice(0, 240)}`);
  return JSON.parse(body);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function inspect(reference) {
  const research = new URL('/api/price-research', BASE_URL);
  research.searchParams.set('brand', 'Rolex');
  research.searchParams.set('reference', reference);
  const pr = await json(research);
  return {
    reference,
    price_research: {
      total_tracked_listings: numberOrNull(pr.total_tracked_listings),
      wts_eligible_analytics_count: numberOrNull(pr.wts_eligible_analytics_count),
      wtb_demand_count: numberOrNull(pr.wtb_demand_count),
      reference_qualified_wts_count: numberOrNull(pr.reference_qualified_wts_count),
      reference_analytics_ready: pr.reference_analytics_ready === true,
      total_listings: numberOrNull(pr.totalListings),
      reference_listing_count: numberOrNull(pr.reference_listing_count),
      listing_count: numberOrNull(pr.listing_count),
      eligible_observation_count: numberOrNull(pr.eligible_observation_count),
      unique_offer_count: numberOrNull(pr.unique_offer_count),
      analytics_ready: pr.analytics_ready === true,
      retained_rows: Array.isArray(pr.retained_rows) ? pr.retained_rows.length : 0,
      evidence_rows: Array.isArray(pr.rows) ? pr.rows.length : 0,
      excluded_count: numberOrNull(pr.excluded_count),
      reconciliation: pr.reconciliation || null,
    },
  };
}

async function main() {
  const rows = [];
  for (const reference of REFERENCES) {
    rows.push(await inspect(reference));
  }
  process.stdout.write(`${JSON.stringify({
    contract: 'watchfacts-phase3-rolex-five-reference-live-surface-v1',
    read_only: true,
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    references: rows,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
