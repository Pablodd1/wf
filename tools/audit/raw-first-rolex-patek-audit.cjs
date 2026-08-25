'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const {
  BRANDS,
  classifyRawPost,
  normalizePhone,
  priceResearchEligible,
  referenceKey,
  sha256,
  withdrawn,
} = require('./raw-first-rolex-patek-lib.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const CONTRACT = 'watchfacts-raw-first-rolex-patek-audit-v2';
const DEFAULT_OUTPUT = 'audit-output/raw-first-rolex-patek';
const DATASETS = ['current', 'membership', 'phase7b', 'raw'];

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

function pageLimit(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Error('Page size must be 1..5000');
  return size;
}

function cursorClause(column, bounds, lastId) {
  const lower = lastId || bounds.low;
  return `${column}${lastId ? '>' : '>='}'${lower}'::uuid ${bounds.high ? `AND ${column}<'${bounds.high}'::uuid` : ''}`;
}

function rawSourceSql(bounds, lastId = null, limit = 2000) {
  const size = pageLimit(limit);
  return `WITH parent_page AS MATERIALIZED (
    SELECT rm.id,rm.source_platform,rm.sender_phone,rm.group_id,rm.external_message_id,rm.media_count
    FROM public.raw_messages rm
    WHERE ${cursorClause('rm.id', bounds, lastId)}
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
      lower(btrim(COALESCE(v.raw_payload#>>'{raw_data,brand}',''))) IN
        ('rolex','patek','patek philippe','philippe patek')
      OR COALESCE(v.raw_text,'') ~* '(^|[^[:alnum:]])(rolex|patek([[:space:]]+philippe)?|philippe[[:space:]]+patek)([^[:alnum:]]|$)'
      OR (
        NULLIF(btrim(COALESCE(v.raw_payload#>>'{raw_data,brand}','')),'') IS NULL
        AND NULLIF(btrim(COALESCE(v.raw_payload#>>'{raw_data,reference}','')),'') IS NOT NULL
      )
    )
    ORDER BY v.observed_at DESC NULLS LAST,v.id DESC LIMIT 1
  ) rv ON true
  ORDER BY p.id;`;
}

function currentListingsSql(bounds, lastId = null, limit = 2000) {
  const size = pageLimit(limit);
  return `SELECT l.id::text,l.source_record_id,l.brand_normalized AS brand,
    l.trading_floor_status,l.price_research_status,l.verdict
  FROM staging.listings l
  WHERE l.brand_normalized IN ('Rolex','Patek Philippe')
    AND ${cursorClause('l.id', bounds, lastId)}
  ORDER BY l.id LIMIT ${size};`;
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function tradingFloorMembershipSql(currentRows, limit = 2000) {
  const size = pageLimit(limit);
  const listingIds = [...new Set(currentRows.map(row => row.id).filter(Boolean))];
  const sourceIds = [...new Set(currentRows.map(row => row.source_record_id).filter(Boolean))];
  if (!listingIds.length || !sourceIds.length) {
    return `SELECT tf.id::text AS id,tf.source_record_id
    FROM public.qnsa_rolex_patek_reviewed_release_base tf
    WHERE false ORDER BY tf.id LIMIT ${size};`;
  }
  return `SELECT tf.id::text AS id,tf.source_record_id
  FROM public.qnsa_rolex_patek_reviewed_release_base tf
  WHERE tf.source_record_id IN (${sourceIds.map(sqlLiteral).join(',')})
    AND tf.id IN (${listingIds.map(value => `${sqlLiteral(value)}::uuid`).join(',')})
    AND tf.trading_floor_enabled=true
    AND upper(COALESCE(tf.publication_review_status,'PENDING_REVIEW')) IN
      ('PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
  ORDER BY tf.id LIMIT ${size};`;
}

function phase7bSql(bounds, lastId = null, limit = 2000) {
  const size = pageLimit(limit);
  return `WITH completed AS MATERIALIZED (
    SELECT run_key FROM price_research_shadow.runs
    WHERE project_ref='${PROJECT_REF}' AND status='COMPLETE'
    ORDER BY completed_at DESC NULLS LAST LIMIT 1
  )
  SELECT o.listing_id::text,o.source_record_id,o.brand,o.price_evidence_classification
  FROM price_research_shadow.observations o JOIN completed r ON r.run_key=o.run_key
  WHERE ${cursorClause('o.listing_id', bounds, lastId)}
  ORDER BY o.listing_id LIMIT ${size};`;
}

function dealerPageSql(lastId = null, limit = 2000) {
  const size = pageLimit(limit);
  return `SELECT i.id::text,public.normalize_seller_phone_identity(i.source_identity) AS phone,
    i.dealer_id::text,i.source_identity,d.country_code
  FROM public.dealer_source_identities i JOIN public.dealers d ON d.id=i.dealer_id
  WHERE i.verification_status='VERIFIED' AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
    AND public.normalize_seller_phone_identity(i.source_identity) IS NOT NULL
    ${lastId ? `AND i.id>${Number(lastId)}` : ''}
    AND d.status='VERIFIED'
  ORDER BY i.id LIMIT ${size};`;
}

const DEALERS_SQL = dealerPageSql();

const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'project_ref','${PROJECT_REF}',
  'phase7b',(SELECT to_jsonb(r) FROM price_research_shadow.runs r
    WHERE r.project_ref='${PROJECT_REF}' AND r.status='COMPLETE' ORDER BY r.completed_at DESC NULLS LAST LIMIT 1),
  'controls',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.canonical_brand) FROM public.qnsa_two_brand_release_control c
    WHERE c.canonical_brand IN ('Rolex','Patek Philippe'))
) AS snapshot;`;

const PHASE7B_SUMMARY_SQL = `WITH completed AS MATERIALIZED (
  SELECT run_key FROM price_research_shadow.runs
  WHERE project_ref='${PROJECT_REF}' AND status='COMPLETE'
  ORDER BY completed_at DESC NULLS LAST LIMIT 1
)
SELECT c.brand,count(*) AS reference_rows,
  sum(c.total_published_listings) AS authoritative_published_listings,
  sum(c.wts_listings) AS authoritative_wts_listings,
  sum(c.wtb_listings) AS authoritative_wtb_listings,
  sum(c.legacy_pr_observations) AS legacy_price_research_observations,
  sum(c.verified_pr_observations) AS verified_price_research_observations,
  sum(c.verified_qualified_comparable_count) AS verified_qualified_comparable_observations
