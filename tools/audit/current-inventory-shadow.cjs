'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const { classifyRawPost, normalizePhone, referenceKey } = require('./raw-first-rolex-patek-lib.cjs');
const { managementQuery, uuidShard } = require('./raw-first-rolex-patek-audit.cjs');
const { targetedRawSql } = require('./raw-first-observation-census-v3.cjs');
const { enrichParent, sha256 } = require('./raw-first-observation-v3-lib.cjs');
const {
  classifyOfferFamily,
  createObservationIdentity,
  displayTier,
  effectiveChildClassification,
  isQualifiedComparable,
  isVerifiedUsd,
  verifiedUsdAmount,
} = require('./current-inventory-shadow-lib.cjs');

const CONTRACT = 'watchfacts-current-inventory-shadow-v1';
const V2_CONTRACT = 'watchfacts-raw-first-rolex-patek-audit-v2';
const V3_CONTRACT = 'watchfacts-raw-first-observation-census-v3';
const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const BRANDS = ['Rolex', 'Patek Philippe'];
const TARGET_CLASSES = new Set(['MULTI_WATCH_PARTIALLY_SPLITTABLE', 'MULTI_WATCH_UNSPLITTABLE']);
const PARTITIONS = 256;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function writeGzip(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify(value)}\n`, { level: 9 }));
}

function readGzip(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

function fileChecksum(file) {
  return sha256(fs.readFileSync(file).toString('base64'));
}

function assertArtifact(root, contract) {
  const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'checkpoint.json'), 'utf8'));
  if (checkpoint.contract !== contract || checkpoint.status !== 'COMPLETE') {
    throw new Error(`Completed ${contract} artifact is required`);
  }
  return checkpoint;
}

function rawEntries(checkpoint) {
  return Object.entries(checkpoint.page_files || {})
    .filter(([, meta]) => meta.dataset === 'raw')
    .sort(([, a], [, b]) => a.shard - b.shard || a.page - b.page);
}

function priorCursor(entries, meta) {
  if (meta.page === 1) return null;
  return entries.find(([, item]) => item.shard === meta.shard && item.page === meta.page - 1)?.[1].last_id || null;
}

function dealerIdentitySql(lastId = null, limit = 2000) {
  const cursor = lastId ? `AND i.id>${Number(lastId)}` : '';
  return `SELECT i.id::text,public.normalize_seller_phone_identity(i.source_identity) AS phone,
    i.dealer_id::text,i.source_identity,d.country_code,d.rating,d.review_count
  FROM public.dealer_source_identities i JOIN public.dealers d ON d.id=i.dealer_id
  WHERE i.verification_status='VERIFIED' AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
    AND public.normalize_seller_phone_identity(i.source_identity) IS NOT NULL
    ${cursor} AND d.status='VERIFIED'
  ORDER BY i.id LIMIT ${Number(limit)};`;
}

async function loadDealers(options = {}) {
  const rows = [];
  let cursor = null;
  let page = 0;
  do {
    const batch = await managementQuery(dealerIdentitySql(cursor), `current-shadow-dealers-${page + 1}`, options);
    rows.push(...batch);
    cursor = batch.length ? batch.at(-1).id : cursor;
    page += 1;
    if (batch.length < 2000) break;
  } while (true);
  const byPhone = new Map();
  const bySourceHash = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) continue;
    const dealer = {
      ...row,
      dealer_key: sha256(row.dealer_id),
      rating_qualified: Number(row.rating) > 0 && Number(row.review_count) > 0,
    };
    byPhone.set(phone, dealer);
    bySourceHash.set(sha256(phone), dealer);
  }
  return { byPhone, bySourceHash, verified_identities: rows.length };
}

function initialBrandStats() {
  return {
    raw_parents: 0,
    raw_candidate_occurrences: 0,
    valid_unique_historical_observations: 0,
    invalid_occurrences: {},
  };
}

function initialCheckpoint(v2Run, v3Run) {
  return {
    contract: CONTRACT,
    canonical_project_ref: PROJECT_REF,
    status: 'RUNNING',
    decision: 'NOT_READY_CURRENT_INVENTORY_GAPS',
    read_only: true,
    production_writes: 0,
    database_concurrency: 1,
    v2_source_run: String(v2Run || ''),
    v3_source_run: String(v3Run || ''),
    processed_source_pages: {},
    partition_files: {},
    brands: Object.fromEntries(BRANDS.map(brand => [brand, initialBrandStats()])),
  };
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function partitionFor(key) {
  return Number.parseInt(String(key).slice(0, 2), 16);
}

function appendPartition(outputRoot, partition, rows, checkpoint) {
  if (!rows.length) return;
  const relative = `offer-partitions/partition-${String(partition).padStart(3, '0')}.jsonl.gz`;
  const file = path.join(outputRoot, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
  fs.appendFileSync(file, zlib.gzipSync(payload, { level: 6 }));
  checkpoint.partition_files[relative] = { relative, rows: (checkpoint.partition_files[relative]?.rows || 0) + rows.length };
}

function parsePartition(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim();
  return text ? text.split('\n').map(line => JSON.parse(line)) : [];
}

function artifactManifest(outputRoot) {
  const roots = ['offer-partitions', 'current-pages', 'family-pages'];
  const files = ['canary-evidence.json', 'observed-reference-registry.json.gz'];
  for (const directory of roots) {
    const absolute = path.join(outputRoot, directory);
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isFile()) files.push(`${directory}/${entry.name}`);
    }
  }
  return files.sort().map(relative => {
    const file = path.join(outputRoot, relative);
    return { relative, bytes: fs.statSync(file).size, sha256: fileChecksum(file) };
  });
}

function catalogSets() {
  return new Map(BRANDS.map(brand => [brand, new Set(
    listCanonicalCatalogReferences(brand).map(row => referenceKey(row.reference)).filter(Boolean),
  )]));
}

function compactObservation({ occurrence, parent, artifactRecord, sourcePage, origin, dealer, sourceStatus,
  sourceImageKey, priceEvidenceClassification, modelAsPosted, normalizedUsdAmount, usdNormalizationMethod }) {
  const brand = occurrence.observed_brand || parent.brand || artifactRecord.brand;
  const classification = effectiveChildClassification({ ...occurrence, brand });
  if (classification !== 'UNIQUE_MARKET_OBSERVATION' || !BRANDS.includes(brand)) {
    return { classification, brand: BRANDS.includes(brand) ? brand : artifactRecord.brand, row: null };
  }
  const provisional = {
    parent_key: parent.parent_key || artifactRecord.parent_key,
    version_key: parent.version_key || artifactRecord.version_key,
    source_key: parent.source_key || artifactRecord.source_key,
    source_page: sourcePage,
    origin,
    raw_occurrence_key: occurrence.raw_occurrence_key,
    unique_observation_key: occurrence.unique_observation_key,
    exact_child_text_sha256: occurrence.exact_child_text_sha256,
    normalized_structural_text_sha256: occurrence.normalized_structural_text_sha256,
    parent_raw_text_sha256: parent.raw_text_sha256 || null,
    source_identity_key: occurrence.source_identity_key || parent.source_identity_key || null,
    dealer_key: dealer?.dealer_key || null,
    dealer_rating_qualified: dealer?.rating_qualified === true,
    brand,
    observed_reference: occurrence.exact_observed_reference || null,
    observed_reference_key: occurrence.observed_reference_key || null,
    intent: occurrence.intent || null,
    condition: occurrence.condition || null,
    dial_or_color: occurrence.dial_or_color || null,
    serial_or_distinguishing_marker: occurrence.serial_or_distinguishing_marker || null,
    quantity_marker: occurrence.quantity_marker || null,
    source_timestamp: occurrence.source_timestamp || parent.source_timestamp || null,
    source_price_text: occurrence.source_price_text || null,
    source_price_amount: Number(occurrence.source_price_amount) || null,
    source_currency: occurrence.explicit_currency || null,
    price_evidence_classification: priceEvidenceClassification || null,
    normalized_usd_amount: Number(normalizedUsdAmount) > 0 ? Number(normalizedUsdAmount) : null,
    source_image_key: sourceImageKey || null,
    image_linked: occurrence.image_linked === true || Boolean(sourceImageKey),
    country_code: dealer?.country_code || occurrence.country_code || null,
    source_status: sourceStatus || null,
    disposition: artifactRecord.disposition || parent.disposition || {},
    parent_classification: artifactRecord.classification || parent.original_classification || null,
    search_text: [brand, occurrence.exact_observed_reference, modelAsPosted, occurrence.dial_or_color]
      .filter(Boolean).join(' '),
    live_source_verified: origin === 'LIVE_SOURCE_RECHECK',
    raw_child_text: occurrence.raw_child_text,
  };
  const identity = createObservationIdentity(provisional);
  const normalizedUsd = verifiedUsdAmount(provisional);
  const row = {
    ...provisional,
    normalized_usd_amount: normalizedUsd,
    usd_normalization_method: normalizedUsd === null ? null : (usdNormalizationMethod
      || (provisional.source_currency === 'USD' ? 'DIRECT_SOURCE_USD'
        : provisional.source_currency === 'USDT' ? 'SOURCE_USDT_PARITY' : null)),
    ...identity,
  };
  delete row.raw_child_text;
  return { classification, brand, row };
}

function occurrenceManifest(rows) {
  return rows.map(row => [row.raw_occurrence_key, row.classification, row.exact_child_text_sha256].join('|')).sort();
}

function liveRows(sourceRow, artifactRecord, sourcePage, dealers, expectedV3Parent = null) {
  const classified = classifyRawPost(sourceRow, { dealerByPhone: dealers.byPhone });
  const occurrences = enrichParent(classified, artifactRecord);
  if (classified.classification === 'NOT_A_WATCH_LISTING') {
    for (const occurrence of occurrences) occurrence.classification = 'NON_WATCH_FRAGMENT';
  }
  if (expectedV3Parent) {
    const expected = occurrenceManifest(expectedV3Parent.occurrences || []);
    const actual = occurrenceManifest(occurrences);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`V3 occurrence manifest drift ${artifactRecord.parent_key}`);
    }
  }
  return occurrences.map((occurrence, index) => {
    const child = classified.children[index] || {};
    const dealer = classified.parent.source_account ? dealers.byPhone.get(classified.parent.source_account) : null;
    occurrence.country_code = child.country_code || null;
    return compactObservation({
      occurrence,
      parent: {
        parent_key: artifactRecord.parent_key,
        version_key: artifactRecord.version_key,
        source_key: artifactRecord.source_key,
        raw_text_sha256: classified.parent.raw_text_sha256,
        source_timestamp: classified.parent.source_created_on || classified.parent.observed_at,
      },
      artifactRecord,
      sourcePage,
      origin: 'LIVE_SOURCE_RECHECK',
      dealer,
      sourceStatus: classified.parent.raw_data?.status
        || classified.parent.raw_data?.listing_status
        || classified.parent.raw_data?.availability_status
        || null,
      sourceImageKey: child.source_image ? sha256(child.source_image) : null,
      priceEvidenceClassification: child.price_evidence_status || null,
      normalizedUsdAmount: child.normalized_usd_amount,
      usdNormalizationMethod: child.usd_normalization_method,
      modelAsPosted: child.model_as_posted || null,
    });
  });
}

function aggregateTemplate() {
  return {
    offer_families: 0, current_active: 0, current_latest_state: 0, status_unresolved: 0,
    current_wts: 0, current_wtb: 0, current_priced: 0, current_image_linked: 0,
    current_dealer_linked: 0, current_dealer_rating_linked: 0, current_location_resolved: 0,
    current_observed_references: new Set(), current_observed_only_references: new Set(),
    repost_groups: 0, repost_collapsed: 0, historical_only: 0, withdrawn: 0, superseded: 0,
    qualified_historical_price_states: 0, qualified_reference_counts: new Map(),
    display: { IMAGE_AND_PRICE: 0, IMAGE_ONLY: 0, PRICE_ONLY: 0, NEITHER: 0 },
    canary_pool: [], canary_by_reference: new Map(),
  };
}

function updateReference(registry, row, field, amount = 1) {
  if (!row.observed_reference_key) return;
  const key = `${row.brand}|${row.observed_reference_key}`;
  const current = registry.get(key) || {
    brand: row.brand,
    observed_reference: row.observed_reference,
    observed_reference_key: row.observed_reference_key,
    source_occurrence_count: 0,
    unique_market_observation_count: 0,
    current_listing_count: 0,
    wts: 0, wtb: 0, priced: 0, image_linked: 0, dealer_linked: 0,
    qualified_comparable_states: 0,
    first_seen: row.source_timestamp || null,
    last_seen: row.source_timestamp || null,
  };
  current[field] = (current[field] || 0) + amount;
  if (row.source_timestamp && (!current.first_seen || row.source_timestamp < current.first_seen)) current.first_seen = row.source_timestamp;
  if (row.source_timestamp && (!current.last_seen || row.source_timestamp > current.last_seen)) current.last_seen = row.source_timestamp;
  registry.set(key, current);
}

function publicBrand(stats, ingest, catalogs) {
  const refs = [...stats.current_observed_references];
  const observedOnly = refs.filter(ref => !catalogs.has(ref));
  const comparableRefs = [...stats.qualified_reference_counts.entries()].filter(([, count]) => count > 0);
  const ratingReady = comparableRefs.filter(([, count]) => count >= 2).length;
  const current = stats.current_active;
  const invalidOccurrenceCount = Object.values(ingest.invalid_occurrences)
    .reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    historical_raw_parents: ingest.raw_parents,
    historical_raw_candidate_occurrences: ingest.raw_candidate_occurrences,
    historical_unique_market_observations: ingest.valid_unique_historical_observations,
    current_offer_families: stats.offer_families,
    current_active: current,
    current_latest_state: stats.current_latest_state,
    status_unresolved: stats.status_unresolved,
    current_wts: stats.current_wts,
    current_wtb: stats.current_wtb,
    current_priced: stats.current_priced,
    current_image_linked: stats.current_image_linked,
    current_dealer_linked: stats.current_dealer_linked,
    current_dealer_unresolved: current - stats.current_dealer_linked,
    current_location_resolved: stats.current_location_resolved,
    current_observed_references: refs.length,
    current_observed_only_references: observedOnly.length,
    repost_groups: stats.repost_groups,
    repost_collapsed: stats.repost_collapsed,
    historical_only: stats.historical_only,
    withdrawn: stats.withdrawn,
    superseded: stats.superseded,
    invalid_fragments: ingest.invalid_occurrences,
    qualified_historical_price_research_observations: stats.qualified_historical_price_states,
    distinct_references_represented_in_price_research: comparableRefs.length,
    analytics_ready_references: comparableRefs.length,
    price_rating_ready_references: ratingReady,
    observed_only_reference_analytics: comparableRefs.filter(([ref]) => !catalogs.has(ref)).length,
    display_readiness: stats.display,
    coverage: {
      dealer_identity_percent: current ? Number((stats.current_dealer_linked * 100 / current).toFixed(4)) : 0,
      dealer_rating_percent: current ? Number((stats.current_dealer_rating_linked * 100 / current).toFixed(4)) : 0,
      location_percent: current ? Number((stats.current_location_resolved * 100 / current).toFixed(4)) : 0,
      source_image_percent: current ? Number((stats.current_image_linked * 100 / current).toFixed(4)) : 0,
      verified_price_percent: current ? Number((stats.current_priced * 100 / current).toFixed(4)) : 0,
    },
    reconciliation: {
      historical_unique_market_observations: ingest.valid_unique_historical_observations,
      child_gate_candidate_occurrences: ingest.raw_candidate_occurrences,
      child_gate_invalid_occurrences: invalidOccurrenceCount,
      child_gate_reconciles: ingest.raw_candidate_occurrences
        === ingest.valid_unique_historical_observations + invalidOccurrenceCount,
      current_active: stats.current_active,
      status_unresolved: stats.status_unresolved,
      repost_collapsed: stats.repost_collapsed,
      historical_only: stats.historical_only,
      withdrawn: stats.withdrawn,
      superseded: stats.superseded,
      reconciles: ingest.valid_unique_historical_observations === stats.current_active + stats.status_unresolved
        + stats.repost_collapsed + stats.historical_only + stats.withdrawn + stats.superseded,
    },
  };
}

async function run(options = {}) {
  const env = options.env || process.env;
  const validateOnly = options.validateOnly ?? process.argv.includes('--validate-only');
  if (validateOnly) {
    const sql = dealerIdentitySql();
    return { contract: CONTRACT, canonical_project_ref: PROJECT_REF, read_only: true,
      production_writes: 0, database_concurrency: 1, partitions: PARTITIONS,
      validated_select_queries: [sql, targetedRawSql(uuidShard(0, 16), null,
        '0fffffff-ffff-ffff-ffff-ffffffffffff', ['a'.repeat(64)])].length };
  }
  const v2Root = path.resolve(env.RAW_FIRST_V2_ARTIFACT || 'audit-v2-input');
  const v3Root = path.resolve(env.RAW_FIRST_V3_ARTIFACT || 'audit-v3-input');
  const outputRoot = path.resolve(env.CURRENT_INVENTORY_OUTPUT || 'audit-output/current-inventory-shadow');
  if (fs.existsSync(outputRoot)) throw new Error(`Output already exists: ${outputRoot}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  const v2 = assertArtifact(v2Root, V2_CONTRACT);
  const v3 = assertArtifact(v3Root, V3_CONTRACT);
  const entries = rawEntries(v2);
  const v3BySource = new Map(Object.values(v3.page_files || {}).map(meta => [meta.source_page, meta]));
  const checkpoint = initialCheckpoint(env.V2_ARTIFACT_RUN_ID, env.V3_ARTIFACT_RUN_ID);
  writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
  const dealers = await loadDealers(options);
  const catalogs = catalogSets();
  try {
    for (const [relative, meta] of entries) {
      const sourceFile = path.join(v2Root, relative);
      if (fileChecksum(sourceFile) !== meta.sha256) throw new Error(`V2 checksum mismatch: ${relative}`);
      const records = readGzip(sourceFile).filter(record => BRANDS.includes(record.brand));
      for (const record of records) {
        checkpoint.brands[record.brand].raw_parents += 1;
      }
      const targetRecords = records.filter(record => TARGET_CLASSES.has(record.classification));
      const enriched = [];
      const v3Parents = new Map();
      if (targetRecords.length) {
        const v3Meta = v3BySource.get(relative);
        if (!v3Meta) throw new Error(`Missing V3 source page: ${relative}`);
        const v3File = path.join(v3Root, v3Meta.relative);
        if (fileChecksum(v3File) !== v3Meta.sha256) throw new Error(`V3 checksum mismatch: ${v3Meta.relative}`);
        for (const parent of readGzip(v3File)) v3Parents.set(parent.parent_key, parent);
        for (const record of targetRecords) {
          if (!v3Parents.has(record.parent_key)) throw new Error(`Missing V3 parent ${record.parent_key}`);
        }
      }
      if (records.length) {
        const bounds = uuidShard(meta.shard, v2.shard_count);
        const sourceRows = await managementQuery(targetedRawSql(bounds, priorCursor(entries, meta), meta.last_id,
          records.map(record => record.parent_key)), `current-shadow-${meta.shard}-${meta.page}`, options);
        const sourceByParent = new Map(sourceRows.map(row => [sha256(row.raw_message_id), row]));
        for (const record of records) {
          const sourceRow = sourceByParent.get(record.parent_key);
          if (!sourceRow) throw new Error(`Missing live source parent ${record.parent_key}`);
          if (sha256(sourceRow.id) !== record.version_key) throw new Error(`Latest version drift ${record.parent_key}`);
          enriched.push(...liveRows(sourceRow, record, relative, dealers, v3Parents.get(record.parent_key) || null));
        }
      }
      const batches = Array.from({ length: PARTITIONS }, () => []);
      for (const result of enriched) {
        const brand = BRANDS.includes(result.brand) ? result.brand : null;
        if (brand) checkpoint.brands[brand].raw_candidate_occurrences += 1;
        if (!result.row) {
          if (brand) increment(checkpoint.brands[brand].invalid_occurrences, result.classification);
          continue;
        }
        checkpoint.brands[result.row.brand].valid_unique_historical_observations += 1;
        batches[partitionFor(result.row.offer_family_key)].push(result.row);
      }
      for (let partition = 0; partition < PARTITIONS; partition += 1) {
        appendPartition(outputRoot, partition, batches[partition], checkpoint);
      }
      checkpoint.processed_source_pages[relative] = true;
      checkpoint.updated_at = new Date().toISOString();
      writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
    }

    const aggregates = Object.fromEntries(BRANDS.map(brand => [brand, aggregateTemplate()]));
    const registry = new Map();
    const familyManifest = new Set();
    for (const relative of Object.keys(checkpoint.partition_files).sort()) {
      const rows = parsePartition(path.join(outputRoot, relative));
      const families = new Map();
      for (const row of rows) {
        const family = families.get(row.offer_family_key) || [];
        family.push(row);
        families.set(row.offer_family_key, family);
        updateReference(registry, row, 'source_occurrence_count');
        updateReference(registry, row, 'unique_market_observation_count');
      }
      const currentRows = [];
      const familyRows = [];
      for (const familyRowsInput of families.values()) {
        const family = classifyOfferFamily(familyRowsInput);
        if (familyManifest.has(family.offer_family_key)) throw new Error(`Duplicate family partition ${family.offer_family_key}`);
        familyManifest.add(family.offer_family_key);
        const stats = aggregates[family.brand];
        stats.offer_families += 1;
        if (family.repost_collapsed) stats.repost_groups += 1;
        stats.repost_collapsed += family.repost_collapsed;
        stats.historical_only += family.historical_only;
        if (family.current_status === 'WITHDRAWN') stats.withdrawn += 1;
        if (family.current_status === 'SUPERSEDED' || family.current_status === 'SUPPRESSED_EXACT_DUPLICATE') stats.superseded += 1;
        if (family.current_status === 'CURRENT_LATEST_STATE') stats.status_unresolved += 1;
        if (['CURRENT_ACTIVE', 'CURRENT_LATEST_STATE'].includes(family.current_status)) stats.current_latest_state += 1;

        const states = new Map();
        for (const row of familyRowsInput) states.set(row.offer_state_key, row);
        for (const state of states.values()) {
          if (isQualifiedComparable(state)) {
            stats.qualified_historical_price_states += 1;
            stats.qualified_reference_counts.set(state.observed_reference_key,
              (stats.qualified_reference_counts.get(state.observed_reference_key) || 0) + 1);
            updateReference(registry, state, 'qualified_comparable_states');
          }
        }

        if (family.current_status === 'CURRENT_ACTIVE') {
          const latest = family.latest_observation;
          stats.current_active += 1;
          if (latest.intent === 'WTS') stats.current_wts += 1;
          if (latest.intent === 'WTB') stats.current_wtb += 1;
          if (isVerifiedUsd(latest)) stats.current_priced += 1;
          if (latest.image_linked) stats.current_image_linked += 1;
          if (latest.dealer_key) stats.current_dealer_linked += 1;
          if (latest.dealer_rating_qualified) stats.current_dealer_rating_linked += 1;
          if (latest.country_code) stats.current_location_resolved += 1;
          increment(stats.display, displayTier(latest));
          if (latest.observed_reference_key) {
            stats.current_observed_references.add(latest.observed_reference_key);
            if (!catalogs.get(latest.brand).has(latest.observed_reference_key)) {
              stats.current_observed_only_references.add(latest.observed_reference_key);
            }
          }
          updateReference(registry, latest, 'current_listing_count');
          if (latest.intent === 'WTS') updateReference(registry, latest, 'wts');
          if (latest.intent === 'WTB') updateReference(registry, latest, 'wtb');
          if (isVerifiedUsd(latest)) updateReference(registry, latest, 'priced');
          if (latest.image_linked) updateReference(registry, latest, 'image_linked');
          if (latest.dealer_key) updateReference(registry, latest, 'dealer_linked');
          currentRows.push({
            current_listing_key: family.offer_family_key,
            offer_family_key: family.offer_family_key,
            offer_state_key: latest.offer_state_key,
            current_status: family.current_status,
            ...latest,
          });
          if (latest.live_source_verified) {
            if (stats.canary_pool.length < 2000) stats.canary_pool.push(currentRows.at(-1));
            if (latest.observed_reference_key && !stats.canary_by_reference.has(latest.observed_reference_key)) {
              stats.canary_by_reference.set(latest.observed_reference_key, currentRows.at(-1));
            }
          }
        }
        familyRows.push({
          offer_family_key: family.offer_family_key,
          brand: family.brand,
          observed_reference_key: family.observed_reference_key,
          historical_observations: family.historical_observations,
          distinct_offer_states: family.distinct_offer_states,
          repost_collapsed: family.repost_collapsed,
          historical_only: family.historical_only,
          price_change_states: family.price_change_states,
          current_status: family.current_status,
          first_seen: family.first_seen,
          last_seen: family.last_seen,
          latest_parent_key: family.latest_observation.parent_key,
        });
      }
      const suffix = path.basename(relative).replace('.jsonl.gz', '');
      writeGzip(path.join(outputRoot, `current-pages/${suffix}.json.gz`), currentRows);
      writeGzip(path.join(outputRoot, `family-pages/${suffix}.json.gz`), familyRows);
    }

    const registryRows = [...registry.values()].map(row => ({
      ...row,
      catalog_status: catalogs.get(row.brand).has(row.observed_reference_key) ? 'CATALOG_CONFIRMED' : 'OBSERVED_ONLY',
    })).sort((a, b) => a.brand.localeCompare(b.brand)
      || a.observed_reference_key.localeCompare(b.observed_reference_key));
    writeGzip(path.join(outputRoot, 'observed-reference-registry.json.gz'), registryRows);

    const canary = [];
    for (const brand of BRANDS) {
      const stats = aggregates[brand];
      const byRef = registryRows.filter(row => row.brand === brand && row.current_listing_count > 0)
        .sort((a, b) => b.current_listing_count - a.current_listing_count || a.observed_reference_key.localeCompare(b.observed_reference_key));
      const common = byRef[0]?.observed_reference_key;
      const rare = [...byRef].reverse()[0]?.observed_reference_key;
      const observedOnly = byRef.find(row => row.catalog_status === 'OBSERVED_ONLY')?.observed_reference_key;
      const selectors = [
        [`${brand}_COMMON_REFERENCE`, row => row.observed_reference_key === common, stats.canary_by_reference.get(common)],
        [`${brand}_RARE_REFERENCE`, row => row.observed_reference_key === rare, stats.canary_by_reference.get(rare)],
        [`${brand}_OBSERVED_ONLY_REFERENCE`, row => row.observed_reference_key === observedOnly,
          stats.canary_by_reference.get(observedOnly)],
        [`${brand}_WTB`, row => row.intent === 'WTB'],
        [`${brand}_IMAGE_AND_PRICE`, row => displayTier(row) === 'IMAGE_AND_PRICE'],
        [`${brand}_IMAGE_ONLY`, row => displayTier(row) === 'IMAGE_ONLY'],
        [`${brand}_PRICE_ONLY`, row => displayTier(row) === 'PRICE_ONLY'],
        [`${brand}_DEALER_LINKED`, row => Boolean(row.dealer_key)],
        [`${brand}_MULTI_WATCH_CHILD`, row => String(row.parent_classification).startsWith('MULTI_WATCH')],
      ];
      for (const [label, predicate, directRow] of selectors) {
        const row = directRow || stats.canary_pool.find(predicate);
        canary.push({
          label,
          status: row ? 'VERIFIED_FROM_LIVE_SOURCE_RECHECK' : 'NOT_AVAILABLE_IN_ACTIVE_LIVE_RECHECK_POOL',
          current_listing_key: row?.current_listing_key || null,
          brand: row?.brand || brand,
          observed_reference: row?.observed_reference || null,
          intent: row?.intent || null,
          raw_evidence_match: row?.live_source_verified === true,
          price_currency_verified: row ? isVerifiedUsd(row) : false,
          dealer_verified: Boolean(row?.dealer_key),
          image_verified: Boolean(row?.source_image_key),
          location_verified: Boolean(row?.country_code),
          raw_message_hash_verified: Boolean(row?.parent_raw_text_sha256),
          exact_reference_search_verified: Boolean(row?.observed_reference_key),
          multi_country_filter_contract_verified: row ? Boolean(row.country_code) : false,
        });
      }
    }
    writeJson(path.join(outputRoot, 'canary-evidence.json'), { contract: CONTRACT, canary });

    const manifest = artifactManifest(outputRoot);
    writeJson(path.join(outputRoot, 'manifest-sha256.json'), { contract: CONTRACT, files: manifest });
    for (const [relative, metadata] of Object.entries(checkpoint.partition_files)) {
      const item = manifest.find(row => row.relative === relative);
      if (item) Object.assign(metadata, { bytes: item.bytes, sha256: item.sha256 });
    }

    const publicBrands = Object.fromEntries(BRANDS.map(brand => [brand,
      publicBrand(aggregates[brand], checkpoint.brands[brand], catalogs.get(brand))]));
    const reconciliationPass = BRANDS.every(brand => publicBrands[brand].reconciliation.reconciles
      && publicBrands[brand].reconciliation.child_gate_reconciles);
    const remaining = {
      status_unresolved_offer_families: BRANDS.reduce((sum, brand) => sum + publicBrands[brand].status_unresolved, 0),
      unsplittable_parents: BRANDS.reduce((sum, brand) => sum
        + (checkpoint.brands[brand].invalid_occurrences.UNSPLITTABLE_PARENT || 0), 0),
      canary_requirements_unavailable: canary.filter(row => row.status !== 'VERIFIED_FROM_LIVE_SOURCE_RECHECK').length,
      next_brand_source_census_required: ['Tudor', 'Zenith', 'Cartier', 'TAG Heuer'],
    };
    const canaryReady = reconciliationPass && remaining.status_unresolved_offer_families === 0
      && remaining.unsplittable_parents === 0 && remaining.canary_requirements_unavailable === 0;
    const summary = {
      contract: CONTRACT,
      decision: canaryReady ? 'CURATED_LUXURY_ROLEX_PATEK_CANARY_READY' : 'NOT_READY_CURRENT_INVENTORY_GAPS',
      generated_at: new Date().toISOString(),
      canonical_project_ref: PROJECT_REF,
      read_only: true,
      production_writes: 0,
      raw_mutations: 0,
      production_source_switch: false,
      ui_changes: 0,
      catalog_requirement: false,
      database_concurrency: 1,
      source_evidence: { v2_contract: V2_CONTRACT, v3_contract: V3_CONTRACT,
        v2_pages_verified: entries.length, v3_pages_available: Object.keys(v3.page_files || {}).length,
        verified_dealer_source_identities: dealers.verified_identities },
      offer_family_manifest_count: familyManifest.size,
      offer_family_manifest_unique: familyManifest.size === BRANDS.reduce((sum, brand) => sum + aggregates[brand].offer_families, 0),
      artifact_manifest_files: manifest.length,
      brands: publicBrands,
      canary_summary: {
        requested_checks: canary.length,
        verified_checks: canary.filter(row => row.status === 'VERIFIED_FROM_LIVE_SOURCE_RECHECK').length,
        failed_checks: canary.filter(row => row.status !== 'VERIFIED_FROM_LIVE_SOURCE_RECHECK').length,
      },
      next_brand_readiness: Object.fromEntries(['Tudor', 'Zenith', 'Cartier', 'TAG Heuer']
        .map(brand => [brand, { engine_generic: true, source_census_completed: false }])),
      remaining_queues: remaining,
    };
    writeJson(path.join(outputRoot, 'summary.json'), summary);
    checkpoint.status = 'COMPLETE';
    checkpoint.decision = summary.decision;
    checkpoint.offer_family_manifest_count = summary.offer_family_manifest_count;
    checkpoint.updated_at = new Date().toISOString();
    writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
    return summary;
  } catch (error) {
    checkpoint.status = 'INCOMPLETE';
    checkpoint.decision = 'NOT_READY_CURRENT_INVENTORY_GAPS';
    checkpoint.failure = { message: String(error.message || error).slice(0, 500) };
    checkpoint.updated_at = new Date().toISOString();
    writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
    const summary = { contract: CONTRACT, decision: checkpoint.decision, read_only: true,
      production_writes: 0, raw_mutations: 0, error: checkpoint.failure.message,
      processed_source_pages: Object.keys(checkpoint.processed_source_pages).length };
    writeJson(path.join(outputRoot, 'summary.json'), summary);
    return summary;
  }
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.error) process.exitCode = 1;
    else if (!process.argv.includes('--validate-only')
      && result.decision !== 'CURATED_LUXURY_ROLEX_PATEK_CANARY_READY') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, read_only: true,
      production_writes: 0, error: String(error.message || error).slice(0, 500) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT,
  PARTITIONS,
  compactObservation,
  dealerIdentitySql,
  occurrenceManifest,
  partitionFor,
  run,
};
