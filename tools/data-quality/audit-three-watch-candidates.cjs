'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_EXISTING = ['Rolex::116610LN', 'Patek Philippe::5712/1A-001'];
const VERIFIED_IDENTITY_STATUSES = new Set(['CATALOG_CONFIRMED', 'HUMAN_APPROVED']);

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
    brands: String(values.brands || 'Rolex|Patek Philippe').split('|').map(value => value.trim()).filter(Boolean),
    existing: new Set(String(values.existing || DEFAULT_EXISTING.join('|')).split('|').map(value => value.trim()).filter(Boolean)),
    third: String(values.third || 'Rolex::126710BLNR').trim(),
    output: path.resolve(values.output || 'audit-output/three-watch-release/candidate-ranking.json'),
  };
}

function normalizeReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cohortKey(brand, reference) {
  return `${String(brand || '').trim().toLowerCase()}::${normalizeReference(reference)}`;
}

function releaseKey(brand, reference) {
  return `${String(brand || '').trim()}::${String(reference || '').trim()}`;
}

function createRestClient(baseUrl, key, fetchFn = fetch) {
  if (!baseUrl || !key) throw new Error('SUPABASE_URL and a Supabase server key are required');
  const root = `${String(baseUrl).replace(/\/$/, '')}/rest/v1`;
  return async function readAll(table, select, filters = {}, order = '') {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const params = new URLSearchParams({ select });
      for (const [column, expression] of Object.entries(filters)) params.set(column, expression);
      if (order) params.set('order', order);
      const response = await fetchFn(`${root}/${table}?${params}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Range: `${from}-${from + pageSize - 1}`,
          'Range-Unit': 'items',
        },
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Supabase ${response.status} while reading ${table}: ${detail.slice(0, 250)}`);
      }
      const page = await response.json();
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  };
}

function increment(map, key, field, amount = 1) {
  const row = map.get(key);
  if (row) row[field] += amount;
}

function releaseTargets(selectedThirdCandidate) {
  return [
    { brand: 'Rolex', reference: '116610LN', aliases: ['116610LN'] },
    { brand: 'Patek Philippe', reference: '5712/1A-001', aliases: ['5712/1A-001', '5712/1A'] },
    {
      brand: selectedThirdCandidate.brand,
      reference: selectedThirdCandidate.reference,
      aliases: [selectedThirdCandidate.reference],
    },
  ];
}

async function readByRecordIds(readAll, table, select, recordIds, idColumn = 'id') {
  const batches = [];
  for (let index = 0; index < recordIds.length; index += 200) {
    batches.push(recordIds.slice(index, index + 200));
  }
  const rows = [];
  for (let index = 0; index < batches.length; index += 8) {
    const page = await Promise.all(batches.slice(index, index + 8).map(batch => readAll(
      table,
      select,
      {
        [idColumn]: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      },
      `${idColumn}.asc`,
    )));
    rows.push(...page.flat());
  }
  return rows;
}