FROM price_research_shadow.reference_census c
JOIN completed r ON r.run_key=c.run_key
GROUP BY c.brand ORDER BY c.brand;`;

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function writeGzipJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, zlib.gzipSync(`${JSON.stringify(value)}\n`, { level: 9 }));
}

function sourceKey(sourceRecordId, fallbackId) {
  return sourceRecordId ? sha256(sourceRecordId) : `listing:${sha256(fallbackId)}`;
}

function readGzipJson(filePath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

function initialCheckpoint(shardCount, pageSize) {
  const dataset = () => ({ shards: Array.from({ length: shardCount }, () => ({
    last_id: null, complete: false, pages: 0, database_rows: 0, sanitized_rows: 0,
  })) });
  return {
    contract: CONTRACT,
    canonical_project_ref: PROJECT_REF,
    decision: 'AUDIT_INCOMPLETE_TECHNICAL',
    status: 'RUNNING',
    read_only: true,
    page_size: pageSize,
    shard_count: shardCount,
    datasets: Object.fromEntries(DATASETS.map(name => [name, dataset()])),
    page_files: {},
    completed_pages: 0,
    production_writes: 0,
  };
}

function restoreCheckpoint(resumeDir, outputDir, shardCount, pageSize) {
  const checkpointFile = resumeDir && path.join(path.resolve(resumeDir), 'checkpoint.json');
  if (!checkpointFile || !fs.existsSync(checkpointFile)) return initialCheckpoint(shardCount, pageSize);
  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  if (checkpoint.contract !== CONTRACT || checkpoint.canonical_project_ref !== PROJECT_REF
    || checkpoint.shard_count !== shardCount || checkpoint.page_size !== pageSize) {
    throw new Error('Resume checkpoint contract/project/paging mismatch');
  }
  for (const relative of Object.keys(checkpoint.page_files || {})) {
    const source = path.join(path.resolve(resumeDir), relative);
    const target = path.join(outputDir, relative);
    if (!fs.existsSync(source)
      || sha256(fs.readFileSync(source).toString('base64')) !== checkpoint.page_files[relative].sha256) {
      throw new Error(`Resume page checksum mismatch: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  checkpoint.status = 'RUNNING';
  checkpoint.decision = 'AUDIT_INCOMPLETE_TECHNICAL';
  checkpoint.resumed_from = path.resolve(resumeDir);
  return checkpoint;
}

function pageFiles(checkpoint, outputDir, dataset) {
  return Object.entries(checkpoint.page_files)
    .filter(([, meta]) => meta.dataset === dataset)
    .sort(([, a], [, b]) => a.shard - b.shard || a.page - b.page)
    .map(([relative]) => readGzipJson(path.join(outputDir, relative)));
}

function technicalDecision(error) {
  return /(?:statement timeout|57014|timed?\s*out|timeout)/i.test(String(error?.message || error))
    ? 'AUDIT_INCOMPLETE_QUERY_TIMEOUT' : 'AUDIT_INCOMPLETE_TECHNICAL';
}

