'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const {
  BRANDS,
  POST_CLASSES,
  classifyRawPost,
  normalizePhone,
  priceResearchEligible,
  referenceKey,
  sha256,
  withdrawn,
} = require('./raw-first-rolex-patek-lib.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const CONTRACT = 'watchfacts-raw-first-rolex-patek-audit-v1';
const DEFAULT_OUTPUT = 'audit-output/raw-first-rolex-patek';

function assertReadOnlySql(sql) {
  const scrubbed = String(sql)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const mutation = scrubbed.match(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|REFRESH|VACUUM|ANALYZE|SET|RESET|NOTIFY|LISTEN|LOCK)\b/i);
  if (mutation) throw new Error(`SQL is not read-only: ${mutation[1]}`);
  if (!/^\s*(?:WITH|SELECT)\b/i.test(scrubbed) || (scrubbed.match(/;/g) || []).length !== 1 || !/;\s*$/.test(scrubbed)) {
    throw new Error('SQL must be exactly one WITH/SELECT statement');
  }
}

async function managementQuery(sql, label, options = {}) {
  assertReadOnlySql(sql);
  const token = options.token || process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable');
  const response = await (options.fetchImpl || fetch)(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: true }),
      signal: AbortSignal.timeout(Number(options.timeoutMs || 300_000)),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} failed ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

function uuidShard(index, shardCount) {
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 256 || 256 % shardCount !== 0) {
    throw new Error('RAW_FIRST_SHARDS must be a divisor of 256 from 1 to 256');
  }
  const width = 256 / shardCount;
  const lowByte = index * width;
  const highByte = (index + 1) * width;
  const uuid = byte => `${byte.toString(16).padStart(2, '0')}000000-0000-0000-0000-000000000000`;
  return { low: uuid(lowByte), high: highByte < 256 ? uuid(highByte) : null };
}

function rawSourceSql(bounds) {
  return `SELECT rv.id::text,rv.raw_message_id::text,rv.source_record_id,rv.source_hash,
    rv.source_created_on,rv.observed_at::text,rv.raw_message_source,COALESCE(rv.raw_text,'') AS raw_text,
    rv.raw_payload->'raw_data' AS raw_data,rv.media,
    rm.source_platform,rm.sender_phone,rm.group_id,rm.external_message_id,rm.media_count
  FROM public.raw_message_versions rv
  JOIN public.raw_messages rm ON rm.id=rv.raw_message_id
  WHERE rv.id>='${bounds.low}'::uuid ${bounds.high ? `AND rv.id<'${bounds.high}'::uuid` : ''}
    AND (
      lower(btrim(COALESCE(rv.raw_payload#>>'{raw_data,brand}',''))) IN
        ('rolex','patek','patek philippe','philippe patek')
      OR COALESCE(rv.raw_text,'') ~* '(^|[^[:alnum:]])(rolex|patek([[:space:]]+philippe)?|philippe[[:space:]]+patek)([^[:alnum:]]|$)'
      OR (
        NULLIF(btrim(COALESCE(rv.raw_payload#>>'{raw_data,brand}','')),'') IS NULL
        AND NULLIF(btrim(COALESCE(rv.raw_payload#>>'{raw_data,reference}','')),'') IS NOT NULL
      )
    )
  ORDER BY rv.id;`;
}

function currentListingsSql(bounds) {
  return `WITH control AS MATERIALIZED (
    SELECT canonical_brand,enabled_run_key,trading_floor_enabled,price_research_enabled
    FROM public.qnsa_two_brand_release_control
    WHERE canonical_brand IN ('Rolex','Patek Philippe')
  )
  SELECT l.id::text,l.source_record_id,l.raw_message_version_id::text,l.source_hash,
    l.brand_normalized AS brand,l.reference_original,l.reference_normalized,
    upper(COALESCE(l.listing_type,l.intent,'')) AS intent,l.parent_id::text,l.is_bundle,
    l.trading_floor_status,l.price_research_status,l.verdict,l.publication_review_status,
    l.price_normalized,l.currency_normalized,l.price_usd,l.image_url,l.public_image_eligible,
    (
      c.trading_floor_enabled
      AND upper(COALESCE(l.category,''))='WATCH'
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id,'')<>''
      AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN
        ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
         'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN
        ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND lower(COALESCE(l.price_research_status,''))<>'suppressed_exact_duplicate'
      AND upper(COALESCE(l.publication_review_status,'PENDING_REVIEW')) IN
        ('PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
    ) AS current_trading_floor_eligible
  FROM staging.listings l JOIN control c
    ON c.enabled_run_key=l.normalization_run_key AND c.canonical_brand=l.brand_normalized
  WHERE l.id>='${bounds.low}'::uuid ${bounds.high ? `AND l.id<'${bounds.high}'::uuid` : ''}
  ORDER BY l.id;`;
}

