'use strict';

const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { classifyPair, hash, signaturesFor, sourceIdentity } = require('./duplicate-signatures.cjs');
const { auditCandidates, likelyBundle } = require('./bundle-candidates.cjs');

const brand = process.env.DUPLICATE_AUDIT_BRAND || 'Patek Philippe';
const pageSize = Math.min(1000, Math.max(50, Number(process.env.DUPLICATE_AUDIT_PAGE_SIZE || 500)));
const maxRows = Math.max(0, Number(process.env.DUPLICATE_AUDIT_MAX_ROWS || 0));
const outputRoot = path.resolve(process.env.DUPLICATE_AUDIT_OUTPUT || 'audit-output/duplicates');
const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outputDir = path.join(outputRoot, slug);
const reset = String(process.env.DUPLICATE_AUDIT_RESET || 'false').toLowerCase() === 'true';
const checkpointPages = Math.max(1, Number(process.env.DUPLICATE_AUDIT_CHECKPOINT_PAGES || 25));
const workerCount = Math.max(1, Math.min(Number(process.env.DUPLICATE_AUDIT_WORKERS || Math.min(8, os.availableParallelism())), 12));
const auditFormatVersion = 2;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function csv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function validImmutableListingDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

function canonicalDateEvidence(row) {
  const listingDate = validImmutableListingDate(row?.listing_date);
  if (listingDate) {
    return { value: listingDate, timestamp: Date.parse(`${listingDate}T00:00:00.000Z`), source: 'LISTING_DATE' };
  }
  const createdTimestamp = Date.parse(row?.created_at || '');
  if (Number.isFinite(createdTimestamp)) {
    return { value: row.created_at, timestamp: createdTimestamp, source: 'CREATED_AT_FALLBACK' };
  }
  return { value: null, timestamp: 0, source: 'MISSING' };
}

function chooseCanonical(left, right) {
  const leftDate = canonicalDateEvidence(left);
  const rightDate = canonicalDateEvidence(right);
  const sourceRank = { MISSING: 0, CREATED_AT_FALLBACK: 1, LISTING_DATE: 2 };
  const leftRank = sourceRank[leftDate.source];
  const rightRank = sourceRank[rightDate.source];
  if (rightRank !== leftRank) return rightRank > leftRank ? right : left;
  if (rightDate.timestamp !== leftDate.timestamp) return rightDate.timestamp > leftDate.timestamp ? right : left;
  return String(right.id).localeCompare(String(left.id)) > 0 ? right : left;
}

function createWorkerPool(size) {
  const workers = Array.from({ length: size }, () => new Worker(path.join(__dirname, 'bundle-worker.cjs')));
  let sequence = 0;
  function run(worker, rows) {
    const taskId = ++sequence;
    return new Promise((resolve, reject) => {
      const onMessage = message => {
        if (message.taskId !== taskId) return;
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolve(message.results);
      };
      const onError = error => { cleanup(); reject(error); };
      const cleanup = () => { worker.off('message', onMessage); worker.off('error', onError); };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.postMessage({ taskId, rows });
    });
  }
  return {
    async process(rows) {
      const chunks = Array.from({ length: workers.length }, () => []);
      rows.forEach((row, index) => chunks[index % workers.length].push(row));
      const chunkResults = await Promise.all(workers.map((worker, index) => run(worker, chunks[index])));
      const byId = new Map(chunkResults.flat().map(result => [result.sourceId, result]));
      return rows.map(row => byId.get(row.id));
    },
    async close() { await Promise.all(workers.map(worker => worker.terminate())); },
  };
}

async function fetchPage(baseUrl, serviceKey, lastId) {
  const params = new URLSearchParams({
    select: 'id,brand,reference,dial_color,condition,price_usd,currency,raw_message,listing_date,created_at,listing_type,source,source_type,seller_phone,seller_name,flags',
    brand: `eq.${brand}`,
    order: 'id.asc',
    limit: String(pageSize),
  });
  if (lastId) params.set('id', `gt.${lastId}`);
  const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json();
}