function persistCheckpoint(checkpoint, outputDir) {
  checkpoint.updated_at = new Date().toISOString();
  writeJson(path.join(outputDir, 'checkpoint.json'), checkpoint);
}

async function scanDataset({ name, checkpoint, outputDir, shardCount, pageSize, query, sanitize, options }) {
  for (let shard = 0; shard < shardCount; shard += 1) {
    const state = checkpoint.datasets[name].shards[shard];
    const bounds = uuidShard(shard, shardCount);
    while (!state.complete) {
      const rows = await managementQuery(query(bounds, state.last_id, pageSize),
        `${name}-${shard}-page-${state.pages + 1}`, options);
      const lastId = rows.length ? String(rows.at(-1)[name === 'raw' ? 'raw_message_id'
        : name === 'phase7b' ? 'listing_id' : 'id']) : state.last_id;
      const sanitized = rows.map(sanitize).filter(Boolean);
      const page = state.pages + 1;
      const relative = `resume-pages/${name}-${String(shard).padStart(3, '0')}-${String(page).padStart(6, '0')}.json.gz`;
      writeGzipJson(path.join(outputDir, relative), sanitized);
      checkpoint.page_files[relative] = {
        dataset: name, shard, page, last_id: lastId, database_rows: rows.length,
        sanitized_rows: sanitized.length,
        sha256: sha256(fs.readFileSync(path.join(outputDir, relative)).toString('base64')),
      };
      state.last_id = lastId;
      state.pages = page;
      state.database_rows += rows.length;
      state.sanitized_rows += sanitized.length;
      state.complete = rows.length < pageSize;
      checkpoint.completed_pages += 1;
      persistCheckpoint(checkpoint, outputDir);
    }
  }
}

async function scanCurrentWithMembership({ checkpoint, outputDir, shardCount, pageSize,
  sanitizeCurrent, sanitizeMembership, options }) {
  for (let shard = 0; shard < shardCount; shard += 1) {
    const currentState = checkpoint.datasets.current.shards[shard];
    const membershipState = checkpoint.datasets.membership.shards[shard];
    if (currentState.pages !== membershipState.pages || currentState.last_id !== membershipState.last_id) {
      throw new Error(`Current/membership resume state diverged at shard ${shard}`);
    }
    const bounds = uuidShard(shard, shardCount);
    while (!currentState.complete) {
      const page = currentState.pages + 1;
      const current = await managementQuery(currentListingsSql(bounds, currentState.last_id, pageSize),
        `current-${shard}-page-${page}`, options);
      const membership = await managementQuery(tradingFloorMembershipSql(current, pageSize),
        `membership-${shard}-page-${page}`, options);
      const lastId = current.length ? String(current.at(-1).id) : currentState.last_id;
      for (const [name, rows, sanitize, state] of [
        ['current', current, sanitizeCurrent, currentState],
        ['membership', membership, sanitizeMembership, membershipState],
      ]) {
        const sanitized = rows.map(sanitize).filter(Boolean);
        const relative = `resume-pages/${name}-${String(shard).padStart(3, '0')}-${String(page).padStart(6, '0')}.json.gz`;
        writeGzipJson(path.join(outputDir, relative), sanitized);
        checkpoint.page_files[relative] = {
          dataset: name, shard, page, last_id: lastId, database_rows: rows.length,
          sanitized_rows: sanitized.length,
          sha256: sha256(fs.readFileSync(path.join(outputDir, relative)).toString('base64')),
        };
        state.last_id = lastId;
        state.pages = page;
        state.database_rows += rows.length;
        state.sanitized_rows += sanitized.length;
        state.complete = current.length < pageSize;
      }
      checkpoint.completed_pages += 2;
      persistCheckpoint(checkpoint, outputDir);
    }
  }
}

function loadCurrentState(checkpoint, outputDir) {
  const membership = new Set(pageFiles(checkpoint, outputDir, 'membership').flat().map(row => row.listing_key));
  const currentRows = pageFiles(checkpoint, outputDir, 'current').flat().map(row => ({
    ...row, current_trading_floor_eligible: membership.has(row.listing_key),
  }));
  const phaseRows = pageFiles(checkpoint, outputDir, 'phase7b').flat();
  const currentBySource = new Map();
  const phase7bBySource = new Map();
  for (const row of currentRows) {
    if (!currentBySource.has(row.source_key)) currentBySource.set(row.source_key, []);
    currentBySource.get(row.source_key).push(row);
  }
  for (const row of phaseRows) {
    if (!phase7bBySource.has(row.source_key)) phase7bBySource.set(row.source_key, []);
    phase7bBySource.get(row.source_key).push(row);
  }
  return { currentRows, phaseRows, currentBySource, phase7bBySource };
}

