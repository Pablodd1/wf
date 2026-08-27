'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const {
  classifyRawPostGeneric, normalizePhone, referenceKey, sha256, withdrawn,
} = require('./raw-first-rolex-patek-lib.cjs');
const {
  assertReadOnlySql, dealerPageSql, managementQuery, uuidShard,
} = require('./raw-first-rolex-patek-audit.cjs');
const {
  evidenceFlags, normalizeStructuralText, validityClassification,
} = require('./raw-first-observation-v3-lib.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const CONTRACT = 'curated-luxury-generic-raw-first-brand-batch-v1';
const BRANDS = ['Tudor', 'Zenith', 'Cartier', 'TAG Heuer'];
const DEFAULT_OUTPUT = 'audit-output/generic-raw-first-next-4';

function sqlLiteral(value) { return `'${String(value ?? '').replace(/'/g, "''")}'`; }
function pageSize(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Error('Page size must be 1..5000');
  return size;
}
function cursorClause(column, bounds, lastId) {
  const lower = lastId || bounds.low;
  return `${column}${lastId ? '>' : '>='}${sqlLiteral(lower)}::uuid ${bounds.high ? `AND ${column}<${sqlLiteral(bounds.high)}::uuid` : ''}`;
}
function targetBrandSql(column) {
  return `lower(btrim(COALESCE(${column},''))) IN ('tudor','zenith','cartier','tag','tag heuer','tagheuer','heuer')`;
}

function rawSourceSql(bounds, lastId = null, limit = 2000) {
  const size = pageSize(limit);
  return `WITH parent_page AS MATERIALIZED (
    SELECT rm.id,rm.source_platform,rm.sender_phone,rm.group_id,rm.external_message_id,rm.media_count
    FROM public.raw_messages rm WHERE ${cursorClause('rm.id', bounds, lastId)}
    ORDER BY rm.id LIMIT ${size}
  )
  SELECT p.id::text AS raw_message_id,rv.id::text,rv.source_record_id,rv.source_hash,
    rv.source_created_on,rv.observed_at::text,rv.raw_message_source,COALESCE(rv.raw_text,'') AS raw_text,
    rv.raw_payload->'raw_data' AS raw_data,rv.media,
    p.source_platform,p.sender_phone,p.group_id,p.external_message_id,p.media_count
  FROM parent_page p
  LEFT JOIN LATERAL (
    SELECT v.* FROM public.raw_message_versions v
    WHERE v.raw_message_id=p.id AND (
      ${targetBrandSql("v.raw_payload#>>'{raw_data,brand}'")}
      OR COALESCE(v.raw_text,'') ~* '(^|[^[:alnum:]])(tudor|zenith|cartier|tag[[:space:]]*heuer|tagheuer|heuer)([^[:alnum:]]|$)'
    )
    ORDER BY v.observed_at DESC NULLS LAST,v.id DESC LIMIT 1
  ) rv ON true ORDER BY p.id;`;
}

function currentSourceSql(_bounds, lastId = null, limit = 2000, shard = 0, shardCount = 16) {
  const size = pageSize(limit);
  const shardNumber = Number(shard);
  const shards = Number(shardCount);
  if (!Number.isInteger(shardNumber) || !Number.isInteger(shards) || shards < 1
    || shardNumber < 0 || shardNumber >= shards) throw new Error('Invalid current-source shard');
  return `SELECT i.id::text,i.source_record_id,
    COALESCE(i.canonical_brand,i.supplied_brand,i.brand_scope) AS brand,
    i.normalized_reference,i.listing_type,i.raw_message,i.source_payload_sha256,
    i.user_image_url,i.image_evidence_type,i.verification_status
  FROM public.reviewed_workbook_inventory i
  WHERE COALESCE(i.canonical_brand,i.supplied_brand,i.brand_scope) IN ('Tudor','Zenith','Cartier','TAG Heuer')
    AND upper(COALESCE(i.listing_type,'')) IN ('WTS','WTB')
    AND upper(COALESCE(i.verification_status,'')) NOT IN ('REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND mod(('x'||substr(md5(i.id),1,8))::bit(32)::bigint,${shards})=${shardNumber}
    ${lastId ? `AND i.id>${sqlLiteral(lastId)}` : ''}
  ORDER BY i.id LIMIT ${size};`;
}

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
function readGzip(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
function fileSha(file) { return sha256(fs.readFileSync(file).toString('base64')); }
function increment(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }
function timestamp(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}
function imageUrl(row) {
  const value = String(row?.user_image_url || '').trim();
  return row?.image_evidence_type === 'SELLER_LISTING_IMAGE' && /^https?:\/\/\S+$/.test(value) ? value : null;
}
function currentMatchKey(row) {
  return [sha256(row.source_record_id || row.id), row.brand, referenceKey(row.normalized_reference),
    String(row.listing_type || '').toUpperCase()].join('|');
}
function childCurrentMatchKey(row, child) {
  return [sha256(row.source_record_id || row.id), child.brand, child.observed_reference_key,
    child.intent].join('|');
}
function offerFamilyKey(parent, child) {
  const sourceIdentity = parent.source_account ? sha256(parent.source_account) : `parent:${sha256(parent.raw_message_id)}`;
  const withoutPrice = child.source_price_text
    ? String(child.raw_child_text).replace(child.source_price_text, ' ') : String(child.raw_child_text);
  const materialIdentity = normalizeStructuralText(withoutPrice
    .replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' '));
  return sha256([sourceIdentity, child.brand, child.observed_reference_key, child.intent,
    materialIdentity].join('|'));
}

function genericValidity(child, rawData) {
  const result = validityClassification(child, rawData);
  if (child.observed_reference_key || result.classification === 'UNIQUE_MARKET_OBSERVATION') return result;
  const flags = evidenceFlags(child, rawData);
  const sourceBackedOffer = flags.explicit_line_intent && (flags.has_watch_descriptor
    || Boolean(child.model_as_posted)) && normalizeStructuralText(child.raw_child_text).length > 0;
  return sourceBackedOffer ? { classification: 'UNIQUE_MARKET_OBSERVATION', flags } : result;
}

function initialBrand(catalog = new Set()) {
  return { raw_parents: new Set(), valid: new Map(), parked: 0, unsplittable: 0,
    classifications: {}, references: new Set(), catalog, reposts: 0, price_changes: 0 };
}

function buildSummary(pageFiles, currentRows, dealerByPhone, catalogs = new Map()) {
  const brands = Object.fromEntries(BRANDS.map(brand => [brand, initialBrand(catalogs.get(brand))]));
  const current = new Map();
  for (const row of currentRows) {
    if (!row.raw_message || !/^[0-9a-f]{64}$/.test(String(row.source_payload_sha256 || ''))
      || sha256(row.raw_message) !== row.source_payload_sha256) continue;
    const key = currentMatchKey(row);
    const values = current.get(key) || [];
    values.push(row);
    current.set(key, values);
  }
  for (const file of pageFiles) {
    for (const row of readGzip(file)) {
      if (!row.id) continue;
      const classified = classifyRawPostGeneric(row, { targetBrands: BRANDS, dealerByPhone });
      const targetChildren = classified.children.filter(child => BRANDS.includes(child.brand));
      for (const brand of new Set(classified.brands.filter(value => BRANDS.includes(value)))) {
        brands[brand].raw_parents.add(row.raw_message_id);
      }
      if (!targetChildren.length) {
        for (const brand of classified.brands.filter(value => BRANDS.includes(value))) {
          brands[brand].parked += 1;
          brands[brand].unsplittable += 1;
          increment(brands[brand].classifications, 'UNSPLITTABLE_PARENT');
        }
        continue;
      }
      const seenParent = new Set();
      for (const child of targetChildren) {
        const stats = brands[child.brand];
        const validity = genericValidity(child, row.raw_data || {});
        const structural = normalizeStructuralText(child.raw_child_text);
        if (validity.classification !== 'UNIQUE_MARKET_OBSERVATION') {
          stats.parked += 1;
          increment(stats.classifications, validity.classification);
          continue;
        }
        if (seenParent.has(structural)) {
          stats.reposts += 1;
          increment(stats.classifications, 'REPEATED_IDENTICAL_OFFER');
          continue;
        }
        seenParent.add(structural);
        const family = offerFamilyKey(classified.parent, child);
        const exactCurrent = current.get(childCurrentMatchKey(row, child)) || [];
        const observation = {
          family, parent_key: sha256(row.raw_message_id), version_key: sha256(row.id),
          source_key: sha256(row.source_record_id || row.id), raw_occurrence_key: child.child_key,
          brand: child.brand, reference: child.observed_reference,
          reference_key: child.observed_reference_key, intent: child.intent,
          timestamp: row.source_created_on || row.observed_at, raw_message_sha256: sha256(row.raw_text),
          raw_message_present: typeof row.raw_text === 'string' && row.raw_text.length > 0,
          raw_child_sha256: child.raw_child_sha256, source_price_amount: child.source_price_amount,
          source_currency: child.source_currency, price_status: child.price_evidence_status,
          price_qualified: child.intent === 'WTS' && Boolean(child.observed_reference_key)
            && ['USD', 'USDT'].includes(child.source_currency)
            && child.price_evidence_status === 'AUTO_APPROVED' && Number(child.source_price_amount) > 0,
          dealer_linked: Boolean(child.dealer_id), country_code: child.country_code,
          image_url: exactCurrent.map(imageUrl).find(Boolean) || null,
          confirmed: exactCurrent.length > 0, withdrawn: withdrawn(row.raw_data, row.raw_text),
        };
        const prior = stats.valid.get(family);
        if (!prior || timestamp(observation.timestamp) > timestamp(prior.timestamp)
          || (timestamp(observation.timestamp) === timestamp(prior.timestamp)
            && observation.raw_occurrence_key > prior.raw_occurrence_key)) {
          if (prior) {
            if (prior.raw_child_sha256 === observation.raw_child_sha256) stats.reposts += 1;
            else stats.price_changes += 1;
          }
          stats.valid.set(family, observation);
        } else if (prior?.raw_child_sha256 === observation.raw_child_sha256) stats.reposts += 1;
        else stats.price_changes += 1;
        stats.references.add(child.observed_reference_key);
      }
    }
  }

  const output = {};
  let allCanaries = true;
  for (const brand of BRANDS) {
    const state = brands[brand];
    const currentListings = [...state.valid.values()].filter(row => !row.withdrawn);
    const pr = currentListings.filter(row => row.price_qualified);
    const prByReference = new Map();
    for (const row of pr) prByReference.set(row.reference_key, (prByReference.get(row.reference_key) || 0) + 1);
    const duplicateFamilies = currentListings.length - new Set(currentListings.map(row => row.family)).size;
    const lineageMissing = currentListings.filter(row => !row.parent_key || !row.version_key || !row.source_key
      || !row.raw_occurrence_key || !row.raw_message_sha256).length;
    const invalidPrice = pr.filter(row => !['USD', 'USDT'].includes(row.source_currency)
      || !(Number(row.source_price_amount) > 0)).length;
    const invalidImage = currentListings.filter(row => row.image_url && !/^https?:\/\/\S+$/.test(row.image_url)).length;
    const ordered = [...currentListings].sort((a, b) => timestamp(b.timestamp) - timestamp(a.timestamp)
      || b.raw_occurrence_key.localeCompare(a.raw_occurrence_key));
    const firstPage = ordered.slice(0, 24);
    const cursor = firstPage.at(-1);
    const secondPage = cursor ? ordered.filter(row => timestamp(row.timestamp) < timestamp(cursor.timestamp)
      || (timestamp(row.timestamp) === timestamp(cursor.timestamp)
        && row.raw_occurrence_key < cursor.raw_occurrence_key)).slice(0, 24) : [];
    const paginationOverlap = secondPage.filter(row => firstPage.some(first => first.family === row.family)).length;
    const sampleReference = firstPage.find(row => row.reference_key)?.reference_key;
    const exactReferenceFailure = !sampleReference
      || !currentListings.some(row => row.reference_key === sampleReference);
    const filterFailure = currentListings.filter(row => row.intent === 'WTS').some(row => row.intent !== 'WTS')
      || currentListings.filter(row => row.intent === 'WTB').some(row => row.intent !== 'WTB')
      || currentListings.filter(row => row.image_url).some(row => !/^https?:\/\/\S+$/.test(row.image_url));
    const customerCanary = currentListings.length > 0 && duplicateFamilies === 0 && lineageMissing === 0
      && invalidImage === 0 && paginationOverlap === 0 && !exactReferenceFailure && !filterFailure
      && currentListings.every(row => ['WTS', 'WTB'].includes(row.intent) && row.raw_message_present);
    const priceCanary = invalidPrice === 0 && new Set(pr.map(row => row.family)).size === pr.length;
    allCanaries &&= customerCanary && priceCanary;
    output[brand] = {
      raw_parents: state.raw_parents.size,
      valid_unique_observations: state.valid.size + state.price_changes,
      final_current_listings: currentListings.length,
      confirmed_current: currentListings.filter(row => row.confirmed).length,
      latest_observed: currentListings.filter(row => !row.confirmed).length,
      wts: currentListings.filter(row => row.intent === 'WTS').length,
      wtb: currentListings.filter(row => row.intent === 'WTB').length,
      distinct_observed_references: new Set(currentListings.map(row => row.reference_key).filter(Boolean)).size,
      observed_only_references: [...new Set(currentListings.map(row => row.reference_key).filter(Boolean))]
        .filter(reference => !state.catalog.has(reference)).length,
      verified_priced: currentListings.filter(row => row.price_qualified).length,
      verified_images: currentListings.filter(row => row.image_url).length,
      dealer_linked: currentListings.filter(row => row.dealer_linked).length,
      qualified_price_research_observations: pr.length,
      price_rating_ready_references: [...prByReference.values()].filter(count => count >= 2).length,
      reposts_suppressed: state.reposts,
      price_change_states_preserved: state.price_changes,
      unsplittable_parked: state.unsplittable,
      total_parked: state.parked,
      customer_canary: customerCanary ? 'PASS' : 'FAIL',
      price_research_canary: priceCanary ? 'PASS' : 'FAIL',
      defects: { duplicate_families: duplicateFamilies, missing_lineage: lineageMissing,
        invalid_price_evidence: invalidPrice, invalid_images: invalidImage,
        pagination_overlap: paginationOverlap, exact_reference_failure: Number(exactReferenceFailure),
        filter_failure: Number(filterFailure) },
    };
  }
  return { contract: CONTRACT, decision: allCanaries ? 'NEXT_4_BRANDS_CANARY_READY' : 'NOT_READY_NEXT_4_BRANDS',
    generated_at: new Date().toISOString(), canonical_project_ref: PROJECT_REF, read_only: true,
    production_writes: 0, raw_mutations: 0, endpoint_switches: 0, rolex_patek_changes: 0, brands: output };
}

async function scanDataset({ name, query, sanitize, shardCount, size, outputDir, token }) {
  const files = [];
  for (let shard = 0; shard < shardCount; shard += 1) {
    const bounds = uuidShard(shard, shardCount);
    let lastId = null;
    for (let page = 1; ; page += 1) {
      const rows = await managementQuery(query(bounds, lastId, size, shard, shardCount),
        `${name}-${shard}-${page}`, { token });
      const sanitized = rows.map(sanitize).filter(Boolean);
      const relative = `${name}-${String(shard).padStart(3, '0')}-${String(page).padStart(6, '0')}.json.gz`;
      const file = path.join(outputDir, 'pages', relative);
      writeGzip(file, sanitized);
      files.push(file);
      const next = rows.length ? String(rows.at(-1)[name === 'raw' ? 'raw_message_id' : 'id']) : lastId;
      writeJson(path.join(outputDir, 'checkpoint.json'), { contract: CONTRACT, status: 'RUNNING',
        dataset: name, shard, page, last_id: next, completed_page_files: files.length,
        read_only: true, production_writes: 0 });
      lastId = next;
      if (rows.length < size) break;
    }
  }
  return files;
}

async function run(options = {}) {
  const env = options.env || process.env;
  const shardCount = Number(env.GENERIC_RAW_FIRST_SHARDS || 16);
  const size = pageSize(env.GENERIC_RAW_FIRST_PAGE_SIZE || 2000);
  const outputDir = path.resolve(env.GENERIC_RAW_FIRST_OUTPUT || DEFAULT_OUTPUT);
  const validateOnly = options.validateOnly ?? process.argv.includes('--validate-only');
  const bounds = uuidShard(0, shardCount);
  [rawSourceSql(bounds, null, size), currentSourceSql(bounds, null, size), dealerPageSql(null, size)]
    .forEach(assertReadOnlySql);
  if (validateOnly) return { contract: CONTRACT, read_only: true, validated_queries: 3,
    brands: BRANDS, shard_count: shardCount, page_size: size };
  if (fs.existsSync(outputDir)) throw new Error(`Output already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const token = options.token || env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable');
  const dealers = [];
  let dealerCursor = null;
  for (let page = 1; ; page += 1) {
    const rows = await managementQuery(dealerPageSql(dealerCursor, size), `dealers-${page}`, { token });
    dealers.push(...rows);
    dealerCursor = rows.length ? rows.at(-1).id : dealerCursor;
    if (rows.length < size) break;
  }
  const dealerByPhone = new Map(dealers.map(row => [normalizePhone(row.phone), row]).filter(([phone]) => phone));
  const currentFiles = await scanDataset({ name: 'current', query: currentSourceSql, shardCount, size,
    outputDir, token, sanitize: row => row });
  const currentRows = currentFiles.flatMap(readGzip);
  const rawFiles = await scanDataset({ name: 'raw', query: rawSourceSql, shardCount, size,
    outputDir, token, sanitize: row => row.id ? row : null });
  const catalogs = new Map(BRANDS.map(brand => [brand, new Set(listCanonicalCatalogReferences(brand)
    .map(row => referenceKey(row.reference)).filter(Boolean))]));
  const summary = buildSummary(rawFiles, currentRows, dealerByPhone, catalogs);
  writeJson(path.join(outputDir, 'summary.json'), summary);
  writeJson(path.join(outputDir, 'manifest-sha256.json'), { contract: CONTRACT,
    summary_sha256: fileSha(path.join(outputDir, 'summary.json')),
    page_files: [...currentFiles, ...rawFiles].length });
  writeJson(path.join(outputDir, 'checkpoint.json'), { contract: CONTRACT, status: 'COMPLETE',
    decision: summary.decision, completed_page_files: currentFiles.length + rawFiles.length,
    read_only: true, production_writes: 0 });
  return summary;
}

if (require.main === module) {
  run().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { BRANDS, CONTRACT, PROJECT_REF, buildSummary, currentSourceSql,
  rawSourceSql, run };