function phase7bSql(bounds) {
  return `WITH completed AS MATERIALIZED (
    SELECT run_key FROM price_research_shadow.runs
    WHERE project_ref='${PROJECT_REF}' AND status='COMPLETE'
    ORDER BY completed_at DESC NULLS LAST LIMIT 1
  )
  SELECT o.listing_id::text,o.source_record_id,o.raw_message_version_id::text,o.brand,
    o.canonical_reference,o.price_evidence_classification,o.verified_usd_amount
  FROM price_research_shadow.observations o JOIN completed r ON r.run_key=o.run_key
  WHERE o.listing_id>='${bounds.low}'::uuid ${bounds.high ? `AND o.listing_id<'${bounds.high}'::uuid` : ''}
  ORDER BY o.listing_id;`;
}

const DEALERS_SQL = `WITH unique_phone AS (
  SELECT public.normalize_seller_phone_identity(source_identity) AS phone,
    min(dealer_id)::text AS dealer_id,count(DISTINCT dealer_id) AS dealer_count,
    min(source_identity) AS source_identity
  FROM public.dealer_source_identities
  WHERE verification_status='VERIFIED' AND upper(identity_type) IN ('PHONE','WHATSAPP')
  GROUP BY public.normalize_seller_phone_identity(source_identity)
)
SELECT u.phone,u.dealer_id,u.source_identity,d.display_name,d.company_name,d.country_code
FROM unique_phone u JOIN public.dealers d ON d.id=u.dealer_id::uuid
WHERE u.phone IS NOT NULL AND u.dealer_count=1 AND d.status='VERIFIED'
ORDER BY u.phone;`;