function currentDisposition(rows) {
  const statuses = rows.flatMap(row => [row.trading_floor_status, row.price_research_status, row.verdict])
    .map(value => String(value || '').toUpperCase());
  return {
    duplicate: statuses.some(value => value.includes('DUPLICATE')),
    withdrawn: statuses.some(value => value.includes('WITHDRAWN')),
    published: rows.some(row => row.current_trading_floor_eligible === true),
    superseded: false,
  };
}

function blankBrandQueue(row) {
  return !String(row.raw_data?.brand || '').trim() && !/(?:rolex|patek)/i.test(String(row.raw_text || ''));
}

function sanitizeRaw(row, context) {
  if (!row.id) return null;
  const classification = classifyRawPost(row, { dealerByPhone: context.dealerByPhone });
  const sourceRecordKey = sourceKey(row.source_record_id, row.id);
  const currentRows = context.currentBySource.get(sourceRecordKey) || [];
  const phaseRows = context.phase7bBySource.get(sourceRecordKey) || [];
  const disposition = currentDisposition(currentRows);
  disposition.withdrawn ||= withdrawn(row.raw_data, row.raw_text);
  const invalidBrand = !classification.brand || !BRANDS.includes(classification.brand) || blankBrandQueue(row);
  return {
    parent_key: sha256(row.raw_message_id),
    version_key: sha256(row.id),
    source_key: sourceRecordKey,
    brand: invalidBrand ? null : classification.brand,
    classification: invalidBrand ? 'RAW_BRAND_UNRESOLVED_WITH_REFERENCE' : classification.classification,
    disposition,
    current_tf: currentRows.filter(item => item.current_trading_floor_eligible).length,
    phase_publication: phaseRows.length,
    phase_verified_pr: phaseRows.filter(item => item.price_evidence_classification === 'VERIFIED_IN_NEW_COHORT').length,
    review_reasons: [...new Set(classification.review_reasons || [])].sort(),
    children: classification.children.map(child => ({
      child_key: child.child_key,
      intent: child.intent,
      reference_key: child.observed_reference_key,
      catalog_found: child.observed_reference_key
        ? context.catalogs.get(classification.brand)?.has(child.observed_reference_key) === true : false,
      explicit_price: Number(child.source_price_amount) > 0,
      explicit_currency: Boolean(child.source_currency),
      price_status: child.price_evidence_status,
      qualified_pr: priceResearchEligible(child, disposition),
      image_linked: Boolean(child.source_image),
      image_status: child.source_image_status,
      dealer_linked: Boolean(child.dealer_id),
      country_resolved: Boolean(child.country_code),
    })),
  };
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
    wts: 0, wtb: 0,
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
    raw_first_trading_floor_candidates: 0,
    phase7b_authoritative_publication_count: 0,
    phase7b_verified_price_research_count: 0,
    review_counts_by_reason: {},
    gap_dispositions: {
      already_published: 0, safely_recoverable: 0, multi_watch_child: 0,
      duplicate: 0, withdrawn: 0, non_listing: 0, price_only_review: 0,
      currency_only_review: 0, dealer_unresolved: 0, image_unavailable: 0,
      genuinely_unsplittable: 0,
    },
  };
}

