const { getClient } = require('./_lib/supabase');

const PAGE_SIZE_MAX = 100;
const DEFAULT_PAGE_SIZE = 48;

function cleanFilter(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
    .replace(/[(),.%*]/g, ' ');
}

function cleanExactText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeReference(value) {
  return cleanFilter(value, 80).toUpperCase().replace(/[\s-]+/g, '');
}

async function loadSummary(client) {
  const { data, error } = await client
    .from('reviewed_workbook_import_checkpoints')
    .select(
      'source_file_sha256,source_file,brand_scope,expected_rows,rows_scanned,rows_inserted,rows_duplicate_held,rows_errors,status',
    )
    .order('brand_scope', { ascending: true });
  if (error) throw error;
  const files = data || [];
  const brands = new Map();
  const summary = {
    files_total: files.length,
    files_complete: 0,
    source_rows: 0,
    rows_scanned: 0,
    canonical_listings: 0,
    duplicate_rows_held: 0,
    errors: 0,
  };
  for (const file of files) {
    summary.files_complete += Number(file.status === 'COMPLETE');
    summary.source_rows += Number(file.expected_rows || 0);
    summary.rows_scanned += Number(file.rows_scanned || 0);
    summary.canonical_listings += Number(file.rows_inserted || 0);
    summary.duplicate_rows_held += Number(file.rows_duplicate_held || 0);
    summary.errors += Number(file.rows_errors || 0);
    const brand = brands.get(file.brand_scope) || {
      brand: file.brand_scope,
      files: 0,
      files_complete: 0,
      source_rows: 0,
      canonical_listings: 0,
      duplicate_rows_held: 0,
    };
    brand.files += 1;
    brand.files_complete += Number(file.status === 'COMPLETE');
    brand.source_rows += Number(file.expected_rows || 0);
    brand.canonical_listings += Number(file.rows_inserted || 0);
    brand.duplicate_rows_held += Number(file.rows_duplicate_held || 0);
    brands.set(file.brand_scope, brand);
  }
  return {
    ...summary,
    reconciled: summary.rows_scanned
      === summary.canonical_listings + summary.duplicate_rows_held + summary.errors,
    brands: [...brands.values()].sort((left, right) =>
      right.canonical_listings - left.canonical_listings),
  };
}

function resolveTotal({ count, summary, brand, reference, sourceFile, imagesOnly }) {
  if (reference || sourceFile || imagesOnly) return Number(count || 0);
  if (!brand) return Number(summary.canonical_listings || 0);
  return Number(
    summary.brands.find(item => item.brand === brand)?.canonical_listings || 0,
  );
}

function resolvePageWindow({ page, pageSize, total, canReverse }) {
  const requestedStart = (page - 1) * pageSize;
  if (!canReverse || requestedStart <= total / 2) {
    return {
      reverse: false,
      empty: false,
      start: requestedStart,
      end: requestedStart + pageSize - 1,
      requestedStart,
    };
  }
  const requestedEnd = Math.min(requestedStart + pageSize, total);
  const rowCount = Math.max(0, requestedEnd - requestedStart);
  if (rowCount === 0) {
    return { reverse: true, empty: true, start: 0, end: -1, requestedStart };
  }
  const reverseStart = total - requestedEnd;
  return {
    reverse: true,
    empty: false,
    start: reverseStart,
    end: reverseStart + rowCount - 1,
    requestedStart,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const client = getClient();
    const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
    const requestedPageSize = Number.parseInt(
      String(req.query?.pageSize || DEFAULT_PAGE_SIZE),
      10,
    );
    const page = Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
    const pageSize = Number.isInteger(requestedPageSize)
      ? Math.min(Math.max(requestedPageSize, 12), PAGE_SIZE_MAX)
      : DEFAULT_PAGE_SIZE;
    const brand = cleanFilter(req.query?.brand, 80);
    const reference = normalizeReference(req.query?.reference || req.query?.q);
    const sourceFile = cleanExactText(req.query?.sourceFile, 180);
    const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
    const summary = await loadSummary(client);
    const canReverse = !reference && !sourceFile && !imagesOnly;
    const knownTotal = canReverse
      ? resolveTotal({ count: 0, summary, brand, reference, sourceFile, imagesOnly })
      : 0;
    const pageWindow = resolvePageWindow({
      page,
      pageSize,
      total: knownTotal,
      canReverse,
    });
    const columns = [
      'id,source_file,source_row_number,source_record_id,posting_date,posted_by',
      'phone_number,raw_message,listing_type,brand_scope,supplied_brand',
      'canonical_brand,model,raw_reference,normalized_reference,catalog_reference',
      'catalog_model,dial_color,catalog_dial,condition,workbook_price_usd',
      'source_price_amount,source_price_text,source_currency,price_evidence_status',
      'verification_tier,confidence,verification_status,user_image_url',
      'display_image_url,has_image,image_evidence_type',
      'review_reasons',
    ].join(',');
    if (pageWindow.empty) {
      return res.status(200).json({
        status: 'ok',
        page,
        pageSize,
        count: 0,
        total: knownTotal,
        hasMore: false,
        records: [],
        summary,
        priceResearchRule:
          'Only SOURCE_EXPLICIT_USD_MATCH rows may be considered for Price Research; workbook USD values remain review evidence.',
      });
    }
    let query = client
      .from('reviewed_workbook_inventory')
      .select(columns, { count: 'estimated' });
    query = pageWindow.reverse
      ? query
        .order('has_image', { ascending: true })
        .order('workbook_price_usd', { ascending: true, nullsFirst: true })
        .order('id', { ascending: false })
      : query
        .order('has_image', { ascending: false })
        .order('workbook_price_usd', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true });
    if (brand) query = query.eq('brand_scope', brand);
    if (reference) query = query.eq('normalized_reference', reference);
    if (sourceFile) query = query.eq('source_file', sourceFile);
    if (imagesOnly) query = query.not('display_image_url', 'is', null);
    query = query.range(pageWindow.start, pageWindow.end);
    const { data, count, error } = await query;
    if (error) throw error;
    const total = resolveTotal({
      count,
      summary,
      brand,
      reference,
      sourceFile,
      imagesOnly,
    });
    const records = pageWindow.reverse ? [...(data || [])].reverse() : (data || []);
    return res.status(200).json({
      status: 'ok',
      page,
      pageSize,
      count: records.length,
      total,
      hasMore: pageWindow.requestedStart + records.length < total,
      records,
      summary,
      priceResearchRule:
        'Only SOURCE_EXPLICIT_USD_MATCH rows may be considered for Price Research; workbook USD values remain review evidence.',
    });
  } catch (error) {
    console.error('[reviewed-workbook-inventory] error:', error.message);
    return res.status(503).json({
      status: 'error',
      error: 'Reviewed workbook inventory is temporarily unavailable',
    });
  }
};

module.exports.cleanFilter = cleanFilter;
module.exports.cleanExactText = cleanExactText;
module.exports.loadSummary = loadSummary;
module.exports.normalizeReference = normalizeReference;
module.exports.resolvePageWindow = resolvePageWindow;
module.exports.resolveTotal = resolveTotal;
