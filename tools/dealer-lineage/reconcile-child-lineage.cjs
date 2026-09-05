'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function compact(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return compact(value).toUpperCase().replace(/\s+/g, ' ');
}

function childIntent(value) {
  const intent = normalized(value);
  if (intent === 'WTB' || intent === 'NTQ') return 'WTB';
  if (intent === 'WTS' || intent === 'SALE') return 'WTS';
  return null;
}

function sourceParentId(row) {
  return compact(row?.field_confidence?.source_record_id);
}

function pseudonym(value) {
  return crypto.createHash('sha256').update(compact(value), 'utf8').digest('hex').slice(0, 20);
}

function exactLineageReady(lineage) {
  const evidence = lineage?.match_evidence || {};
  return lineage?.match_status === 'A_AUTO_STAGE'
    && Boolean(evidence.exact_raw_message_sha1)
    && Boolean(evidence.exact_wall_clock_second)
    && Boolean(evidence.unique_phone_identity)
    && Boolean(evidence.intent_agreement)
    && Boolean(compact(lineage.seller_phone_normalized))
    && Boolean(compact(lineage.source_posted_at));
}

function buildChildLineageRow(child, lineage) {
  if (!exactLineageReady(lineage)) {
    throw new Error(`Unsafe seller lineage for ${sourceParentId(child) || child?.id || 'unknown child'}`);
  }
  const parentId = sourceParentId(child);
  if (!parentId || parentId !== compact(lineage.source_record_id)) {
    throw new Error(`Parent lineage mismatch for ${child?.id || 'unknown child'}`);
  }

  const observedName = compact(lineage.observed_names?.[0]) || null;
  const phone = compact(lineage.seller_phone_normalized);
  const intent = childIntent(child.listing_type);
  const sourceParentIntent = childIntent(lineage.source_intent || lineage.normalized_intent);
  const reviewReasons = [];
  if (!observedName) reviewReasons.push('SELLER_NAME_MISSING');
  if (!intent) reviewReasons.push('CHILD_INTENT_UNRESOLVED');
  if (intent && sourceParentIntent && intent !== sourceParentIntent) reviewReasons.push('CHILD_PARENT_INTENT_MISMATCH');

  return {
    child_id: compact(child.id),
    source_child_id: compact(child?.field_confidence?.source_child_id) || null,
    source_record_id: parentId,
    source_system: compact(lineage.source_system),
    seller_listing_id: compact(lineage.seller_listing_id),
    source_posted_at: compact(lineage.source_posted_at),
    source_posted_at_raw: compact(lineage.source_posted_at_raw) || null,
    child_created_at_preserved: compact(child.created_at) || null,
    child_intent: intent,
    source_parent_intent: sourceParentIntent,
    activity_count_eligible: Boolean(intent && sourceParentIntent && intent === sourceParentIntent),
    observed_seller: {
      identity_type: 'PHONE',
      identity_value: phone,
      identity_pseudonym: pseudonym(phone),
      observed_name: observedName,
      verification_status: 'OBSERVED_SOURCE_IDENTITY',
    },
    dealer_id: null,
    dealer_verification_status: 'REQUIRES_VERIFIED_DEALER_MATCH',
    public_contact_eligible: false,
    parent_front_image: compact(lineage.front_image) || null,
    image_lineage_status: compact(lineage.front_image) ? 'PARENT_EVIDENCE_ONLY' : 'NO_PARENT_IMAGE',
    child_image_publication_eligible: false,
    approval_status: 'UNCHANGED',
    publication_status: 'UNCHANGED',
    duplicate_suppression_status: 'NOT_EVALUATED_FOR_SUPPRESSION',
    review_reasons: reviewReasons,
    evidence: {
      exact_raw_message_sha1: true,
      exact_wall_clock_second: true,
      unique_phone_identity: true,
      parent_intent_agreement: true,
      child_lineage_inherited_from_exact_parent: true,
    },
    listing_fingerprint: listingFingerprint(child),
  };
}

function listingFingerprint(row) {
  return [
    childIntent(row.listing_type), row.brand, row.reference, row.dial_color,
    row.condition, row.price_usd, row.currency,
  ].map(normalized).join('|');
}

function sellerRepostKey(child, lineageRow) {
  return `${lineageRow.observed_seller.identity_pseudonym}|${listingFingerprint(child)}`;
}

function configurationFingerprint(row) {
  return [childIntent(row.listing_type), row.brand, row.reference, row.dial_color]
    .map(normalized).join('|');
}

function sellerConfigurationKey(child, lineageRow) {
  return `${lineageRow.observed_seller.identity_pseudonym}|${configurationFingerprint(child)}`;
}

