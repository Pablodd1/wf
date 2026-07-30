'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const EXPECTED_HEADERS = [
  'Auction ID',
  'Posting Date',
  'Posted By',
  'raw_line',
  'Phone Number',
  'Intent / Type',
  'Brand',
  'Model',
  'Raw Reference',
  'Normalized Reference',
  'Catalog Reference',
  'Catalog Model',
  'Dial Color',
  'Catalog Dial',
  'Condition',
  'Price ($ USD)',
  'Verification Tier',
  'Confidence %',
  'Verification Status',
  'User Image URL',
  'Catalog Image URL',
  'Final Image URL',
];

function text(value) {
  return value == null ? '' : String(value).trim();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function chosenImage(row) {
  return text(row['User Image URL'])
    || text(row['Final Image URL'])
    || text(row['Catalog Image URL'])
    || null;
}

function readWorkbook(inputPath) {
  const source = fs.readFileSync(inputPath);
  const workbook = XLSX.read(source, { type: 'buffer', cellDates: true });
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== 'Zenith') {
    throw new Error(`Expected one Zenith worksheet, found ${workbook.SheetNames.join(', ')}`);
  }
  const sheet = workbook.Sheets.Zenith;
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const headers = (matrix[0] || []).map(text);
  if (headers.length !== EXPECTED_HEADERS.length
    || headers.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new Error('Zenith workbook headers do not match the reviewed publication contract');
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  return {
    sha256: sha256(source),
    rows: rows.map((row, index) => ({
      worksheet_row: index + 2,
      auction_id: text(row['Auction ID']),
      posting_date: text(row['Posting Date']),
      seller_name: text(row['Posted By']) || null,
      raw_message: text(row.raw_line),
      seller_phone: text(row['Phone Number']) || null,
      listing_type: text(row['Intent / Type']).toUpperCase(),
      brand: text(row.Brand),
      model: text(row['Catalog Model']) || text(row.Model) || null,
      raw_reference: text(row['Raw Reference']) || null,
      reference: text(row['Catalog Reference']) || text(row['Normalized Reference']) || null,
      dial_color: text(row['Catalog Dial']) || text(row['Dial Color']) || null,
      condition: text(row.Condition) || null,
      price_usd: text(row['Price ($ USD)']) || null,
      verification_tier: text(row['Verification Tier']) || null,
      confidence: text(row['Confidence %']) || null,
      verification_status: text(row['Verification Status']) || null,
      image_url: chosenImage(row),
    })),
  };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function extensionFor(contentType) {
  if (/png/i.test(contentType)) return '.png';
  if (/webp/i.test(contentType)) return '.webp';
  return '.jpg';
}

async function downloadReviewImage(item, imageDir) {
  const response = await fetch(item.image_url, {
    headers: { 'User-Agent': 'WatchFacts-Zenith-Review/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    return { ...item, image_status: `HTTP_${response.status}`, local_image: null };
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/^image\//i.test(contentType)) {
    return { ...item, image_status: `NON_IMAGE_${contentType}`, local_image: null };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = `${String(item.worksheet_row).padStart(4, '0')}${extensionFor(contentType)}`;
  const localImage = path.join(imageDir, filename);
  fs.writeFileSync(localImage, bytes);
  return {
    ...item,
    image_status: 'REACHABLE',
    image_content_type: contentType,
    image_bytes: bytes.length,
    local_image: localImage,
  };
}

async function run() {
  const inputPath = path.resolve(process.argv[2] || process.env.ZENITH_WORKBOOK_PATH || '');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Zenith workbook path is required');
  const outputDir = path.resolve(process.env.ZENITH_AUDIT_OUTPUT
    || path.join('audit-output', 'zenith-reviewed-publication-20260730'));
  const imageDir = path.join(outputDir, 'visual-review', 'images');
  fs.mkdirSync(imageDir, { recursive: true });

  const workbook = readWorkbook(inputPath);
  const reviewItems = workbook.rows.filter(row => !row.dial_color && row.image_url);
  const downloaded = await mapConcurrent(
    reviewItems,
    8,
    item => downloadReviewImage(item, imageDir),
  );
  const manifest = {
    created_at: new Date().toISOString(),
    input_path: inputPath,
    workbook_sha256: workbook.sha256,
    workbook_rows: workbook.rows.length,
    missing_dial_with_image: reviewItems.length,
    reachable_images: downloaded.filter(item => item.image_status === 'REACHABLE').length,
    failed_images: downloaded.filter(item => item.image_status !== 'REACHABLE').length,
    items: downloaded,
  };
  fs.writeFileSync(
    path.join(outputDir, 'visual-review-input.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    output_dir: outputDir,
    workbook_sha256: workbook.sha256,
    workbook_rows: workbook.rows.length,
    missing_dial_with_image: reviewItems.length,
    reachable_images: manifest.reachable_images,
    failed_images: manifest.failed_images,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { chosenImage, readWorkbook };
