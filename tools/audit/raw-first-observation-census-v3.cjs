'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { classifyRawPost } = require('./raw-first-rolex-patek-lib.cjs');
const { managementQuery, uuidShard } = require('./raw-first-rolex-patek-audit.cjs');
const { enrichParent, occurrenceSummary, sha256 } = require('./raw-first-observation-v3-lib.cjs');

const CONTRACT = 'watchfacts-raw-first-observation-census-v3';
const SOURCE_CONTRACT = 'watchfacts-raw-first-rolex-patek-audit-v2';
const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const BRANDS = ['Rolex', 'Patek Philippe'];
const TARGET_CLASSES = new Set(['MULTI_WATCH_PARTIALLY_SPLITTABLE', 'MULTI_WATCH_UNSPLITTABLE']);

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
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

function readGzip(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
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

function targetedRawSql(bounds, afterId, throughId, parentHashes) {
  if (!parentHashes.length) throw new Error('Target hash list is empty');
  const lower = afterId || bounds.low;
  const lowerOperator = afterId ? '>' : '>=';
  const hashes = parentHashes.map(sqlLiteral).join(',');
  return `WITH parent_page AS MATERIALIZED (
    SELECT rm.id,rm.source_platform,rm.sender_phone,rm.group_id,rm.external_message_id,rm.media_count
    FROM public.raw_messages rm
    WHERE rm.id${lowerOperator}${sqlLiteral(lower)}::uuid
      AND rm.id<=${sqlLiteral(throughId)}::uuid
      AND encode(extensions.digest(convert_to(rm.id::text,'UTF8'),'sha256'),'hex') IN (${hashes})
    ORDER BY rm.id
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
      OR (NULLIF(btrim(COALESCE(v.raw_payload#>>'{raw_data,brand}','')),'') IS NULL
        AND NULLIF(btrim(COALESCE(v.raw_payload#>>'{raw_data,reference}','')),'') IS NOT NULL)
    )
    ORDER BY v.observed_at DESC NULLS LAST,v.id DESC LIMIT 1
  ) rv ON true
  ORDER BY p.id;`;
}

function emptyBrand() {
  return {
    authoritative_raw_parents: 0,
    single_watch_parents: 0,
    multi_watch_parents: 0,
    raw_candidate_occurrences: 0,
    carried_unique_observations: 0,
    carried_qualified_pr: 0,
    carried_dealer_linked: 0,
    carried_image_linked: 0,
    carried_location_resolved: 0,
    carried_any_field_review: 0,
    carried_trading_floor_eligible: 0,
    carried_field_review: {},
    cardinalities: [],
  };
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function fieldReviewForChild(child) {
  return [
    !child.explicit_price && 'PRICE_REVIEW_ONLY',
    !child.explicit_currency && 'CURRENCY_REVIEW_ONLY',
    !child.image_linked && 'IMAGE_MAPPING_REVIEW',
    !child.dealer_linked && 'DEALER_IDENTITY_REVIEW',
    !child.country_resolved && 'LOCATION_REVIEW',
  ].filter(Boolean);
}

function inspectArtifact(artifactRoot) {
  const checkpoint = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'checkpoint.json'), 'utf8'));
  if (checkpoint.contract !== SOURCE_CONTRACT || checkpoint.status !== 'COMPLETE') {
    throw new Error('Completed V2 artifact checkpoint is required');
  }
  const entries = rawEntries(checkpoint);
  const pages = [];
  const brands = Object.fromEntries(BRANDS.map(brand => [brand, emptyBrand()]));
  let targetParents = 0;
  for (const [relative, meta] of entries) {
    const compressed = fs.readFileSync(path.join(artifactRoot, relative));
    if (sha256(compressed.toString('base64')) !== meta.sha256) throw new Error(`V2 checksum mismatch: ${relative}`);
    const records = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
    let targetCount = 0;
    for (const record of records) {
      if (!BRANDS.includes(record.brand)) continue;
      const brand = brands[record.brand];
      brand.authoritative_raw_parents += 1;
      brand.raw_candidate_occurrences += record.children.length;
      if (record.classification === 'SINGLE_WATCH') brand.single_watch_parents += 1;
      if (record.classification.startsWith('MULTI_WATCH')) brand.multi_watch_parents += 1;
      if (TARGET_CLASSES.has(record.classification)) {
        targetCount += 1;
        targetParents += 1;
        continue;
      }
      const accepted = record.classification !== 'NOT_A_WATCH_LISTING' ? record.children : [];
      brand.carried_unique_observations += accepted.length;
      if (!record.disposition.duplicate && !record.disposition.withdrawn) {
        brand.carried_trading_floor_eligible += accepted.length;
      }
      brand.cardinalities.push(accepted.length);
      for (const child of accepted) {
        if (child.qualified_pr) brand.carried_qualified_pr += 1;
        if (child.dealer_linked) brand.carried_dealer_linked += 1;
        if (child.image_linked) brand.carried_image_linked += 1;
        if (child.country_resolved) brand.carried_location_resolved += 1;
        const reviews = fieldReviewForChild(child);
        if (reviews.length) brand.carried_any_field_review += 1;
        for (const reason of reviews) increment(brand.carried_field_review, reason);
      }
    }
    if (targetCount) pages.push({ relative, meta, target_count: targetCount });
  }
  return { checkpoint, entries, pages, brands, target_parents: targetParents };
}