function summarizeRepostClusters(groups, policy = 'HUMAN_REPOST_REVIEW_REQUIRED') {
  return [...groups.values()]
    .filter(group => group.parentIds.size > 1)
    .map(group => ({
      seller_identity_pseudonym: group.sellerIdentityPseudonym,
      listing_fingerprint: group.listingFingerprint,
      count: group.count,
      parent_count: group.parentIds.size,
      parent_ids: [...group.parentIds].slice(0, 50),
      child_ids: group.childIds.slice(0, 50),
      source_dates: [...group.sourceDates].sort().slice(0, 50),
      policy,
    }))
    .sort((a, b) => b.count - a.count || a.listing_fingerprint.localeCompare(b.listing_fingerprint));
}

async function loadLineageMap(manifestPath) {
  const rows = new Map();
  let unsafeRows = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(manifestPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!exactLineageReady(row)) {
      unsafeRows += 1;
      continue;
    }
    const parentId = compact(row.source_record_id);
    if (rows.has(parentId)) throw new Error(`Duplicate match-ready lineage for parent ${parentId}`);
    rows.set(parentId, row);
  }
  return { rows, unsafeRows };
}

function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clusterReviewCsv(clusters) {
  const headings = [
    'seller_identity_pseudonym', 'listing_fingerprint', 'row_count', 'parent_count',
    'first_source_date', 'last_source_date', 'source_dates', 'parent_ids', 'child_ids',
    'review_decision', 'review_notes', 'policy',
  ];
  const lines = [headings.join(',')];
  for (const cluster of clusters) {
    const dates = [...cluster.source_dates].sort();
    lines.push([
      cluster.seller_identity_pseudonym,
      cluster.listing_fingerprint,
      cluster.count,
      cluster.parent_count,
      dates[0] || '',
      dates.at(-1) || '',
      dates,
      cluster.parent_ids,
      cluster.child_ids,
      '',
      '',
      cluster.policy,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function reconcile({ stagingPath, lineagePath, outputDir, maxChildren = Infinity }) {
  const { rows: lineageByParent, unsafeRows } = await loadLineageMap(lineagePath);
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, 'private-child-lineage.jsonl');
  const partialManifestPath = `${manifestPath}.partial`;
  const output = fs.createWriteStream(partialManifestPath, { encoding: 'utf8' });
  const matchedParents = new Set();
  const unmatchedParents = new Set();
  const repostGroups = new Map();
  const configurationGroups = new Map();
  const reviewBuckets = new Map();
  const sourceYears = new Map();
  let earliestSourcePost = null;
  let latestSourcePost = null;
  const counts = {
    childrenRead: 0,
    childrenMatched: 0,
    wtsChildrenMatched: 0,
    wtbChildrenMatched: 0,
    unresolvedIntentChildren: 0,
    childParentIntentMismatch: 0,
    matchedChildrenMissingName: 0,
    parentImageEvidenceRows: 0,
  };

  try {
    for await (const line of readline.createInterface({ input: fs.createReadStream(stagingPath), crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      if (counts.childrenRead >= maxChildren) break;
      const child = JSON.parse(line);
      counts.childrenRead += 1;
      const parentId = sourceParentId(child);
      const lineage = lineageByParent.get(parentId);
      if (!lineage) {
        if (parentId) unmatchedParents.add(parentId);
        continue;
      }

      const privateRow = buildChildLineageRow(child, lineage);
      output.write(`${JSON.stringify(privateRow)}\n`);
      counts.childrenMatched += 1;
      matchedParents.add(parentId);
      if (privateRow.child_intent === 'WTS') counts.wtsChildrenMatched += 1;
      else if (privateRow.child_intent === 'WTB') counts.wtbChildrenMatched += 1;
      else counts.unresolvedIntentChildren += 1;
      if (privateRow.review_reasons.includes('CHILD_PARENT_INTENT_MISMATCH')) counts.childParentIntentMismatch += 1;
      if (!privateRow.observed_seller.observed_name) counts.matchedChildrenMissingName += 1;
      if (privateRow.parent_front_image) counts.parentImageEvidenceRows += 1;
      const reviewBucket = compact(child?.field_confidence?.review_bucket) || 'UNSPECIFIED';
      reviewBuckets.set(reviewBucket, (reviewBuckets.get(reviewBucket) || 0) + 1);
      const sourceYear = privateRow.source_posted_at.slice(0, 4);
      sourceYears.set(sourceYear, (sourceYears.get(sourceYear) || 0) + 1);
      if (!earliestSourcePost || privateRow.source_posted_at < earliestSourcePost) earliestSourcePost = privateRow.source_posted_at;
      if (!latestSourcePost || privateRow.source_posted_at > latestSourcePost) latestSourcePost = privateRow.source_posted_at;

      const repostKey = sellerRepostKey(child, privateRow);
      const group = repostGroups.get(repostKey) || {
        sellerIdentityPseudonym: privateRow.observed_seller.identity_pseudonym,
        listingFingerprint: privateRow.listing_fingerprint,
        count: 0,
        parentIds: new Set(),
        childIds: [],
        sourceDates: new Set(),
      };
      group.count += 1;
      group.parentIds.add(parentId);
      if (group.childIds.length < 50) group.childIds.push(privateRow.child_id);
      group.sourceDates.add(privateRow.source_posted_at);
      repostGroups.set(repostKey, group);

      const configurationKey = sellerConfigurationKey(child, privateRow);
      const configurationGroup = configurationGroups.get(configurationKey) || {
        sellerIdentityPseudonym: privateRow.observed_seller.identity_pseudonym,
        listingFingerprint: configurationFingerprint(child),
        count: 0,
        parentIds: new Set(),
        childIds: [],
        sourceDates: new Set(),
      };
      configurationGroup.count += 1;
      configurationGroup.parentIds.add(parentId);
      if (configurationGroup.childIds.length < 50) configurationGroup.childIds.push(privateRow.child_id);
      configurationGroup.sourceDates.add(privateRow.source_posted_at);
      configurationGroups.set(configurationKey, configurationGroup);
    }
  } finally {
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
  }
  fs.renameSync(partialManifestPath, manifestPath);

  const repostClusters = summarizeRepostClusters(repostGroups);
  const configurationClusters = summarizeRepostClusters(configurationGroups, 'HUMAN_CONFIGURATION_HISTORY_REVIEW_REQUIRED');
  const report = {
    generatedAt: new Date().toISOString(),
    stagingPath: path.resolve(stagingPath),
    lineagePath: path.resolve(lineagePath),
    privateManifestPath: path.resolve(manifestPath),
    lineageParentsLoaded: lineageByParent.size,
    lineageParentsWithoutStagedChildren: lineageByParent.size - matchedParents.size,
    unsafeLineageRowsSkipped: unsafeRows,
    matchedParents: matchedParents.size,
    unmatchedParentsSeen: unmatchedParents.size,
    ...counts,
    matchedChildCoveragePercent: counts.childrenRead ? Number(((counts.childrenMatched / counts.childrenRead) * 100).toFixed(2)) : 0,
    reviewBuckets: Object.fromEntries([...reviewBuckets.entries()].sort()),
    sourceYears: Object.fromEntries([...sourceYears.entries()].sort()),
    earliestSourcePost,
    latestSourcePost,
    sellerAwareRepostCandidateClusters: repostClusters.length,
    sellerAwareRepostCandidateRows: repostClusters.reduce((sum, cluster) => sum + cluster.count, 0),
    sellerConfigurationHistoryClusters: configurationClusters.length,
    sellerConfigurationHistoryRows: configurationClusters.reduce((sum, cluster) => sum + cluster.count, 0),
    policies: {
      dealerAssignment: 'NO_VERIFIED_DEALER_ASSIGNMENT',
      publicContact: 'NO_PUBLIC_CONTACT_CHANGE',
      images: 'PARENT_IMAGE_REMAINS_EVIDENCE_ONLY',
      duplicateSuppression: 'NO_AUTOMATIC_SUPPRESSION',
      publication: 'NO_PUBLICATION_OR_APPROVAL_CHANGE',
    },
    productionWrites: 0,
    publicRowsMutated: 0,
  };
  atomicWrite(path.join(outputDir, 'seller-aware-repost-candidates.json'), `${JSON.stringify(repostClusters, null, 2)}\n`);
  atomicWrite(path.join(outputDir, 'seller-aware-repost-review.csv'), clusterReviewCsv(repostClusters));
  atomicWrite(path.join(outputDir, 'seller-configuration-history-candidates.json'), `${JSON.stringify(configurationClusters, null, 2)}\n`);
  atomicWrite(path.join(outputDir, 'seller-configuration-history-review.csv'), clusterReviewCsv(configurationClusters));
  atomicWrite(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const stagingPath = path.resolve(process.env.UNBUNDLED_STAGING_MANIFEST || process.argv[2] || 'audit-output/unbundled/batch-002-staging-v9/watch-staging.jsonl');
  const lineagePath = path.resolve(process.env.SELLER_LINEAGE_MANIFEST || process.argv[3] || 'audit-output/dealer-lineage/batch-002/match-ready.jsonl');
  const outputDir = path.resolve(process.env.CHILD_LINEAGE_OUTPUT_DIR || process.argv[4] || 'audit-output/dealer-lineage/batch-002-child-reconciliation');
  const maxChildrenValue = Number(process.env.CHILD_LINEAGE_MAX_CHILDREN || Infinity);
  const maxChildren = Number.isFinite(maxChildrenValue) ? Math.max(1, maxChildrenValue) : Infinity;
  for (const input of [stagingPath, lineagePath]) {
    if (!fs.existsSync(input)) throw new Error(`Input not found: ${input}`);
  }
  const result = await reconcile({ stagingPath, lineagePath, outputDir, maxChildren });
  process.stdout.write(`${JSON.stringify({ event: 'child_lineage_reconciliation_complete', ...result }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'child_lineage_reconciliation_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = {
  buildChildLineageRow,
  childIntent,
  clusterReviewCsv,
  exactLineageReady,
  listingFingerprint,
  reconcile,
  sellerRepostKey,
  sellerConfigurationKey,
  sourceParentId,
  summarizeRepostClusters,
};
