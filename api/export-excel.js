/**
 * /api/export-excel.js
 *
 * Vercel serverless function for on-demand Excel export.
 * POST /api/export-excel
 * Body: { filters?: { brand?, reference?, verdict?, dateFrom?, dateTo? } }
 *
 * Returns: Excel file as binary download
 */

'use strict';

const XLSX = require('xlsx-js-style');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

// ─── Color Constants ──────────────────────────────────────────────────────────

const COLORS = {
  approved: { bg: 'C6EFCE', font: '006100' },
  review:   { bg: 'BDD7EE', font: '1F4E79' },
  human:    { bg: 'FFEB9C', font: '9C5700' },
  recycle:  { bg: 'FFC7CE', font: '9C0006' },
  header:   { bg: 'C9A96E', font: '000000' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVerdictColor(verdict) {
  switch (verdict) {
    case 'APPROVED': return COLORS.approved;
    case 'REVIEW':   return COLORS.review;
    case 'HUMAN':    return COLORS.human;
    case 'RECYCLE':  return COLORS.recycle;
    default:         return { bg: 'FFFFFF', font: '000000' };
  }
}

function getConfidenceFontColor(confidence) {
  if (confidence >= 85) return '006100';
  if (confidence >= 70) return '9C5700';
  if (confidence >= 50) return 'ED7D31';
  return '9C0006';
}

function makeCell(value, opts = {}) {
  const { bold = false, bgColor = 'FFFFFF', fontColor = '000000', align = 'left', numFmt } = opts;
  return {
    v: value,
    t: typeof value === 'number' ? 'n' : 's',
    s: {
      font: { bold, color: { rgb: fontColor }, name: 'Calibri', sz: 11 },
      fill: { fgColor: { rgb: bgColor }, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center' },
      border: {
        top:    { style: 'thin', color: { rgb: 'D0D0D0' } },
        bottom: { style: 'thin', color: { rgb: 'D0D0D0' } },
        left:   { style: 'thin', color: { rgb: 'D0D0D0' } },
        right:  { style: 'thin', color: { rgb: 'D0D0D0' } },
      },
      ...(numFmt ? { numFmt } : {}),
    },
  };
}

function makeHeader(value) {
  return makeCell(value, { bold: true, bgColor: COLORS.header.bg, fontColor: COLORS.header.font, align: 'center' });
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

// ─── Build Filtered Query ─────────────────────────────────────────────────────

function buildQuery(filters) {
  const selectFields = 'brand,reference,dial_color,condition,year,price_raw,price_usd,currency,confidence,verdict,raw_message,created_at';
  const conditions = [];

  if (filters.brand) {
    conditions.push(`brand=ilike.*${encodeURIComponent(filters.brand)}*`);
  }
  if (filters.reference) {
    conditions.push(`reference=ilike.*${encodeURIComponent(filters.reference)}*`);
  }
  if (filters.verdict) {
    conditions.push(`verdict=eq.${encodeURIComponent(filters.verdict)}`);
  }
  if (filters.dateFrom) {
    conditions.push(`created_at=gte.${encodeURIComponent(filters.dateFrom)}`);
  }
  if (filters.dateTo) {
    conditions.push(`created_at=lte.${encodeURIComponent(filters.dateTo)}`);
  }

  let query = `watch_records?select=${selectFields}`;
  if (conditions.length > 0) {
    query += '&' + conditions.join('&');
  }

  // Add limit - default 10000 for export
  const limit = Math.min(filters.limit || 10000, 50000);
  query += `&limit=${limit}`;

  return query;
}

// ─── Build Excel Workbook ─────────────────────────────────────────────────────

function buildWorkbook(records) {
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const total = records.length;

  // Summary stats
  const approvedCount = records.filter(r => r.verdict === 'APPROVED').length;
  const reviewCount   = records.filter(r => r.verdict === 'REVIEW').length;
  const humanCount    = records.filter(r => r.verdict === 'HUMAN').length;
  const recycleCount  = records.filter(r => r.verdict === 'RECYCLE').length;

  const prices = records.map(r => r.price_usd ?? r.price_raw ?? 0).filter(p => p > 0);
  const avgPrice = avg(prices);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  const confidences = records.map(r => r.confidence ?? 0).filter(c => c > 0);
  const avgConfidence = avg(confidences);

  // Sheet 1: Summary
  const summaryData = [
    [makeHeader('WatchFacts Filtered Export')],
    [],
    [makeCell('Generated', { bold: true, bgColor: 'F5F5F5' }), makeCell(dateStr)],
    [makeCell('Total Records', { bold: true, bgColor: 'F5F5F5' }), makeCell(total)],
    [makeCell('APPROVED', { bold: true, bgColor: COLORS.approved.bg, fontColor: COLORS.approved.font }), makeCell(approvedCount, { fontColor: COLORS.approved.font })],
    [makeCell('REVIEW', { bold: true, bgColor: COLORS.review.bg, fontColor: COLORS.review.font }), makeCell(reviewCount, { fontColor: COLORS.review.font })],
    [makeCell('HUMAN', { bold: true, bgColor: COLORS.human.bg, fontColor: COLORS.human.font }), makeCell(humanCount, { fontColor: COLORS.human.font })],
    [makeCell('RECYCLE', { bold: true, bgColor: COLORS.recycle.bg, fontColor: COLORS.recycle.font }), makeCell(recycleCount, { fontColor: COLORS.recycle.font })],
    [],
    [makeHeader('Price Statistics')],
    [makeCell('Average Price (USD)', { bold: true, bgColor: 'F5F5F5' }), makeCell(avgPrice, { numFmt: '$#,##0.00' })],
    [makeCell('Min Price (USD)', { bold: true, bgColor: 'F5F5F5' }), makeCell(minPrice, { numFmt: '$#,##0.00' })],
    [makeCell('Max Price (USD)', { bold: true, bgColor: 'F5F5F5' }), makeCell(maxPrice, { numFmt: '$#,##0.00' })],
    [makeCell('Average Confidence', { bold: true, bgColor: 'F5F5F5' }), makeCell(`${avgConfidence}%`)],
  ];

  // Sheet 2: Listings (all filtered records)
  const listingsHeaders = [
    makeHeader('Brand'),
    makeHeader('Reference'),
    makeHeader('Dial'),
    makeHeader('Condition'),
    makeHeader('Year'),
    makeHeader('Price'),
    makeHeader('Currency'),
    makeHeader('Price USD'),
    makeHeader('Confidence'),
    makeHeader('Verdict'),
    makeHeader('Description'),
  ];

  const listingsRows = records.map(record => {
    const vc = getVerdictColor(record.verdict);
    const cfColor = getConfidenceFontColor(record.confidence ?? 0);
    const priceUsd = record.price_usd ?? record.price_raw ?? 0;

    return [
      makeCell(record.brand || '', { bgColor: vc.bg, fontColor: vc.font }),
      makeCell(record.reference || '', { bgColor: vc.bg, fontColor: vc.font }),
      makeCell(record.dial_color || '', { bgColor: vc.bg, fontColor: vc.font }),
      makeCell(record.condition || '', { bgColor: vc.bg, fontColor: vc.font }),
      makeCell(record.year ?? '', { bgColor: vc.bg, fontColor: vc.font, align: 'center' }),
      makeCell(record.price_raw ?? '', { bgColor: vc.bg, fontColor: vc.font, numFmt: '#,##0', align: 'right' }),
      makeCell(record.currency || 'USD', { bgColor: vc.bg, fontColor: vc.font, align: 'center' }),
      makeCell(priceUsd, { bgColor: vc.bg, fontColor: vc.font, numFmt: '$#,##0', align: 'right' }),
      makeCell(`${record.confidence ?? 0}%`, { bgColor: vc.bg, fontColor: cfColor, align: 'center', bold: true }),
      makeCell(record.verdict || '', { bgColor: vc.bg, fontColor: vc.font, bold: true, align: 'center' }),
      makeCell(record.raw_message || '', { bgColor: vc.bg, fontColor: vc.font }),
    ];
  });

  // Sheet 3: Brand Summary
  const brandMap = new Map();
  records.forEach(r => {
    const brand = r.brand || 'Unknown';
    if (!brandMap.has(brand)) {
      brandMap.set(brand, { count: 0, prices: [], confidences: [], approved: 0 });
    }
    const b = brandMap.get(brand);
    b.count++;
    if ((r.price_usd ?? r.price_raw ?? 0) > 0) b.prices.push(r.price_usd ?? r.price_raw ?? 0);
    if ((r.confidence ?? 0) > 0) b.confidences.push(r.confidence);
    if (r.verdict === 'APPROVED') b.approved++;
  });

  const brandSummaries = Array.from(brandMap.entries())
    .map(([brand, d]) => ({
      brand,
      count: d.count,
      avgPrice: avg(d.prices),
      avgConfidence: avg(d.confidences),
      approvalRate: d.count > 0 ? Math.round((d.approved / d.count) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const brandData = [
    [makeHeader('Brand'), makeHeader('Count'), makeHeader('Avg Price (USD)'), makeHeader('Avg Confidence'), makeHeader('Approval Rate')],
    ...brandSummaries.map(b => [
      makeCell(b.brand),
      makeCell(b.count, { align: 'center' }),
      makeCell(b.avgPrice, { numFmt: '$#,##0.00', align: 'right' }),
      makeCell(`${b.avgConfidence}%`, { align: 'center', fontColor: getConfidenceFontColor(b.avgConfidence) }),
      makeCell(`${b.approvalRate}%`, { align: 'center' }),
    ]),
  ];

  // Sheet 4: Verdict Distribution
  const verdictData = [
    [makeHeader('Verdict'), makeHeader('Count'), makeHeader('% of Total')],
    ['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'].map(v => {
      const count = records.filter(r => r.verdict === v).length;
      const pct = total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
      const vc = getVerdictColor(v);
      return [
        makeCell(v, { bgColor: vc.bg, fontColor: vc.font, bold: true }),
        makeCell(count, { align: 'center', bgColor: vc.bg, fontColor: vc.font }),
        makeCell(`${pct}%`, { align: 'center', bgColor: vc.bg, fontColor: vc.font }),
      ];
    }).flat(),
  ];

  // Assemble workbook
  const wb = XLSX.utils.book_new();

  const wsSummary  = XLSX.utils.aoa_to_sheet(summaryData);
  const wsListings = XLSX.utils.aoa_to_sheet([listingsHeaders, ...listingsRows]);
  const wsBrand    = XLSX.utils.aoa_to_sheet(brandData);
  const wsVerdict  = XLSX.utils.aoa_to_sheet(verdictData);

  wsSummary['!cols']  = [{ wch: 25 }, { wch: 30 }];
  wsListings['!cols'] = [
    { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 50 },
  ];
  wsBrand['!cols']   = [{ wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
  wsVerdict['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }];

  XLSX.utils.book_append_sheet(wb, wsSummary,  'Summary');
  XLSX.utils.book_append_sheet(wb, wsListings, 'Listings');
  XLSX.utils.book_append_sheet(wb, wsBrand,    'Brand Summary');
  XLSX.utils.book_append_sheet(wb, wsVerdict,  'Verdict Distribution');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const filters = req.body?.filters || {};

    // Build and execute query
    const query = buildQuery(filters);
    const recordsRes = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: HEADERS,
    });

    if (!recordsRes.ok) {
      const err = await recordsRes.text();
      throw new Error(`Supabase query failed: ${recordsRes.status} ${err}`);
    }

    const records = await recordsRes.json();

    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'No records match the given filters' });
    }

    // Generate Excel
    const excelBuffer = buildWorkbook(records);

    // Generate filename based on filters
    const parts = ['watchfacts'];
    if (filters.brand) parts.push(filters.brand.toLowerCase().replace(/\s+/g, '-'));
    if (filters.verdict) parts.push(filters.verdict.toLowerCase());
    parts.push('export');
    const outFilename = `${parts.join('-')}.xlsx`;

    // Return as file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${outFilename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.status(200).send(excelBuffer);

  } catch (err) {
    console.error('[export-excel] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