async function run(options, fetchFn = fetch) {
  const readAll = createRestClient(options.baseUrl, options.key, fetchFn);
  const brandFilter = `in.(${options.brands.map(brand => `"${brand.replaceAll('"', '')}"`).join(',')})`;
  const identities = await readAll(
    'listing_identity_reviews',
    'record_id,status,canonical_brand,canonical_model,canonical_reference,canonical_dial_color',
    {
      status: 'in.(CATALOG_CONFIRMED,HUMAN_APPROVED)',
      canonical_brand: brandFilter,
      canonical_reference: 'not.is.null',
    },
    'record_id.asc',
  );
  const identityByRecord = new Map();
  const cohorts = new Map();
  for (const identity of identities) {
    if (!VERIFIED_IDENTITY_STATUSES.has(identity.status)) continue;
    const brand = String(identity.canonical_brand || '').trim();
    const reference = String(identity.canonical_reference || '').trim();
    const key = cohortKey(brand, reference);
    if (!brand || !reference || !key) continue;
    identityByRecord.set(String(identity.record_id), { ...identity, key });
    if (!cohorts.has(key)) {
      cohorts.set(key, {
        brand,
        reference,
        model: identity.canonical_model || null,
        exact_identity_records: 0,
        price_research_wts: 0,
        source_linked_images: 0,
        visually_verified_images: 0,
        seller_review_candidates: 0,
        sample_record_ids: [],
      });
    }
    const cohort = cohorts.get(key);
    cohort.exact_identity_records += 1;
    if (!cohort.model && identity.canonical_model) cohort.model = identity.canonical_model;
    if (cohort.sample_record_ids.length < 5) cohort.sample_record_ids.push(identity.record_id);
  }

  const priceRows = await readByRecordIds(
    readAll,
    'price_research_verified_source',
    'id,brand,reference,listing_type',
    [...identityByRecord.keys()],
  );
  for (const row of priceRows) {
    if (row.listing_type === 'WTS') increment(cohorts, cohortKey(row.brand, row.reference), 'price_research_wts');
  }

  const imageRows = await readAll(
    'listing_image_reviews',
    'source_object_key,record_id,status',
    { record_id: 'not.is.null' },
    'record_id.asc',
  );
  for (const image of imageRows) {
    const identity = identityByRecord.get(String(image.record_id));
    if (!identity) continue;
    if (image.status === 'SOURCE_LINKED') increment(cohorts, identity.key, 'source_linked_images');
    if (image.status === 'VISUALLY_VERIFIED') increment(cohorts, identity.key, 'visually_verified_images');
  }

  const sellerRows = await readAll(
    'seller_lineage_review_queue',
    'record_id,lineage_id',
    {},
    'lineage_id.asc',
  );
  for (const seller of sellerRows) {
    const identity = identityByRecord.get(String(seller.record_id));
    if (identity) increment(cohorts, identity.key, 'seller_review_candidates');
  }

  const ranking = [...cohorts.values()]
    .map(cohort => ({
      ...cohort,
      release_key: releaseKey(cohort.brand, cohort.reference),
      analytics_ready: cohort.price_research_wts >= 5,
    }))
    .filter(cohort => cohort.analytics_ready && !options.existing.has(cohort.release_key))
    .sort((a, b) =>
      b.visually_verified_images - a.visually_verified_images
      || b.source_linked_images - a.source_linked_images
      || b.seller_review_candidates - a.seller_review_candidates
      || b.price_research_wts - a.price_research_wts
      || b.exact_identity_records - a.exact_identity_records
      || a.release_key.localeCompare(b.release_key));
  if (!ranking[0]) throw new Error('No eligible third reference candidate found');
  const selectedThirdCandidate = [...cohorts.values()]
    .map(cohort => ({
      ...cohort,
      release_key: releaseKey(cohort.brand, cohort.reference),
      analytics_ready: cohort.price_research_wts >= 5,
    }))
    .find(cohort => cohort.release_key === options.third && cohort.analytics_ready);
  if (!selectedThirdCandidate) {
    throw new Error(`Configured third reference is not analytics-ready: ${options.third}`);
  }

  const targets = releaseTargets(selectedThirdCandidate);
  const targetByRecord = new Map();
  for (const [recordId, identity] of identityByRecord) {
    const target = targets.find(candidate =>
      candidate.brand.toLowerCase() === String(identity.canonical_brand || '').trim().toLowerCase()
      && candidate.aliases.some(alias =>
        normalizeReference(alias) === normalizeReference(identity.canonical_reference)));
    if (target) targetByRecord.set(recordId, target);
  }
  const reviewQueueRows = await readByRecordIds(
    readAll,
    'image_identity_review_queue',
    'source_object_key,public_url,record_id,brand,model,reference,dial_color,raw_message,image_status,identity_status',
    [...targetByRecord.keys()],
    'record_id',
  );
  const releaseReadiness = targets.map(target => {
    const matchingKeys = [...cohorts.entries()]
      .filter(([, cohort]) =>
        target.brand.toLowerCase() === cohort.brand.toLowerCase()
        && target.aliases.some(alias => normalizeReference(alias) === normalizeReference(cohort.reference)))
      .map(([key]) => key);
    const metrics = matchingKeys.map(key => cohorts.get(key));
    const recordIds = [...targetByRecord.entries()]
      .filter(([, candidate]) => candidate === target)
      .map(([recordId]) => recordId);
    const recordIdSet = new Set(recordIds);
    const reviewCandidates = reviewQueueRows
      .filter(row =>
        recordIdSet.has(String(row.record_id))
        && row.image_status === 'SOURCE_LINKED'
        && VERIFIED_IDENTITY_STATUSES.has(row.identity_status)
        && row.public_url)
      .slice(0, 5)
      .map(row => ({
        source_object_key: row.source_object_key,
        public_url: row.public_url,
        record_id: row.record_id,
        brand: row.brand,
        model: row.model,
        reference: row.reference,
        dial_color: row.dial_color,
        raw_message: row.raw_message,
      }));
    return {
      brand: target.brand,
      reference: target.reference,
      accepted_identity_aliases: target.aliases,
      exact_identity_records: metrics.reduce((sum, cohort) => sum + cohort.exact_identity_records, 0),
      price_research_wts: metrics.reduce((sum, cohort) => sum + cohort.price_research_wts, 0),
      source_linked_images: metrics.reduce((sum, cohort) => sum + cohort.source_linked_images, 0),
      visually_verified_images: metrics.reduce((sum, cohort) => sum + cohort.visually_verified_images, 0),
      seller_review_candidates: metrics.reduce((sum, cohort) => sum + cohort.seller_review_candidates, 0),
      image_review_candidates: reviewCandidates,
    };
  });

  const report = {
    contract: 'three-watch-candidate-ranking-v1',
    generated_at: new Date().toISOString(),
    selection_policy: [
      'Exact approved identity is mandatory.',
      'At least five strict Price Research WTS rows are mandatory.',
      'Rank visually verified images, then exact source-linked images, then exact seller review candidates, then price evidence.',
      'Condition is not part of the analytics cohort key.',
    ],
    existing_release: [...options.existing],
    automated_top_candidate: ranking[0],
    selected_third_candidate: selectedThirdCandidate,
    canary_exclusions: [
      {
        release_key: 'Rolex::228235',
        reason: 'Rejected for this release after immutable source evidence showed Sundust/Chocolate dial descriptions while the approved canonical dial was Green.',
      },
      {
        release_key: 'Rolex::124300',
        reason: 'Deferred because this is a multi-dial reference and needs a broader raw-to-dial canary before customer publication.',
      },
      {
        release_key: 'Rolex::126334',
        reason: 'Deferred because this is a multi-dial reference and needs a broader raw-to-dial canary before customer publication.',
      },
    ],
    release_readiness: releaseReadiness,
    ranking: ranking.slice(0, 25),
    totals: {
      approved_identity_rows_read: identities.length,
      price_research_rows_read: priceRows.length,
      image_review_rows_read: imageRows.length,
      seller_review_rows_read: sellerRows.length,
      image_queue_rows_read: reviewQueueRows.length,
    },
    safety: {
      mode: 'READ_ONLY',
      database_writes: 0,
      production_records_changed: 0,
    },
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await run(options);
  process.stdout.write(`${JSON.stringify({
    event: 'three_watch_candidate_ranking_complete',
    output: options.output,
    selected_third_candidate: report.selected_third_candidate,
    database_writes: 0,
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'three_watch_candidate_ranking_error',
      error: error.message,
      database_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  cohortKey,
  createRestClient,
  normalizeReference,
  parseArgs,
  readByRecordIds,
  releaseTargets,
  run,
};