function writeSummary(summary, samples) {
  const lines = [
    `# ${brand} Duplicate Audit`, '', `Generated: ${new Date().toISOString()}`, '',
    '## Scope', '',
    `- Rows scanned: ${summary.rowsScanned.toLocaleString()}`,
    `- Rows with bundle-like source text: ${summary.bundleRows.toLocaleString()}`,
    `- Parsed child candidates from bundle rows: ${(summary.bundleCandidates || 0).toLocaleString()}`,
    `- Bundle rows still unresolved after segmentation: ${(summary.unresolvedBundleRows || 0).toLocaleString()}`,
    `- Candidate duplicate members: ${summary.candidateMembers.toLocaleString()}`,
    `- Safe automatic suppressions proposed: ${summary.safeSuppressions.toLocaleString()}`,
    `- Review-only candidates: ${summary.reviewOnly.toLocaleString()}`, '',
    '## Categories', '',
    ...Object.entries(summary.categories).sort().map(([key, value]) => `- ${key}: ${value.toLocaleString()}`), '',
    '## Interpretation', '',
    'This is a read-only candidate report. No production row was deleted, modified, or hidden. Bundle-like rows are segmented into line-level candidates before duplicate comparison; their matches remain review-only until split lineage is materialized and approved.', '',
    'Different dealers are not automatically merged. Price updates remain historical market observations. A changed date raises a repost candidate but does not prove physical-watch identity.', '',
    '## Redacted Examples', '',
    ...samples.map(sample => `- ${sample.type}: canonical ${sample.canonicalId}; candidate ${sample.candidateId}; confidence ${sample.confidence}; source ${sample.sourceHash}`), '',
  ];
  fs.writeFileSync(path.join(outputDir, 'summary.md'), `${lines.join('\n')}\n`);
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  fs.mkdirSync(outputDir, { recursive: true });
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const legacyStatePath = path.join(outputDir, 'checkpoint-state.bin');
  const csvPath = path.join(outputDir, 'candidate-clusters.csv');
  if (reset) {
    for (const target of [checkpointPath, csvPath, ...fs.readdirSync(outputDir).filter(name => name.startsWith('checkpoint-state-') || name === 'checkpoint-state.bin').map(name => path.join(outputDir, name))]) {
      fs.rmSync(target, { force: true });
    }
  }
  const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
  if (checkpoint && checkpoint.auditFormatVersion !== auditFormatVersion) {
    throw new Error('Duplicate audit checkpoint predates source-date canonical selection; rerun with DUPLICATE_AUDIT_RESET=true');
  }
  if (checkpoint?.completed) {
    process.stdout.write(`${JSON.stringify({ event: 'duplicate_audit_already_complete', brand, ...checkpoint.summary })}\n`);
    return;
  }
  let activeStatePath = checkpoint?.stateFile ? path.join(outputDir, checkpoint.stateFile) : legacyStatePath;
  if (checkpoint && !fs.existsSync(activeStatePath)) throw new Error(`Checkpoint state is missing: ${activeStatePath}`);
  const restored = checkpoint && fs.existsSync(activeStatePath) ? v8.deserialize(fs.readFileSync(activeStatePath)) : null;
  const indexes = restored?.indexes || { exactRaw: new Map(), exactListing: new Map(), dateAgnosticRaw: new Map(), configuration: new Map(), marketConfiguration: new Map() };
  const summary = restored?.summary || { rowsScanned: 0, bundleRows: 0, bundleCandidates: 0, unresolvedBundleRows: 0, candidateMembers: 0, safeSuppressions: 0, reviewOnly: 0, categories: {} };
  const samples = restored?.samples || [];
  let lastId = restored?.lastId || '';
  let pendingCsv = '';
  let pagesSinceCheckpoint = 0;
  const workerPool = createWorkerPool(workerCount);
  const header = 'category,confidence,suppress_from_analytics,canonical_id,candidate_id,canonical_date,candidate_date,canonical_date_source,candidate_date_source,canonical_listing_date,candidate_listing_date,canonical_created_at,candidate_created_at,reference,dial,condition,canonical_price,candidate_price,source_hash,bundle_risk\n';
  if (!checkpoint) fs.writeFileSync(csvPath, header);
  else if (Number.isFinite(checkpoint.csvSize) && fs.existsSync(csvPath) && fs.statSync(csvPath).size > checkpoint.csvSize) fs.truncateSync(csvPath, checkpoint.csvSize);

  function persistCheckpoint(completed) {
    const csvSize = (fs.existsSync(csvPath) ? fs.statSync(csvPath).size : 0) + Buffer.byteLength(pendingCsv);
    const serialized = v8.serialize({ indexes, summary, samples, lastId });
    const stateFile = `checkpoint-state-${Date.now()}-${process.pid}.bin`;
    const nextStatePath = path.join(outputDir, stateFile);
    fs.writeFileSync(nextStatePath, serialized);
    if (pendingCsv) fs.appendFileSync(csvPath, pendingCsv);
    const nextCheckpoint = {
      auditFormatVersion,
      brand,
      lastId,
      summary,
      samples,
      csvSize,
      stateFile,
      completed,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(`${checkpointPath}.tmp`, `${JSON.stringify(nextCheckpoint, null, 2)}\n`);
    fs.renameSync(`${checkpointPath}.tmp`, checkpointPath);
    if (activeStatePath !== nextStatePath && fs.existsSync(activeStatePath)) fs.rmSync(activeStatePath, { force: true });
    activeStatePath = nextStatePath;
    pendingCsv = '';
    pagesSinceCheckpoint = 0;
  }

  while (!maxRows || summary.rowsScanned < maxRows) {
    const rows = await fetchPage(baseUrl, serviceKey, lastId);
    if (!rows.length) break;
    const processedRows = await workerPool.process(rows);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const processed = processedRows[rowIndex];
      if (maxRows && summary.rowsScanned >= maxRows) break;
      summary.rowsScanned += 1;
      lastId = row.id;
      const bundleRisk = processed.bundleRisk;
      if (bundleRisk) summary.bundleRows += 1;
      const candidateRows = processed.candidateRows;
      if (bundleRisk && !candidateRows.length) summary.unresolvedBundleRows += 1;
      if (bundleRisk) summary.bundleCandidates += candidateRows.length;
      for (const auditRow of candidateRows) {
        const signatures = signaturesFor(auditRow);
        const matches = [];
        for (const [key, signature] of Object.entries(signatures)) {
          if (!signature) continue;
          const stored = indexes[key].get(signature);
          if (stored) matches.push(stored);
        }
        const uniqueMatches = [...new Map(matches.map(match => [match.id, match])).values()];
        let best = null;
        for (const match of uniqueMatches) {
          const classification = classifyPair(match, auditRow);
          if (classification && (!best || classification.confidence > best.classification.confidence)) best = { match, classification };
        }
        if (best) {
          const canonical = chooseCanonical(best.match, auditRow);
          const candidate = canonical.id === auditRow.id ? best.match : auditRow;
          const splitLineage = Boolean(auditRow.bundle_parent_id || best.match.bundle_parent_id);
          const safe = best.classification.suppressFromAnalytics && !splitLineage;
          const canonicalDate = canonicalDateEvidence(canonical);
          const candidateDate = canonicalDateEvidence(candidate);
          summary.candidateMembers += 1;
          summary.categories[best.classification.type] = (summary.categories[best.classification.type] || 0) + 1;
          if (safe) summary.safeSuppressions += 1; else summary.reviewOnly += 1;
          const sourceHash = hash(sourceIdentity(auditRow)).slice(0, 12);
          pendingCsv += [
            best.classification.type, best.classification.confidence.toFixed(2), safe, canonical.id, candidate.id,
            canonicalDate.value || '', candidateDate.value || '', canonicalDate.source, candidateDate.source,
            canonical.listing_date || '', candidate.listing_date || '', canonical.created_at || '', candidate.created_at || '',
            canonical.reference, canonical.dial_color,
            canonical.condition, canonical.price_usd, candidate.price_usd, sourceHash, splitLineage,
          ].map(csv).join(',') + '\n';
          if (samples.length < 20) samples.push({ type: best.classification.type, canonicalId: canonical.id, candidateId: candidate.id, confidence: best.classification.confidence.toFixed(2), sourceHash });
        }
        for (const [key, signature] of Object.entries(signatures)) {
          if (!signature) continue;
          const current = indexes[key].get(signature);
          indexes[key].set(signature, current ? chooseCanonical(current, auditRow) : auditRow);
        }
      }
    }
    pagesSinceCheckpoint += 1;
    if (pagesSinceCheckpoint >= checkpointPages) persistCheckpoint(false);
    process.stdout.write(`${JSON.stringify({ event: 'duplicate_audit_page', brand, rowsScanned: summary.rowsScanned, candidates: summary.candidateMembers, lastId })}\n`);
    if (rows.length < pageSize) break;
  }
  persistCheckpoint(true);
  await workerPool.close();
  writeSummary(summary, samples);
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify({ brand, generatedAt: new Date().toISOString(), ...summary }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'duplicate_audit_complete', brand, outputDir, ...summary })}\n`);
}

module.exports = { canonicalDateEvidence, chooseCanonical, createWorkerPool, validImmutableListingDate };

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'duplicate_audit_error', brand, error: error.message })}\n`);
    process.exitCode = 1;
  });
}