function aggregateResult({ checkpoint, outputDir, snapshot, phase7bSummary, state }) {
  const records = new Map();
  for (const record of pageFiles(checkpoint, outputDir, 'raw').flat()) records.set(record.parent_key, record);
  const summaries = Object.fromEntries(BRANDS.map(brand => [brand, brandSummary()]));
  const distinctRefs = new Map(BRANDS.map(brand => [brand, new Set()]));
  const dispositionCounts = {};
  const rawTfBySource = new Map();
  const rawPrBySource = new Map();
  const sourceReasons = new Map();
  let unresolvedBrands = 0;

  for (const record of records.values()) {
    if (!record.brand) {
      unresolvedBrands += 1;
      increment(dispositionCounts, 'RAW_BRAND_UNRESOLVED_WITH_REFERENCE');
      continue;
    }
    const summary = summaries[record.brand];
    summary.raw_posts_scanned += 1;
    if (record.classification !== 'NOT_A_WATCH_LISTING') summary.legitimate_watch_posts += 1;
    if (record.classification === 'SINGLE_WATCH') summary.single_watch_posts += 1;
    if (record.classification.startsWith('MULTI_WATCH')) summary.multi_watch_posts += 1;
    if (record.classification === 'MULTI_WATCH_SAFE_TO_SPLIT') summary.safely_generated_child_observations += record.children.length;
    if (record.classification === 'MULTI_WATCH_PARTIALLY_SPLITTABLE') summary.partially_splittable_observations += record.children.length;
    if (record.classification === 'MULTI_WATCH_UNSPLITTABLE') {
      summary.genuinely_unsplittable_observations += 1;
      summary.gap_dispositions.genuinely_unsplittable += 1;
    }
    if (record.disposition.duplicate) {
      increment(dispositionCounts, 'duplicate');
      summary.gap_dispositions.duplicate += Math.max(1, record.children.length);
    } else if (record.disposition.withdrawn) {
      increment(dispositionCounts, 'withdrawn');
      summary.gap_dispositions.withdrawn += Math.max(1, record.children.length);
    } else if (record.classification === 'NOT_A_WATCH_LISTING') {
      increment(dispositionCounts, 'non_listing');
      summary.gap_dispositions.non_listing += 1;
    } else if (!record.children.length) increment(dispositionCounts, 'genuinely_ambiguous');
    else increment(dispositionCounts, 'child_candidate');

    const reasons = new Set(record.review_reasons);
    for (const reason of record.review_reasons) increment(summary.review_counts_by_reason, reason);
    let rawTf = 0;
    let rawPr = 0;
    for (const child of record.children) {
      summary.total_resulting_watch_observations += 1;
      if (record.classification.startsWith('MULTI_WATCH')) summary.gap_dispositions.multi_watch_child += 1;
      if (child.intent === 'WTS') summary.wts += 1;
      else if (child.intent === 'WTB') summary.wtb += 1;
      else increment(summary.review_counts_by_reason, 'INTENT_UNRESOLVED');
      if (child.reference_key) {
        summary.explicit_observed_references += 1;
        distinctRefs.get(record.brand).add(child.reference_key);
        if (child.catalog_found) summary.observed_references_found_in_catalog += 1;
        else {
          summary.observed_references_absent_from_catalog += 1;
          reasons.add('CATALOG_ABSENT_REFERENCE');
        }
      } else {
        increment(summary.review_counts_by_reason, 'REFERENCE_UNRESOLVED');
        reasons.add('REFERENCE_UNRESOLVED');
      }
      if (child.explicit_price) summary.explicit_prices += 1;
      else {
        increment(summary.review_counts_by_reason, child.price_status || 'PRICE_UNRESOLVED');
        reasons.add('PRICE_UNRESOLVED');
      }
      if (child.explicit_currency) summary.explicit_currencies += 1;
      else {
        increment(summary.review_counts_by_reason, 'CURRENCY_UNRESOLVED');
        reasons.add('CURRENCY_UNRESOLVED');
      }
      if (!child.explicit_price && child.explicit_currency) summary.gap_dispositions.price_only_review += 1;
      if (child.explicit_price && !child.explicit_currency) summary.gap_dispositions.currency_only_review += 1;
      const tfCandidate = !record.disposition.duplicate && !record.disposition.withdrawn;
      if (tfCandidate) rawTf += 1;
      if (child.qualified_pr) rawPr += 1;
      if (child.qualified_pr) summary.qualified_price_research_observations += 1;
      if (child.image_linked) summary.image_linked_observations += 1;
      else {
        summary.gap_dispositions.image_unavailable += 1;
        reasons.add(child.image_status || 'IMAGE_UNRESOLVED');
      }
      if (child.dealer_linked) summary.dealer_linked_observations += 1;
      else {
        summary.unresolved_dealer_observations += 1;
        summary.gap_dispositions.dealer_unresolved += 1;
        reasons.add('DEALER_IDENTITY_UNRESOLVED');
      }
      if (child.country_resolved) summary.location_country_resolved_observations += 1;
      else reasons.add('LOCATION_COUNTRY_UNRESOLVED');
    }
    summary.raw_first_trading_floor_candidates += rawTf;
    rawTfBySource.set(record.source_key, (rawTfBySource.get(record.source_key) || 0) + rawTf);
    rawPrBySource.set(record.source_key, (rawPrBySource.get(record.source_key) || 0) + rawPr);
    if (record.current_tf > 0) summary.gap_dispositions.already_published += Math.min(rawTf, record.current_tf);
    if (rawTf > record.current_tf && ['SINGLE_WATCH', 'MULTI_WATCH_SAFE_TO_SPLIT'].includes(record.classification)) {
      summary.gap_dispositions.safely_recoverable += rawTf - record.current_tf;
    }
    if (record.disposition.duplicate) reasons.add('DUPLICATE');
    if (record.disposition.withdrawn) reasons.add('WITHDRAWN');
    sourceReasons.set(record.source_key, { brand: record.brand, reasons: [...reasons].sort() });
  }

  for (const brand of BRANDS) {
    const summary = summaries[brand];
    summary.distinct_observed_references = distinctRefs.get(brand).size;
    summary.current_trading_floor_observations = state.currentRows.filter(row => (
      row.brand === brand && row.current_trading_floor_eligible
    )).length;
    summary.phase7b_observations = state.phaseRows.filter(row => row.brand === brand).length;
    const phase = phase7bSummary.find(row => row.brand === brand) || {};
    summary.phase7b_authoritative_publication_count = Number(phase.authoritative_published_listings || 0);
    summary.phase7b_verified_price_research_count = Number(phase.verified_price_research_observations || 0);
  }

  const deltaRows = [];
  const deltaTotals = Object.fromEntries(BRANDS.map(brand => [brand, {
    raw_first_tf_minus_current_tf: 0,
    raw_first_tf_minus_phase7b_publication: 0,
    raw_first_pr_minus_phase7b_verified_pr: 0,
    phase7b_source_rows_minus_authoritative_publication: 0,
    phase7b_verified_source_rows_minus_reference_census: 0,
    source_delta_rows: 0,
    explanations_by_reason: {},
  }]));
  const allSources = new Set([...rawTfBySource.keys(), ...rawPrBySource.keys(),
    ...state.currentBySource.keys(), ...state.phase7bBySource.keys()]);
  for (const sourceKey of allSources) {
    const currentRows = state.currentBySource.get(sourceKey) || [];
    const phaseRows = state.phase7bBySource.get(sourceKey) || [];
    const currentTf = currentRows.filter(row => row.current_trading_floor_eligible).length;
    const phasePublication = phaseRows.length;
    const rawTf = rawTfBySource.get(sourceKey) || 0;
    const rawPr = rawPrBySource.get(sourceKey) || 0;
    const phasePr = phaseRows.filter(row => row.price_evidence_classification === 'VERIFIED_IN_NEW_COHORT').length;
    const context = sourceReasons.get(sourceKey);
    const brand = context?.brand || currentRows[0]?.brand || phaseRows[0]?.brand || null;
    if (!BRANDS.includes(brand) || (rawTf === currentTf && rawTf === phasePublication && rawPr === phasePr)) continue;
    const reasons = new Set(context?.reasons || []);
    if (rawTf > currentTf) reasons.add('RAW_FIRST_CHILD_NOT_IN_CURRENT_TRADING_FLOOR');
    if (rawTf < currentTf) reasons.add('CURRENT_TRADING_FLOOR_ROW_WITHOUT_RAW_FIRST_CHILD_MATCH');
    if (rawTf > phasePublication) reasons.add('RAW_FIRST_CHILD_NOT_IN_PHASE7B_AUTHORITATIVE_PUBLICATION');
    if (rawTf < phasePublication) reasons.add('PHASE7B_AUTHORITATIVE_PUBLICATION_NOT_RAW_FIRST_CHILD_MATCH');
    if (rawPr > phasePr) reasons.add('RAW_FIRST_QUALIFIED_NOT_IN_PHASE7B_VERIFIED_PR');
    if (rawPr < phasePr) reasons.add('PHASE7B_VERIFIED_PR_NOT_RAW_FIRST_QUALIFIED');
    deltaTotals[brand].source_delta_rows += 1;
    for (const reason of reasons) increment(deltaTotals[brand].explanations_by_reason, reason);
    deltaRows.push({ source_record_id_sha256: sourceKey, brand,
      raw_first_trading_floor_candidates: rawTf, current_trading_floor_observations: currentTf,
      phase7b_authoritative_publication_observations: phasePublication,
      raw_first_qualified_price_research_observations: rawPr,
      phase7b_verified_price_research_observations: phasePr,
      trading_floor_delta: rawTf - currentTf, phase7b_publication_delta: rawTf - phasePublication,
      price_research_delta: rawPr - phasePr, explanation_reasons: [...reasons].sort() });
  }

  for (const brand of BRANDS) {
    const summary = summaries[brand];
    const totals = deltaTotals[brand];
    totals.raw_first_tf_minus_current_tf = summary.raw_first_trading_floor_candidates
      - summary.current_trading_floor_observations;
    totals.raw_first_tf_minus_phase7b_publication = summary.raw_first_trading_floor_candidates
      - summary.phase7b_authoritative_publication_count;
    totals.raw_first_pr_minus_phase7b_verified_pr = summary.qualified_price_research_observations
      - summary.phase7b_verified_price_research_count;
    totals.phase7b_source_rows_minus_authoritative_publication = summary.phase7b_observations
      - summary.phase7b_authoritative_publication_count;
    const verifiedRows = state.phaseRows.filter(row => (
      row.brand === brand && row.price_evidence_classification === 'VERIFIED_IN_NEW_COHORT'
    )).length;
    totals.phase7b_verified_source_rows_minus_reference_census = verifiedRows
      - summary.phase7b_verified_price_research_count;
    if (totals.phase7b_source_rows_minus_authoritative_publication) {
      increment(totals.explanations_by_reason, 'PHASE7B_SOURCE_ROWS_DO_NOT_MATCH_AUTHORITATIVE_PUBLICATION_CENSUS');
    }
    if (totals.phase7b_verified_source_rows_minus_reference_census) {
      increment(totals.explanations_by_reason, 'PHASE7B_VERIFIED_SOURCE_ROWS_DO_NOT_MATCH_REFERENCE_CENSUS');
    }
  }

  writeGzipJson(path.join(outputDir, 'sanitized-exact-deltas.json.gz'), deltaRows);
  const accounted = Object.values(dispositionCounts).reduce((sum, value) => sum + value, 0);
  const remainingQueues = {
    raw_brand_unresolved_with_reference: unresolvedBrands,
    multi_watch_unsplittable: BRANDS.reduce((sum, brand) => sum + summaries[brand].genuinely_unsplittable_observations, 0),
    multi_watch_partially_splittable: BRANDS.reduce((sum, brand) => sum + summaries[brand].partially_splittable_observations, 0),
    unresolved_dealer_observations: BRANDS.reduce((sum, brand) => sum + summaries[brand].unresolved_dealer_observations, 0),
    reconciliation_count_gaps: BRANDS.reduce((sum, brand) => sum
      + Math.abs(deltaTotals[brand].phase7b_source_rows_minus_authoritative_publication)
      + Math.abs(deltaTotals[brand].phase7b_verified_source_rows_minus_reference_census), 0),
  };
  const blocking = remainingQueues.raw_brand_unresolved_with_reference
    + remainingQueues.multi_watch_unsplittable + remainingQueues.multi_watch_partially_splittable
    + remainingQueues.reconciliation_count_gaps;
  const decision = blocking === 0 && accounted === records.size ? 'RAW_FIRST_READY' : 'NOT_READY_RAW_SOURCE_GAPS';
  return {
    contract: CONTRACT, decision, generated_at: new Date().toISOString(),
    canonical_project_ref: PROJECT_REF, read_only: true, production_writes: 0,
    raw_mutations: 0, endpoint_switches: 0, ui_changes: 0, catalog_changes: 0,
    phase7b_rerun: false, snapshot,
    raw_parent_posts: records.size, raw_posts_accounted: accounted,
    disposition_counts: dispositionCounts, brands: summaries, exact_deltas: deltaTotals,
    remaining_queues: remainingQueues,
  };
}