const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'project_ref','${PROJECT_REF}',
  'raw_messages',(SELECT count(*) FROM public.raw_messages),
  'raw_message_versions',(SELECT count(*) FROM public.raw_message_versions),
  'raw_rolex_patek_versions',(SELECT count(*) FROM public.raw_message_versions rv WHERE
    lower(btrim(COALESCE(rv.raw_payload#>>'{raw_data,brand}',''))) IN ('rolex','patek','patek philippe','philippe patek')
    OR COALESCE(rv.raw_text,'') ~* '(^|[^[:alnum:]])(rolex|patek([[:space:]]+philippe)?|philippe[[:space:]]+patek)([^[:alnum:]]|$)'),
  'raw_blank_brand_with_reference',(SELECT count(*) FROM public.raw_message_versions rv WHERE
    NULLIF(btrim(COALESCE(rv.raw_payload#>>'{raw_data,brand}','')),'') IS NULL
    AND NULLIF(btrim(COALESCE(rv.raw_payload#>>'{raw_data,reference}','')),'') IS NOT NULL),
  'phase7b',(SELECT to_jsonb(r) FROM price_research_shadow.runs r
    WHERE r.project_ref='${PROJECT_REF}' AND r.status='COMPLETE' ORDER BY r.completed_at DESC NULLS LAST LIMIT 1),
  'controls',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.canonical_brand) FROM public.qnsa_two_brand_release_control c
    WHERE c.canonical_brand IN ('Rolex','Patek Philippe'))
) AS snapshot;`;

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function jsonWriter(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const gzip = zlib.createGzip({ level: 9 });
  const output = fs.createWriteStream(filePath);
  gzip.pipe(output);
  return {
    async write(value) {
      if (!gzip.write(`${JSON.stringify(value)}\n`)) await once(gzip, 'drain');
    },
    async close() {
      gzip.end();
      await once(output, 'close');
    },
  };
}

function catalogSets() {
  return new Map(BRANDS.map(brand => [brand, new Set(
    listCanonicalCatalogReferences(brand).map(row => referenceKey(row.reference)).filter(Boolean),
  )]));
}

function currentDisposition(rows) {
  const statuses = rows.flatMap(row => [row.trading_floor_status, row.price_research_status, row.verdict])
    .map(value => String(value || '').toUpperCase());
  return {
    duplicate: statuses.some(value => value.includes('DUPLICATE')),
    withdrawn: statuses.some(value => value.includes('WITHDRAWN')),
    published: rows.some(row => row.current_trading_floor_eligible === true),
  };
}

function blankBrandQueue(row) {
  return !String(row.raw_data?.brand || '').trim() && !/(?:rolex|patek)/i.test(String(row.raw_text || ''));
}

function brandSummary() {
  return {
    raw_posts_scanned: 0,
    legitimate_watch_posts: 0,
    single_watch_posts: 0,
    multi_watch_posts: 0,
    safely_generated_child_observations: 0,
    partially_splittable_observations: 0,
    genuinely_unsplittable_observations: 0,
    total_resulting_watch_observations: 0,
    wts: 0,
    wtb: 0,
    explicit_observed_references: 0,
    distinct_observed_references: 0,
    observed_references_found_in_catalog: 0,
    observed_references_absent_from_catalog: 0,
    explicit_prices: 0,
    explicit_currencies: 0,
    qualified_price_research_observations: 0,
    image_linked_observations: 0,
    dealer_linked_observations: 0,
    unresolved_dealer_observations: 0,
    location_country_resolved_observations: 0,
    current_trading_floor_observations: 0,
    phase7b_observations: 0,
    review_counts_by_reason: {},
  };
}

async function run(options = {}) {
  const env = options.env || process.env;
  const shardCount = Number(env.RAW_FIRST_SHARDS || 256);
  const outputDir = path.resolve(env.RAW_FIRST_OUTPUT || DEFAULT_OUTPUT);
  const validateOnly = options.validateOnly ?? process.argv.includes('--validate-only');
  const sqls = [DEALERS_SQL, SNAPSHOT_SQL];
  for (let index = 0; index < shardCount; index += 1) {
    const bounds = uuidShard(index, shardCount);
    sqls.push(rawSourceSql(bounds), currentListingsSql(bounds), phase7bSql(bounds));
  }
  sqls.forEach(assertReadOnlySql);
  if (validateOnly) {
    return { contract: CONTRACT, read_only: true, validated_queries: sqls.length, shard_count: shardCount };
  }

  if (fs.existsSync(outputDir)) throw new Error(`Output already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const snapshot = (await managementQuery(SNAPSHOT_SQL, 'source-snapshot', options))?.[0]?.snapshot;
  if (snapshot?.project_ref !== PROJECT_REF) throw new Error('Canonical QNSA snapshot check failed');
  const dealers = await managementQuery(DEALERS_SQL, 'dealer-identities', options);
  const dealerByPhone = new Map(dealers.map(row => [normalizePhone(row.phone), row]).filter(([phone]) => phone));

  const currentBySource = new Map();
  const phase7bBySource = new Map();
  const rawRows = [];
  for (let index = 0; index < shardCount; index += 1) {
    const bounds = uuidShard(index, shardCount);
    const [raw, current, phase7b] = await Promise.all([
      managementQuery(rawSourceSql(bounds), `raw-${index}`, options),
      managementQuery(currentListingsSql(bounds), `current-${index}`, options),
      managementQuery(phase7bSql(bounds), `phase7b-${index}`, options),
    ]);
    rawRows.push(...raw);
    for (const row of current) {
      if (!currentBySource.has(row.source_record_id)) currentBySource.set(row.source_record_id, []);
      currentBySource.get(row.source_record_id).push(row);
    }
    for (const row of phase7b) {
      if (!phase7bBySource.has(row.source_record_id)) phase7bBySource.set(row.source_record_id, []);
      phase7bBySource.get(row.source_record_id).push(row);
    }
  }

  const latestByMessage = new Map();
  for (const row of rawRows) {
    const previous = latestByMessage.get(row.raw_message_id);
    const key = `${row.observed_at || ''}|${row.id}`;
    const priorKey = previous ? `${previous.observed_at || ''}|${previous.id}` : '';
    if (!previous || key > priorKey) latestByMessage.set(row.raw_message_id, row);
  }

  const writers = new Map(BRANDS.map(brand => [brand, jsonWriter(path.join(
    outputDir, `${brand.toLowerCase().replace(/\s+/g, '-')}-manifest.jsonl.gz`,
  ))]));
  const unresolvedWriter = jsonWriter(path.join(outputDir, 'remaining-queues.jsonl.gz'));
  const summaries = Object.fromEntries(BRANDS.map(brand => [brand, brandSummary()]));
  const distinctRefs = new Map(BRANDS.map(brand => [brand, new Set()]));
  const catalogs = catalogSets();
  const dispositionCounts = {};

  for (const row of latestByMessage.values()) {
    const classification = classifyRawPost(row, { dealerByPhone });
    const brand = classification.brand;
    if (!brand || !BRANDS.includes(brand) || blankBrandQueue(row)) {
      await unresolvedWriter.write({ queue: 'RAW_BRAND_UNRESOLVED_WITH_REFERENCE', row });
      increment(dispositionCounts, 'RAW_BRAND_UNRESOLVED_WITH_REFERENCE');
      continue;
    }
    const summary = summaries[brand];
    summary.raw_posts_scanned += 1;
    if (classification.classification !== 'NOT_A_WATCH_LISTING') summary.legitimate_watch_posts += 1;
    if (classification.classification === 'SINGLE_WATCH') summary.single_watch_posts += 1;
    if (classification.classification.startsWith('MULTI_WATCH')) summary.multi_watch_posts += 1;
    if (classification.classification === 'MULTI_WATCH_SAFE_TO_SPLIT') summary.safely_generated_child_observations += classification.children.length;
    if (classification.classification === 'MULTI_WATCH_PARTIALLY_SPLITTABLE') summary.partially_splittable_observations += classification.children.length;
    if (classification.classification === 'MULTI_WATCH_UNSPLITTABLE') summary.genuinely_unsplittable_observations += 1;

    const currentRows = currentBySource.get(row.source_record_id) || [];
    const phaseRows = phase7bBySource.get(row.source_record_id) || [];
    const disposition = currentDisposition(currentRows);
    disposition.withdrawn ||= withdrawn(row.raw_data, row.raw_text);
    disposition.superseded = false;
    if (disposition.duplicate) increment(dispositionCounts, 'duplicate');
    else if (disposition.withdrawn) increment(dispositionCounts, 'withdrawn');
    else if (classification.classification === 'NOT_A_WATCH_LISTING') increment(dispositionCounts, 'non_listing');
    else if (!classification.children.length) increment(dispositionCounts, 'genuinely_ambiguous');
    else increment(dispositionCounts, 'child_candidate');

    for (const reason of classification.review_reasons || []) increment(summary.review_counts_by_reason, reason);
    for (const child of classification.children) {
      summary.total_resulting_watch_observations += 1;
      if (child.intent === 'WTS') summary.wts += 1;
      else if (child.intent === 'WTB') summary.wtb += 1;
      else increment(summary.review_counts_by_reason, 'INTENT_UNRESOLVED');
      if (child.observed_reference_key) {
        summary.explicit_observed_references += 1;
        distinctRefs.get(brand).add(child.observed_reference_key);
        if (catalogs.get(brand).has(child.observed_reference_key)) summary.observed_references_found_in_catalog += 1;
        else summary.observed_references_absent_from_catalog += 1;
      } else increment(summary.review_counts_by_reason, 'REFERENCE_UNRESOLVED');
      if (Number(child.source_price_amount) > 0) summary.explicit_prices += 1;
      else increment(summary.review_counts_by_reason, child.price_evidence_status || 'PRICE_UNRESOLVED');
      if (child.source_currency) summary.explicit_currencies += 1;
      else increment(summary.review_counts_by_reason, 'CURRENCY_UNRESOLVED');
      if (priceResearchEligible(child, disposition)) summary.qualified_price_research_observations += 1;
      if (child.source_image) summary.image_linked_observations += 1;
      else increment(summary.review_counts_by_reason, child.source_image_status || 'IMAGE_UNRESOLVED');
      if (child.dealer_id) summary.dealer_linked_observations += 1;
      else summary.unresolved_dealer_observations += 1;
      if (child.country_code) summary.location_country_resolved_observations += 1;
      else increment(summary.review_counts_by_reason, 'LOCATION_COUNTRY_UNRESOLVED');
    }
    summary.current_trading_floor_observations += currentRows.filter(item => item.current_trading_floor_eligible === true).length;
    summary.phase7b_observations += phaseRows.length;

    await writers.get(brand).write({
      contract: CONTRACT,
      classification: classification.classification,
      parent: classification.parent,
      children: classification.children,
      disposition,
      current_listings: currentRows,
      phase7b_observations: phaseRows,
      review_reasons: classification.review_reasons || [],
      unresolved_fragments: classification.unresolved_fragments || [],
    });
  }

  for (const brand of BRANDS) {
    summaries[brand].distinct_observed_references = distinctRefs.get(brand).size;
    await writers.get(brand).close();
  }
  await unresolvedWriter.close();

  const accounted = Object.values(dispositionCounts).reduce((sum, value) => sum + value, 0);
  const remainingQueues = {
    raw_brand_unresolved_with_reference: dispositionCounts.RAW_BRAND_UNRESOLVED_WITH_REFERENCE || 0,
    multi_watch_unsplittable: BRANDS.reduce((sum, brand) => sum + summaries[brand].genuinely_unsplittable_observations, 0),
    multi_watch_partially_splittable: BRANDS.reduce((sum, brand) => sum + summaries[brand].partially_splittable_observations, 0),
    unresolved_dealer_observations: BRANDS.reduce((sum, brand) => sum + summaries[brand].unresolved_dealer_observations, 0),
  };
  const blockingQueueCount = remainingQueues.raw_brand_unresolved_with_reference
    + remainingQueues.multi_watch_unsplittable + remainingQueues.multi_watch_partially_splittable;
  const decision = blockingQueueCount === 0 && accounted === latestByMessage.size
    ? 'RAW_FIRST_READY' : 'NOT_READY_RAW_SOURCE_GAPS';
  const result = {
    contract: CONTRACT,
    decision,
    generated_at: new Date().toISOString(),
    canonical_project_ref: PROJECT_REF,
    read_only: true,
    production_writes: 0,
    raw_mutations: 0,
    endpoint_switches: 0,
    ui_changes: 0,
    catalog_changes: 0,
    phase7b_rerun: false,
    snapshot,
    raw_versions_selected: rawRows.length,
    raw_posts_selected: latestByMessage.size,
    raw_posts_accounted: accounted,
    disposition_counts: dispositionCounts,
    brands: summaries,
    remaining_queues: remainingQueues,
  };
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'manifest-sha256.json'), `${JSON.stringify({
    contract: CONTRACT,
    generated_at: result.generated_at,
    files: Object.fromEntries(fs.readdirSync(outputDir).sort().map(name => [
      name, sha256(fs.readFileSync(path.join(outputDir, name))),
    ])),
  }, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.decision === 'NOT_READY_RAW_SOURCE_GAPS') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, decision: 'NOT_READY_RAW_SOURCE_GAPS', error: error.message, read_only: true, production_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT,
  DEALERS_SQL,
  PROJECT_REF,
  SNAPSHOT_SQL,
  assertReadOnlySql,
  currentListingsSql,
  managementQuery,
  phase7bSql,
  rawSourceSql,
  run,
  uuidShard,
};
