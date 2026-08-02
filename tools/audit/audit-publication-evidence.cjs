'use strict';

const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function csvCell(value) {
  const string = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function increment(target, key) {
  target[key] = Number(target[key] || 0) + 1;
}

function isMultipleSentinel(record) {
  return [record.dial_color, record.condition, record.model]
    .some(value => /^(?:multi|multiple|mixed)$/i.test(text(value)));
}

async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.ok) return response.json();
    if (response.status < 500 && response.status !== 429) {
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    if (attempt === 4) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  throw new Error(`Unable to fetch ${url}`);
}

async function main() {
  const baseUrl = arg('base-url', 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');
  const outputDir = path.resolve(arg('output-dir', path.join('audit-output', `publication-evidence-${Date.now()}`)));
  const pageSize = 100;
  const requestedMaxPages = Number.parseInt(arg('max-pages', '50'), 10);
  const maxPages = Number.isInteger(requestedMaxPages) && requestedMaxPages > 0
    ? requestedMaxPages
    : 50;
  const first = await getJson(`${baseUrl}/api/reviewed-market-inventory?pageSize=${pageSize}&pagination=cursor&cursor=1`);
  if (first.status !== 'ok') throw new Error(first.error || 'inventory endpoint failed');
  const total = Number(first.total || 0);
  const availablePageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageCount = Math.min(availablePageCount, maxPages);
  const expectedRecordsInScope = Math.min(total, pageCount * pageSize);
  const records = [...(first.records || [])];

  for (let start = 2; start <= pageCount; start += 3) {
    const pages = [];
    for (let page = start; page < Math.min(start + 3, pageCount + 1); page += 1) {
      pages.push(getJson(`${baseUrl}/api/reviewed-market-inventory?pageSize=${pageSize}&pagination=cursor&cursor=${page}`));
    }
    const payloads = await Promise.all(pages);
    for (const payload of payloads) records.push(...(payload.records || []));
  }

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    audit_scope: pageCount === availablePageCount ? 'full_live_endpoint' : 'bounded_ordered_live_sample',
    live_total_estimate: total,
    audit_page_count: pageCount,
    expected_records_in_scope: expectedRecordsInScope,
    audited_records: records.length,
    reconciliation_ok: records.length === expectedRecordsInScope,
    complete_identity: 0,
    verified_usd_price: 0,
    workbook_price_pending_source_currency: 0,
    no_price_in_workbook: 0,
    approved_contact: 0,
    missing_poster_name: 0,
    missing_poster_phone: 0,
    exact_source_image: 0,
    normalized_summary_only: 0,
    possible_multiple_listing: 0,
    price_evidence_status: {},
    by_brand: {},
  };
  const issues = [];

  for (const record of records) {
    const workbookPrice = positive(record.workbook_price_usd);
    const verifiedPrice = positive(record.price_usd);
    const contactApproved = record.contact_publication_approved === true;
    const multiple = isMultipleSentinel(record);
    summary.complete_identity += Number(record.has_complete_identity === true);
    summary.verified_usd_price += Number(verifiedPrice !== null);
    summary.workbook_price_pending_source_currency += Number(workbookPrice !== null && verifiedPrice === null);
    summary.no_price_in_workbook += Number(workbookPrice === null);
    summary.approved_contact += Number(contactApproved && text(record.seller_phone) !== '');
    summary.missing_poster_name += Number(text(record.seller_name) === '');
    summary.missing_poster_phone += Number(text(record.seller_phone) === '');
    summary.exact_source_image += Number(record.has_images === true);
    summary.normalized_summary_only += Number(record.raw_message_scope === 'normalized_summary');
    summary.possible_multiple_listing += Number(multiple);
    increment(summary.price_evidence_status, text(record.price_evidence_status) || 'MISSING_STATUS');

    const brand = text(record.brand) || 'Unknown';
    summary.by_brand[brand] ||= {
      records: 0,
      verified_usd_price: 0,
      workbook_price_pending_source_currency: 0,
      no_price_in_workbook: 0,
      approved_contact: 0,
      exact_source_image: 0,
      possible_multiple_listing: 0,
    };
    const brandSummary = summary.by_brand[brand];
    brandSummary.records += 1;
    brandSummary.verified_usd_price += Number(verifiedPrice !== null);
    brandSummary.workbook_price_pending_source_currency += Number(workbookPrice !== null && verifiedPrice === null);
    brandSummary.no_price_in_workbook += Number(workbookPrice === null);
    brandSummary.approved_contact += Number(contactApproved && text(record.seller_phone) !== '');
    brandSummary.exact_source_image += Number(record.has_images === true);
    brandSummary.possible_multiple_listing += Number(multiple);

    const reasons = [];
    if (workbookPrice !== null && verifiedPrice === null) reasons.push('WORKBOOK_PRICE_SOURCE_CURRENCY_PENDING');
    if (workbookPrice === null) reasons.push('WORKBOOK_PRICE_MISSING');
    if (!text(record.seller_name)) reasons.push('POSTER_NAME_MISSING');
    if (!text(record.seller_phone)) reasons.push('POSTER_PHONE_MISSING');
    if (multiple) reasons.push('POSSIBLE_MULTIPLE_LISTING');
    if (record.raw_message_scope === 'normalized_summary') reasons.push('ORIGINAL_RAW_MESSAGE_NOT_LINKED');
    if (reasons.length) {
      issues.push({
        id: record.id,
        source_file: record.source_file,
        source_row_number: record.source_row_number,
        source_record_id: record.source_record_id,
        brand,
        model: record.model,
        reference: record.reference,
        dial_color: record.dial_color,
        listing_type: record.listing_type,
        workbook_price_usd: workbookPrice,
        verified_price_usd: verifiedPrice,
        price_evidence_status: record.price_evidence_status,
        seller_name: record.seller_name,
        seller_phone: record.seller_phone,
        has_images: record.has_images,
        raw_message_scope: record.raw_message_scope,
        reasons: reasons.join('|'),
      });
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'run-manifest.json'), `${JSON.stringify({
    generated_at: summary.generated_at,
    command: `node tools/audit/audit-publication-evidence.cjs --base-url ${baseUrl} --max-pages ${maxPages}`,
    read_only: true,
    writes: ['local_output_files'],
    audit_scope: summary.audit_scope,
  }, null, 2)}\n`);
  const columns = Object.keys(issues[0] || {});
  const csv = [columns.join(','), ...issues.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n');
  fs.writeFileSync(path.join(outputDir, 'issues.csv'), `${csv}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