async function preflight(options = {}) {
  const env = options.env || process.env;
  const pageSize = Math.min(Number(env.RAW_FIRST_PREFLIGHT_PAGE_SIZE || 100), 500);
  const bounds = uuidShard(0, Number(env.RAW_FIRST_SHARDS || 16));
  const started = Date.now();
  const current = await managementQuery(currentListingsSql(bounds, null, pageSize), 'preflight-current-0', options);
  const membership = await managementQuery(tradingFloorMembershipSql(current, pageSize), 'preflight-membership-0', options);
  return {
    contract: CONTRACT, decision: 'PREFLIGHT_OK', canonical_project_ref: PROJECT_REF,
    read_only: true, page_size: pageSize, shard: 0,
    current_rows: current.length, membership_rows: membership.length,
    elapsed_ms: Date.now() - started,
  };
}

async function run(options = {}) {
  const env = options.env || process.env;
  const shardCount = Number(env.RAW_FIRST_SHARDS || 16);
  const pageSize = pageLimit(env.RAW_FIRST_PAGE_SIZE || 2000);
  const outputDir = path.resolve(env.RAW_FIRST_OUTPUT || DEFAULT_OUTPUT);
  const validateOnly = options.validateOnly ?? process.argv.includes('--validate-only');
  const bounds = uuidShard(0, shardCount);
  const membershipSample = [{ id: bounds.low, source_record_id: 'bounded-preflight-source' }];
  const sqls = [DEALERS_SQL, SNAPSHOT_SQL, PHASE7B_SUMMARY_SQL,
    rawSourceSql(bounds, null, pageSize), currentListingsSql(bounds, null, pageSize),
    tradingFloorMembershipSql(membershipSample, pageSize), phase7bSql(bounds, null, pageSize)];
  sqls.forEach(assertReadOnlySql);
  if (validateOnly) return { contract: CONTRACT, read_only: true, validated_queries: sqls.length,
    shard_count: shardCount, page_size: pageSize, database_concurrency: 1 };
  if (fs.existsSync(outputDir)) throw new Error(`Output already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  let checkpoint = initialCheckpoint(shardCount, pageSize);

  try {
    checkpoint = restoreCheckpoint(env.RAW_FIRST_RESUME_DIR, outputDir, shardCount, pageSize);
    persistCheckpoint(checkpoint, outputDir);
    const snapshot = (await managementQuery(SNAPSHOT_SQL, 'source-snapshot', options))?.[0]?.snapshot;
    if (snapshot?.project_ref !== PROJECT_REF) throw new Error('Canonical QNSA snapshot check failed');
    const dealers = [];
    let dealerCursor = null;
    let dealerPage = 0;
    do {
      const rows = await managementQuery(dealerPageSql(dealerCursor, pageSize),
        `dealer-identities-page-${dealerPage + 1}`, options);
      dealers.push(...rows);
      dealerCursor = rows.length ? rows.at(-1).id : dealerCursor;
      dealerPage += 1;
      if (rows.length < pageSize) break;
    } while (true);
    const phase7bSummary = await managementQuery(PHASE7B_SUMMARY_SQL, 'phase7b-summary', options);
    const dealerByPhone = new Map(dealers.map(row => [normalizePhone(row.phone), row]).filter(([phone]) => phone));
    const sanitizeCurrent = row => ({ listing_key: sha256(row.id), source_key: sourceKey(row.source_record_id, row.id),
      brand: row.brand, trading_floor_status: row.trading_floor_status,
      price_research_status: row.price_research_status, verdict: row.verdict });
    const sanitizeMembership = row => ({ listing_key: sha256(row.id),
      source_key: row.source_record_id ? sha256(row.source_record_id) : null });
    const sanitizePhase = row => ({ listing_key: sha256(row.listing_id), source_key: sourceKey(row.source_record_id, row.listing_id),
      brand: row.brand, price_evidence_classification: row.price_evidence_classification });

    await scanCurrentWithMembership({ checkpoint, outputDir, shardCount, pageSize,
      sanitizeCurrent, sanitizeMembership, options });
    await scanDataset({ name: 'phase7b', checkpoint, outputDir, shardCount, pageSize,
      query: phase7bSql, sanitize: sanitizePhase, options });
    const state = loadCurrentState(checkpoint, outputDir);
    const rawContext = { ...state, dealerByPhone,
      catalogs: new Map(BRANDS.map(brand => [brand, new Set(
        listCanonicalCatalogReferences(brand).map(row => referenceKey(row.reference)).filter(Boolean),
      )])) };
    await scanDataset({ name: 'raw', checkpoint, outputDir, shardCount, pageSize,
      query: rawSourceSql, sanitize: row => sanitizeRaw(row, rawContext), options });
    const result = aggregateResult({ checkpoint, outputDir, snapshot, phase7bSummary, state });
    checkpoint.status = 'COMPLETE';
    checkpoint.decision = result.decision;
    persistCheckpoint(checkpoint, outputDir);
    writeJson(path.join(outputDir, 'summary.json'), result);
    writeJson(path.join(outputDir, 'manifest-sha256.json'), {
      contract: CONTRACT, generated_at: result.generated_at,
      files: Object.fromEntries(fs.readdirSync(outputDir).filter(name => name !== 'manifest-sha256.json')
        .sort().map(name => [name, fs.statSync(path.join(outputDir, name)).isFile()
          ? sha256(fs.readFileSync(path.join(outputDir, name))) : 'DIRECTORY'])),
    });
    return result;
  } catch (error) {
    const decision = technicalDecision(error);
    checkpoint.status = 'INCOMPLETE';
    checkpoint.decision = decision;
    checkpoint.failure = { message: String(error.message || error).slice(0, 500) };
    persistCheckpoint(checkpoint, outputDir);
    const result = { contract: CONTRACT, decision, generated_at: new Date().toISOString(),
      canonical_project_ref: PROJECT_REF, read_only: true, production_writes: 0,
      raw_mutations: 0, phase7b_rerun: false, error: checkpoint.failure.message,
      completed_pages: checkpoint.completed_pages };
    writeJson(path.join(outputDir, 'summary.json'), result);
    return result;
  }
}

if (require.main === module) {
  const preflightOnly = process.argv.includes('--preflight');
  (preflightOnly ? preflight() : run()).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.decision?.startsWith('AUDIT_INCOMPLETE_')) process.exitCode = 1;
    else if (result.decision === 'NOT_READY_RAW_SOURCE_GAPS') process.exitCode = 2;
  }).catch(error => {
    const decision = technicalDecision(error);
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, decision,
      error: String(error.message || error).slice(0, 500), read_only: true, production_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT, DEALERS_SQL, PHASE7B_SUMMARY_SQL, PROJECT_REF, SNAPSHOT_SQL, dealerPageSql,
  assertReadOnlySql, currentListingsSql, managementQuery, phase7bSql, preflight,
  rawSourceSql, run, technicalDecision, tradingFloorMembershipSql, uuidShard,
};
