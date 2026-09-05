'use strict';

const path = require('node:path');
const { supabaseFetch, writeJson } = require('./recovery-control.cjs');

function chunks(values, size = 100) {
  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

async function fetchByIds(table, select, ids) {
  const pages = [];
  for (const group of chunks(ids)) {
    const query = new URLSearchParams({
      select,
      id: `in.(${group.join(',')})`,
    });
    pages.push(...await supabaseFetch(`/rest/v1/${table}?${query}`));
  }
  return pages;
}

async function fetchReviews(ids) {
  const pages = [];
  for (const group of chunks(ids)) {
    const query = new URLSearchParams({
      select: 'record_id,status',
      record_id: `in.(${group.join(',')})`,
    });
    pages.push(...await supabaseFetch(`/rest/v1/listing_identity_reviews?${query}`));
  }
  return pages;
}

async function fetchImageReviews(ids) {
  const pages = [];
  for (const group of chunks(ids)) {
    const query = new URLSearchParams({
      select: 'record_id,status',
      record_id: `in.(${group.join(',')})`,
      status: 'eq.VISUALLY_VERIFIED',
    });
    pages.push(...await supabaseFetch(`/rest/v1/listing_image_reviews?${query}`));
  }
  return pages;
}

async function run() {
  const jobName = String(process.env.RECOVERY_JOB_NAME || 'identity-stage:rm_conflicts');
  const checkpoints = await supabaseFetch(`/rest/v1/data_quality_remediation_checkpoints?${new URLSearchParams({
    select: 'job_name,last_record_id,rows_scanned,rows_written,metadata',
    job_name: `eq.${jobName}`,
    limit: '1',
  })}`);
  const checkpoint = checkpoints?.[0];
  const ids = checkpoint?.metadata?.last_batch_ids || [];
  if (!checkpoint || !Array.isArray(ids) || ids.length === 0) {
    throw new Error(`No bounded canary IDs found for ${jobName}`);
  }
  const reviews = await fetchReviews(ids);
  const statusById = new Map(reviews.map(row => [row.record_id, row.status]));
  const missingIdentityRows = ids.filter(id => !statusById.has(id));
  const sample = await fetchByIds(
    'trading_floor_verified_listings',
    'id,brand,model,reference,dial_color,listing_type,has_images,thumbnail_url',
    ids,
  );
  const identityLeaks = sample.filter(row => !['CATALOG_CONFIRMED', 'HUMAN_APPROVED'].includes(statusById.get(row.id)));
  const conflictRowsPublished = reviews
    .filter(row => row.status === 'CONFLICT' && sample.some(item => item.id === row.record_id))
    .map(row => row.record_id);
  const imageIds = sample.filter(row => row.has_images || row.thumbnail_url).map(row => row.id);
  const imageReviews = imageIds.length ? await fetchImageReviews(imageIds) : [];
  const verifiedImageIds = new Set(imageReviews.map(row => row.record_id));
  const imageLeaks = sample.filter(row => (row.has_images || row.thumbnail_url) && !verifiedImageIds.has(row.id));
  const result = {
    generated_at: new Date().toISOString(),
    checkpoint,
    expected_canary_rows: ids.length,
    identity_rows_found: reviews.length,
    missing_identity_rows: missingIdentityRows,
    conflict_rows_published: conflictRowsPublished,
    verified_sample_rows: sample.length,
    identity_leaks: identityLeaks.map(row => row.id),
    image_leaks: imageLeaks.map(row => row.id),
    passed: missingIdentityRows.length === 0
      && identityLeaks.length === 0
      && conflictRowsPublished.length === 0
      && imageLeaks.length === 0,
  };
  const output = process.env.RECOVERY_READBACK_OUTPUT
    || path.join('audit-output', 'data-quality', `recovery-readback-${new Date().toISOString().slice(0, 10)}.json`);
  writeJson(output, result);
  process.stdout.write(`${JSON.stringify({
    event: 'recovery_readback_complete',
    output,
    ...result,
  }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'recovery_readback_error',
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { chunks };