function loadTargetPage(artifactRoot, page) {
  const compressed = fs.readFileSync(path.join(artifactRoot, page.relative));
  if (sha256(compressed.toString('base64')) !== page.meta.sha256) {
    throw new Error(`V2 checksum mismatch during target reload: ${page.relative}`);
  }
  const records = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  const targets = records.filter(record => BRANDS.includes(record.brand)
    && TARGET_CLASSES.has(record.classification));
  if (targets.length !== page.target_count) {
    throw new Error(`V2 target count drift ${page.relative}: expected ${page.target_count}, found ${targets.length}`);
  }
  return targets;
}

function initialCheckpoint(targetParents) {
  return {
    contract: CONTRACT, source_contract: SOURCE_CONTRACT, canonical_project_ref: PROJECT_REF,
    status: 'RUNNING', decision: 'NOT_READY_OBSERVATION_IDENTITY_GAPS', read_only: true,
    production_writes: 0, database_concurrency: 1, target_parents: targetParents,
    processed_target_parents: 0, processed_pages: {}, page_files: {},
  };
}

function restoreCheckpoint(resumeRoot, outputRoot, targetParents) {
  const file = resumeRoot && path.join(path.resolve(resumeRoot), 'checkpoint.json');
  if (!file || !fs.existsSync(file)) return initialCheckpoint(targetParents);
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (checkpoint.contract !== CONTRACT || checkpoint.target_parents !== targetParents) {
    throw new Error('V3 resume checkpoint contract/target mismatch');
  }
  for (const [relative, meta] of Object.entries(checkpoint.page_files || {})) {
    const source = path.join(path.resolve(resumeRoot), relative);
    const target = path.join(outputRoot, relative);
    const bytes = fs.readFileSync(source);
    if (sha256(bytes.toString('base64')) !== meta.sha256) throw new Error(`V3 resume checksum mismatch: ${relative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  checkpoint.status = 'RUNNING';
  return checkpoint;
}

function distributionBucket(count) {
  if (count <= 4) return String(count);
  if (count <= 10) return '5-10';
  if (count <= 20) return '11-20';
  if (count <= 50) return '21-50';
  return '>50';
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function aggregate(artifact, outputRoot, sourceSummary) {
  const results = Object.fromEntries(BRANDS.map(brand => [brand, {
    ...artifact.brands[brand], classifications: {}, repeated_identical_offer_occurrences: 0,
    explicit_quantity_observations: 0, target_unique_observations: 0, target_qualified_pr: 0,
    target_dealer_linked: 0, target_image_linked: 0, target_location_resolved: 0,
    distinct_same_reference_observations: 0, repost_candidates: 0,
    repost_qualified_candidates: 0, target_any_field_review: 0,
    target_manifest_count: 0, raw_occurrence_count: 0, raw_occurrence_manifest_count: 0,
    target_field_review: {}, whole_observation_review: 0, matched_target_parents: 0,
  }]));
  const bodyGroups = new Map();
  const parentRows = [];
  for (const meta of Object.values(artifact.checkpointV3.page_files || {})) {
    const file = path.join(outputRoot, meta.relative);
    const compressed = fs.readFileSync(file);
    if (sha256(compressed.toString('base64')) !== meta.sha256) {
      throw new Error(`V3 page checksum mismatch: ${meta.relative}`);
    }
    const rows = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
    for (const parent of rows) {
      parentRows.push({ parent_key: parent.parent_key, brand: parent.brand,
        raw_text_sha256: parent.raw_text_sha256, source_identity_key: parent.source_identity_key,
        disposition: parent.disposition, summary: parent.summary });
      const result = results[parent.brand];
      result.matched_target_parents += 1;
      result.target_unique_observations += parent.summary.unique_market_observations;
      result.target_manifest_count += parent.summary.unique_manifest_count;
      result.raw_occurrence_count += parent.occurrences.length;
      result.raw_occurrence_manifest_count += parent.summary.raw_occurrence_manifest_count;
      result.repeated_identical_offer_occurrences += parent.summary.repeated_identical_offer_occurrences;
      result.explicit_quantity_observations += parent.summary.explicit_quantity_observations;
      result.target_qualified_pr += parent.summary.qualified_price_research_observations;
      result.target_dealer_linked += parent.summary.dealer_linked;
      result.target_image_linked += parent.summary.image_linked;
      result.target_location_resolved += parent.summary.location_resolved;
      result.whole_observation_review += parent.summary.whole_observation_review;
      result.cardinalities.push(parent.summary.unique_market_observations);
      for (const [key, value] of Object.entries(parent.summary.classifications)) increment(result.classifications, key, value);
      const unique = parent.occurrences.filter(row => row.classification === 'UNIQUE_MARKET_OBSERVATION');
      const refs = new Map();
      for (const row of unique) {
        if (row.observed_reference_key) refs.set(row.observed_reference_key, (refs.get(row.observed_reference_key) || 0) + 1);
        if (row.field_review_reasons.length) result.target_any_field_review += 1;
        for (const reason of row.field_review_reasons) increment(result.target_field_review, reason);
      }
      result.distinct_same_reference_observations += [...refs.values()].filter(count => count > 1)
        .reduce((sum, count) => sum + count, 0);
      const groupKey = parent.source_identity_key
        ? `${parent.raw_text_sha256}|${parent.source_identity_key}` : `unlinked:${parent.parent_key}`;
      const group = bodyGroups.get(groupKey) || [];
      group.push(parent);
      bodyGroups.set(groupKey, group);
    }
  }
  const repostParentKeys = new Set();
  for (const group of bodyGroups.values()) {
    if (group.length < 2) continue;
    for (const parent of group) repostParentKeys.add(parent.parent_key);
  }
  for (const parent of parentRows) {
    if (repostParentKeys.has(parent.parent_key)) {
      results[parent.brand].repost_candidates += parent.summary.unique_market_observations;
      results[parent.brand].repost_qualified_candidates += parent.summary.qualified_price_research_observations;
    }
  }

  const finalBrands = {};
  let totalIdentityGaps = 0;
  for (const brand of BRANDS) {
    const result = results[brand];
    const source = sourceSummary.brands[brand];
    const unique = result.carried_unique_observations + result.target_unique_observations;
    const manifest = result.carried_unique_observations + result.target_manifest_count;
    const dealerLinked = result.carried_dealer_linked + result.target_dealer_linked;
    const imageLinked = result.carried_image_linked + result.target_image_linked;
    const locationResolved = result.carried_location_resolved + result.target_location_resolved;
    const currentTf = Number(source.current_trading_floor_observations || 0);
    const currentPr = Number(source.phase7b_verified_price_research_count || 0);
    const correctedPr = result.carried_qualified_pr
      + Math.max(0, result.target_qualified_pr - result.repost_qualified_candidates);
    const unsplittable = result.classifications.UNSPLITTABLE_PARENT || 0;
    const ambiguous = (result.classifications.AMBIGUOUS_CHILD_BOUNDARY || 0)
      + (result.classifications.REVIEW_REQUIRED || 0);
    totalIdentityGaps += unsplittable + ambiguous;
    const distribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, '5-10': 0, '11-20': 0, '21-50': 0, '>50': 0 };
    const sorted = result.cardinalities.sort((a, b) => a - b);
    for (const count of sorted) increment(distribution, distributionBucket(count));
    const fieldReview = { ...result.carried_field_review };
    for (const [key, value] of Object.entries(result.target_field_review)) increment(fieldReview, key, value);
    const targetTradingEligible = parentRows.filter(parent => parent.brand === brand
      && !parent.disposition.duplicate && !parent.disposition.withdrawn
      && !repostParentKeys.has(parent.parent_key))
      .reduce((sum, parent) => sum + parent.summary.unique_market_observations, 0);
    const correctedTradingEligible = result.carried_trading_floor_eligible + targetTradingEligible;
    const alreadyPublished = Math.min(currentTf, correctedTradingEligible);
    const safeToPublish = Math.max(0, correctedTradingEligible - currentTf);
    finalBrands[brand] = {
      authoritative_raw_parents: result.authoritative_raw_parents,
      single_watch_parents: result.single_watch_parents,
      multi_watch_parents: result.multi_watch_parents,
      raw_candidate_occurrences: result.raw_candidate_occurrences,
      unique_market_observations: unique,
      unique_observation_manifest_count: manifest,
      repeated_identical_offer_occurrences: result.repeated_identical_offer_occurrences,
      distinct_same_reference_observations: result.distinct_same_reference_observations,
      explicit_quantity_observations: result.explicit_quantity_observations,
      repost_candidates: result.repost_candidates,
      genuinely_unsplittable_parents: unsplittable,
      observations_per_parent: distribution,
      median_observations_per_parent: percentile(sorted, 0.5),
      p95_observations_per_parent: percentile(sorted, 0.95),
      p99_observations_per_parent: percentile(sorted, 0.99),
      max_observations_per_parent: sorted.at(-1) || 0,
      current_trading_floor: currentTf,
      corrected_trading_floor_eligible: correctedTradingEligible,
      corrected_trading_floor_delta: correctedTradingEligible - currentTf,
      safely_recoverable_trading_floor: safeToPublish,
      trading_floor_reconciliation: {
        ALREADY_PUBLISHED: alreadyPublished,
        SAFE_TO_PUBLISH: safeToPublish,
        REPEATED_IDENTICAL_OFFER: result.repeated_identical_offer_occurrences,
        DUPLICATE: result.classifications.DUPLICATE || 0,
        REPOST: result.repost_candidates,
        WITHDRAWN: result.classifications.WITHDRAWN || 0,
        FIELD_REVIEW_ONLY: result.carried_any_field_review + result.target_any_field_review,
        UNSPLITTABLE: unsplittable,
        OTHER_EXPLAINED: ambiguous,
      },
      current_verified_price_research: currentPr,
      corrected_raw_first_qualified_price_research: correctedPr,
      corrected_price_research_delta: correctedPr - currentPr,
      dealer_linked: dealerLinked,
      dealer_unresolved: unique - dealerLinked,
      image_linked: imageLinked,
      image_unavailable: unique - imageLinked,
      location_resolved: locationResolved,
      location_unresolved: unique - locationResolved,
      field_level_review: fieldReview,
      observations_needing_any_field_review: result.carried_any_field_review + result.target_any_field_review,
      whole_observation_review: result.whole_observation_review,
      raw_occurrence_count: result.raw_occurrence_count,
      raw_occurrence_manifest_count: result.raw_occurrence_manifest_count,
      raw_occurrence_manifest_reconciles: result.raw_occurrence_count === result.raw_occurrence_manifest_count,
      classifications: result.classifications,
      target_parents_matched: result.matched_target_parents,
    };
  }
  const allMatched = artifact.checkpointV3.processed_target_parents === artifact.target_parents;
  const manifestMatches = BRANDS.every(brand => finalBrands[brand].unique_market_observations
    === finalBrands[brand].unique_observation_manifest_count
    && finalBrands[brand].raw_occurrence_manifest_reconciles);
  return {
    contract: CONTRACT,
    decision: allMatched && manifestMatches && totalIdentityGaps === 0
      ? 'RAW_FIRST_OBSERVATION_CENSUS_READY' : 'NOT_READY_OBSERVATION_IDENTITY_GAPS',
    generated_at: new Date().toISOString(), canonical_project_ref: PROJECT_REF,
    read_only: true, production_writes: 0, raw_mutations: 0, endpoint_switches: 0,
    ui_changes: 0, catalog_changes: 0, phase7b_rerun: false,
    target_problem_parents: artifact.target_parents,
    processed_target_parents: artifact.checkpointV3.processed_target_parents,
    evidence_integrity: {
      source_artifact_contract: SOURCE_CONTRACT,
      source_page_files_verified: artifact.entries.length,
      v3_page_files: Object.keys(artifact.checkpointV3.page_files).length,
      v3_page_checksum_failures: 0,
      unique_observation_manifest_reconciles: manifestMatches,
    },
    brands: finalBrands,
    remaining_queues: {
      unmatched_problem_parents: artifact.target_parents - artifact.checkpointV3.processed_target_parents,
      unsplittable_parents: BRANDS.reduce((sum, brand) => sum + finalBrands[brand].genuinely_unsplittable_parents, 0),
      ambiguous_child_boundaries: BRANDS.reduce((sum, brand) => sum
        + (finalBrands[brand].classifications.AMBIGUOUS_CHILD_BOUNDARY || 0), 0),
      review_required_occurrences: BRANDS.reduce((sum, brand) => sum
        + (finalBrands[brand].classifications.REVIEW_REQUIRED || 0), 0),
    },
  };
}

async function run(options = {}) {
  const env = options.env || process.env;
  const artifactRoot = path.resolve(env.RAW_FIRST_V2_ARTIFACT || 'audit-resume-input');
  const outputRoot = path.resolve(env.RAW_FIRST_V3_OUTPUT || 'audit-output/raw-first-observation-v3');
  const validateOnly = options.validateOnly ?? process.argv.includes('--validate-only');
  const sampleSql = targetedRawSql(uuidShard(0, 16), null,
    '0fffffff-ffff-ffff-ffff-ffffffffffff', ['a'.repeat(64)]);
  if (validateOnly) {
    return { contract: CONTRACT, read_only: true, validated_target_query: 1,
      database_concurrency: 1, target_classes: [...TARGET_CLASSES] };
  }
  if (fs.existsSync(outputRoot) && !env.RAW_FIRST_V3_RESUME_DIR) throw new Error(`Output already exists: ${outputRoot}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  const artifact = inspectArtifact(artifactRoot);
  let checkpoint = restoreCheckpoint(env.RAW_FIRST_V3_RESUME_DIR, outputRoot, artifact.target_parents);
  writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
  try {
    for (const page of artifact.pages) {
      if (checkpoint.processed_pages[page.relative]) continue;
      const pageTargets = loadTargetPage(artifactRoot, page);
      const bounds = uuidShard(page.meta.shard, artifact.checkpoint.shard_count);
      const rows = await managementQuery(targetedRawSql(bounds,
        priorCursor(artifact.entries, page.meta), page.meta.last_id,
        pageTargets.map(record => record.parent_key)), `v3-target-${page.meta.shard}-${page.meta.page}`, options);
      const targets = new Map(pageTargets.map(record => [record.parent_key, record]));
      const enriched = [];
      for (const row of rows) {
        const parentKey = sha256(row.raw_message_id);
        const artifactRecord = targets.get(parentKey);
        if (!artifactRecord) continue;
        const classified = classifyRawPost(row);
        if (sha256(row.id) !== artifactRecord.version_key) throw new Error(`Latest version drift: ${parentKey}`);
        const occurrences = enrichParent(classified, artifactRecord);
        const summary = occurrenceSummary(occurrences);
        enriched.push({
          parent_key: parentKey, version_key: artifactRecord.version_key,
          source_key: artifactRecord.source_key, brand: artifactRecord.brand,
          original_classification: artifactRecord.classification,
          raw_text_sha256: classified.parent.raw_text_sha256,
          source_identity_key: classified.parent.source_account ? sha256(classified.parent.source_account) : null,
          source_timestamp: classified.parent.source_created_on || classified.parent.observed_at,
          current_tf: artifactRecord.current_tf,
          disposition: artifactRecord.disposition,
          summary, occurrences,
        });
      }
      if (enriched.length !== pageTargets.length) {
        throw new Error(`Target page mismatch ${page.relative}: expected ${pageTargets.length}, matched ${enriched.length}`);
      }
      const relative = `v3-pages/${path.basename(page.relative)}`;
      const file = path.join(outputRoot, relative);
      writeGzip(file, enriched);
      checkpoint.page_files[relative] = { relative, source_page: page.relative,
        target_parents: enriched.length, sha256: sha256(fs.readFileSync(file).toString('base64')) };
      checkpoint.processed_pages[page.relative] = true;
      checkpoint.processed_target_parents += enriched.length;
      checkpoint.updated_at = new Date().toISOString();
      writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
    }
    checkpoint.status = 'COMPLETE';
    artifact.checkpointV3 = checkpoint;
    const sourceSummary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'summary.json'), 'utf8'));
    const result = aggregate(artifact, outputRoot, sourceSummary);
    checkpoint.decision = result.decision;
    writeJson(path.join(outputRoot, 'summary.json'), result);
    writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
    return result;
  } catch (error) {
    checkpoint.status = 'INCOMPLETE';
    checkpoint.failure = { message: String(error.message || error).slice(0, 500) };
    checkpoint.updated_at = new Date().toISOString();
    writeJson(path.join(outputRoot, 'checkpoint.json'), checkpoint);
    writeJson(path.join(outputRoot, 'summary.json'), {
      contract: CONTRACT, decision: 'NOT_READY_OBSERVATION_IDENTITY_GAPS', read_only: true,
      production_writes: 0, error: checkpoint.failure.message,
      target_problem_parents: artifact.target_parents,
      processed_target_parents: checkpoint.processed_target_parents,
    });
    return JSON.parse(fs.readFileSync(path.join(outputRoot, 'summary.json'), 'utf8'));
  }
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.error) process.exitCode = 1;
    else if (!process.argv.includes('--validate-only')
      && result.decision !== 'RAW_FIRST_OBSERVATION_CENSUS_READY') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, read_only: true, production_writes: 0,
      error: String(error.message || error).slice(0, 500) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT,
  SOURCE_CONTRACT,
  TARGET_CLASSES,
  aggregate,
  distributionBucket,
  inspectArtifact,
  priorCursor,
  run,
  targetedRawSql,
};
