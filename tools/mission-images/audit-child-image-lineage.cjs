'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BRAND = String(process.env.MEDIA_BRAND || 'Patek Philippe').trim();
const UNBUNDLED_DIR = process.env.UNBUNDLED_DIR ||
  'C:/Users/jasme/Documents/Codex/2026-07-12/review/work/wf-data-canary/audit-output/unbundled';
const OUTPUT_DIR = process.env.MEDIA_AUDIT_OUTPUT_DIR || 'outputs/image-lineage';
const PUBLIC_BASE = String(process.env.DO_LISTINGS_PUBLIC_BASE ||
  'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full').replace(/\/+$/, '');
const IMAGE_FIELDS = ['front_image', 'back_image', 'side_image', 'other_image1', 'other_image2', 'other_image3'];

function normalize(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function recordId(sourceTable, sourceId) {
  return `mysql_${String(sourceTable || '').replace(/[^a-z0-9_]/gi, '_')}_${sourceId}`;
}

function validReference(value) {
  const ref = String(value || '').trim();
  return ref.length >= 3 && !/^(?:19|20)\d{2}Y?$/i.test(ref) && !/^UNKNOWN$/i.test(ref);
}

function classifyParent(parent, children) {
  if (!children.length) return { decision: 'NO_CHILD_MAPPING', reason: 'No unbundled child maps to this image parent.' };
  if (children.length > 1) return { decision: 'REVIEW_MULTI_LISTING_PARENT', reason: 'One parent image is shared by multiple child listings.' };

  const child = children[0];
  const sourceReference = parent.raw_data?.normalized_reference || parent.raw_data?.reference;
  if (!validReference(child.reference) || normalize(child.brand) !== normalize(parent.raw_data?.brand)) {
    return { decision: 'REVIEW_CHILD_IDENTITY', reason: 'Child brand or reference is incomplete.' };
  }
  if (normalize(sourceReference) !== normalize(child.reference)) {
    return { decision: 'REVIEW_PARENT_CHILD_CONFLICT', reason: 'Parent and child references do not agree exactly.' };
  }
  return { decision: 'SAFE_SINGLE_LISTING_CANDIDATE', reason: 'Single child and exact parent/child brand-reference agreement.' };
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function imageUrls(rawData) {
  return IMAGE_FIELDS
    .map(field => String(rawData?.[field] || '').trim())
    .filter(Boolean)
    .map(value => /^https?:\/\//i.test(value) ? value : `${PUBLIC_BASE}/${encodeURIComponent(path.posix.basename(value))}`);
}

async function supabase(pathname, headers = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

async function loadImageParents() {
  const parents = new Map();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const params = new URLSearchParams({ select: 'source_table,source_id,raw_data', order: 'id.asc' });
    const rows = await supabase(`raw_records?${params}`, { Range: `${offset}-${offset + pageSize - 1}` });
    for (const row of rows) {
      if (normalize(row.raw_data?.brand) !== normalize(BRAND) || !imageUrls(row.raw_data).length) continue;
      parents.set(recordId(row.source_table, row.source_id), row);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return parents;
}

function findMappedChildren(parentIds) {
  const patternFile = path.join(os.tmpdir(), `wf-image-parent-ids-${process.pid}.txt`);
  fs.writeFileSync(patternFile, `${[...parentIds].join('\n')}\n`);
  return new Promise((resolve, reject) => {
    const children = new Map();
    const rg = spawn('rg', [
      '--fixed-strings', '--file', patternFile, '--no-filename', '--no-messages',
      '--glob', '*_mapping_*.csv', UNBUNDLED_DIR,
    ], { windowsHide: true });
    let remainder = '';
    rg.stdout.setEncoding('utf8');
    rg.stdout.on('data', chunk => {
      const lines = (remainder + chunk).split(/\r?\n/);
      remainder = lines.pop() || '';
      for (const line of lines) collect(line);
    });
    rg.stderr.on('data', () => {});
    rg.on('error', error => finish(error));
    rg.on('close', code => finish(code > 1 ? new Error(`rg exited with ${code}`) : null));

    function collect(line) {
      const [sourceRecordId, candidateIndex, listingId, reference, brand] = line.split(',');
      if (!parentIds.has(sourceRecordId) || !listingId) return;
      const rows = children.get(sourceRecordId) || [];
      if (!rows.some(row => row.listing_id === listingId)) {
        rows.push({ candidate_index: candidateIndex, listing_id: listingId, reference, brand });
        children.set(sourceRecordId, rows);
      }
    }

    function finish(error) {
      try { fs.unlinkSync(patternFile); } catch {}
      if (error) reject(error);
      else {
        if (remainder) collect(remainder);
        resolve(children);
      }
    }
  });
}

async function run() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!fs.existsSync(UNBUNDLED_DIR)) throw new Error(`Unbundled directory not found: ${UNBUNDLED_DIR}`);

  const parents = await loadImageParents();
  const children = await findMappedChildren(new Set(parents.keys()));
  const rows = [];
  const counts = {};
  for (const [sourceId, parent] of parents) {
    const mapped = children.get(sourceId) || [];
    const result = classifyParent(parent, mapped);
    counts[result.decision] = (counts[result.decision] || 0) + 1;
    rows.push({
      source_record_id: sourceId,
      raw_source_id: parent.source_id,
      source_table: parent.source_table,
      parent_reference: parent.raw_data?.normalized_reference || parent.raw_data?.reference || '',
      image_urls: imageUrls(parent.raw_data).join('|'),
      child_count: mapped.length,
      child_listing_ids: mapped.map(child => child.listing_id).join('|'),
      child_references: mapped.map(child => child.reference).join('|'),
      decision: result.decision,
      reason: result.reason,
    });
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const slug = BRAND.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
  const outputPath = path.resolve(OUTPUT_DIR, `${slug}-child-image-lineage.csv`);
  const headers = Object.keys(rows[0] || {
    source_record_id: '', source_table: '', parent_reference: '', image_urls: '', child_count: '',
    raw_source_id: '', child_listing_ids: '', child_references: '', decision: '', reason: '',
  });
  fs.writeFileSync(outputPath, `${headers.join(',')}\n${rows.map(row => headers.map(header => csv(row[header])).join(',')).join('\n')}\n`);
  process.stdout.write(`${JSON.stringify({
    status: 'audit_complete',
    mode: 'read_only',
    brand: BRAND,
    image_parents: parents.size,
    mapped_parents: children.size,
    decisions: counts,
    output_path: outputPath,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { classifyParent, imageUrls, normalize, recordId, validReference };
