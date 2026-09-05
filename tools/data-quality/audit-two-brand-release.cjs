'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BRANDS = ['Rolex', 'Patek Philippe'];

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=', 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue == null) index += 1;
    values[key] = value;
  }
  return {
    baseUrl: values['supabase-url'] || process.env.SUPABASE_URL,
    key: values.key || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    brands: String(values.brands || DEFAULT_BRANDS.join('|')).split('|').map(value => value.trim()).filter(Boolean),
    output: path.resolve(values.output || 'audit-output/two-brand-release/readiness.json'),
  };
}

function parseCount(response) {
  const contentRange = response.headers.get('content-range');
  const match = contentRange?.match(/\/(\d+)$/);
  if (!match) throw new Error(`Exact count missing from Content-Range: ${contentRange}`);
  return Number(match[1]);
}

function createClient(baseUrl, key, fetchFn = fetch) {
  if (!baseUrl || !key) {
    throw new Error('SUPABASE_URL and a Supabase server key are required');
  }
  const root = `${String(baseUrl).replace(/\/$/, '')}/rest/v1`;
  return async function countRows(table, filters = {}, precision = 'planned') {
    const query = new URLSearchParams({ select: '*' });
    for (const [column, expression] of Object.entries(filters)) query.set(column, expression);
    const url = `${root}/${table}?${query}`;
    const response = await fetchFn(url, {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: `count=${precision}`,
        Range: '0-0',
      },
    });
    if (!response.ok) throw new Error(`Supabase ${response.status} while counting ${table}`);
    return { value: parseCount(response), precision };
  };
}

async function auditBrand(brand, count) {
  const watchBrand = { brand: `eq.${brand}` };
  const approvedWts = { ...watchBrand, verdict: 'eq.APPROVED', listing_type: 'eq.WTS' };
  const imageBrand = { 'identity_snapshot->>brand': `eq.${brand}` };
  const result = {
    brand,
    watch_records: {},
    verified_publication: {},
    image_reviews: {},
  };

  result.watch_records.total = await count('watch_records', watchBrand);
  result.watch_records.approved_wts = await count('watch_records', approvedWts);
  result.watch_records.approved_wts_with_raw_message = await count('watch_records', {
    ...approvedWts,
    raw_message: 'not.is.null',
  });
  result.watch_records.approved_wts_with_legacy_image_flag = await count('watch_records', {
    ...approvedWts,
    has_images: 'eq.true',
  }, 'exact');
  result.watch_records.approved_wts_with_dealer = await count('watch_records', {
    ...approvedWts,
    dealer_id: 'not.is.null',
  }, 'exact');

  result.verified_publication.trading_floor = await count(
    'trading_floor_verified_listings',
    watchBrand,
    'exact',
  );
  result.verified_publication.trading_floor_with_image = await count(
    'trading_floor_verified_listings',
    { ...watchBrand, has_images: 'eq.true' },
    'exact',
  );
  result.verified_publication.price_research_source_wts = await count(
    'price_research_verified_source',
    { ...watchBrand, listing_type: 'eq.WTS' },
    'exact',
  );

  for (const status of ['SOURCE_LINKED', 'VISUALLY_VERIFIED', 'REJECTED']) {
    result.image_reviews[status] = await count('listing_image_reviews', {
      ...imageBrand,
      status: `eq.${status}`,
    }, 'exact');
  }
  return result;
}

async function run(options, fetchFn = fetch) {
  const count = createClient(options.baseUrl, options.key, fetchFn);
  const brands = [];
  for (const brand of options.brands) brands.push(await auditBrand(brand, count));
  const report = {
    contract: 'two-brand-client-release-readiness-v1',
    generated_at: new Date().toISOString(),
    brands,
    safety: {
      mode: 'READ_ONLY',
      database_writes: 0,
      production_records_changed: 0,
    },
    gate: 'A listing needs verified identity, explicit source-backed price/currency eligibility, and VISUALLY_VERIFIED image evidence before image-backed customer publication.',
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await run(options);
  process.stdout.write(`${JSON.stringify({
    event: 'two_brand_release_audit_complete',
    output: options.output,
    brands: report.brands,
    database_writes: 0,
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'two_brand_release_audit_error',
      error: error.message,
      database_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createClient,
  parseArgs,
  run,
};
