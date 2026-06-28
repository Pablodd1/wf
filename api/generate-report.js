/**
 * /api/generate-report.js
 *
 * Vercel serverless function that generates the master report.
 * POST /api/generate-report
 *
 * 1. Queries Supabase for aggregated statistics
 * 2. Generates the ReportCache JSON
 * 3. Saves to public/reports/master-report.json
 * 4. Generates public/reports/watchfacts-report.xlsx
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars
 */

'use strict';

const XLSX = require('xlsx-js-style');
const fs = require('fs');
const path = require('path');

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

// ─── Supabase Query Helpers ───────────────────────────────────────────────────

async function querySupabase(endpoint) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase query failed: ${res.status} ${err}`);
  }
  return res.json();
}

// ─── Report Generation ────────────────────────────────────────────────────────

async function generateReport() {
  const now = new Date();
  const dateStr = now.toISOString();

  // 1. Total count
  const countRes = await querySupabase('watch_records?select=count');
  const totalRecords = parseInt(countRes[0]?.count || '0', 10);

  // 2. Verdict counts
  const verdictRes = await querySupabase('watch_records?select=verdict&verdict=not.is.null');
  const verdictCounts = { APPROVED: 0, REVIEW: 0, HUMAN: 0, RECYCLE: 0 };
  verdictRes.forEach(r => {
    if (r.verdict && verdictCounts[r.verdict] !== undefined) {
      verdictCounts[r.verdict]++;
    }
  });

  // 3. Price stats
  const priceRes = await querySupabase('watch_records?select=price_usd&price_usd=not.is.null&price_usd=gt.0');
  const prices = priceRes.map(r => r.price_usd).filter(p => p > 0);
  const avgPrice = avg(prices);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  // 4. Confidence stats
  const confRes = await querySupabase('watch_records?select=confidence&confidence=not.is.null&confidence=gt.0');
  const confidences = confRes.map(r => r.confidence).filter(c => c > 0);
  const avgConfidence = avg(confidences);

  // 5. Brand distribution
  const brandRes = await querySupabase('watch_records?select=brand,price_usd,confidence,verdict&brand=not.is.null');
  const brandMap = new Map();
  brandRes.forEach(r => {
    const brand = r.brand || 'Unknown';
    if (!brandMap.has(brand)) {
      brandMap.set(brand, { count: 0, prices: [], confidences: [], approved: 0 });
    }
    const b = brandMap.get(brand);
    b.count++;
    if (r.price_usd > 0) b.prices.push(r.price_usd);
    if (r.confidence > 0) b.confidences.push(r.confidence);
    if (r.verdict === 'APPROVED') b.approved++;
  });

  const brandSummary = Array.from(brandMap.entries())
    .map(([brand, d]) => ({
      brand,
      count: d.count,
      avgPrice: avg(d.prices),
      avgConfidence: avg(d.confidences),
      approvalRate: d.count > 0 ? Math.round((d.approved / d.count) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // 6. Confidence bins
  const confBins = [
    { range: '90-100%', min: 90, max: 100, count: 0, percentage: 0 },
    { range: '85-89%',  min: 85, max: 89,  count: 0, percentage: 0 },
    { range: '70-84%',  min: 70, max: 84,  count: 0, percentage: 0 },
    { range: '50-69%',  min: 50, max: 69,  count: 0, percentage: 0 },
    { range: '<50%',    min: 0,  max: 49,  count: 0, percentage: 0 },
  ];

  confidences.forEach(c => {
    if (c >= 90) confBins[0].count++;
    else if (c >= 85) confBins[1].count++;
    else if (c >= 70) confBins[2].count++;
    else if (c >= 50) confBins[3].count++;
    else confBins[4].count++;
  });

  confBins.forEach(b => {
    b.percentage = totalRecords > 0 ? Math.round((b.count / totalRecords) * 10000) / 100 : 0;
  });

  // 7. Verdict distribution
  const verdictDistribution = Object.entries(verdictCounts)
    .map(([verdict, count]) => ({
      verdict,
      count,
      percentage: totalRecords > 0 ? Math.round((count / totalRecords) * 10000) / 100 : 0,
    }));

  // 8. Top references
  const refRes = await querySupabase('watch_records?select=reference,brand,price_usd,confidence&reference=not.is.null');
  const refMap = new Map();
  refRes.forEach(r => {
    const key = r.reference || 'Unknown';
    if (!refMap.has(key)) {
      refMap.set(key, { brand: r.brand || '', count: 0, prices: [], confidences: [] });
    }
    const ref = refMap.get(key);
    ref.count++;
    if (r.price_usd > 0) ref.prices.push(r.price_usd);
    if (r.confidence > 0) ref.confidences.push(r.confidence);
  });

  const topReferences = Array.from(refMap.entries())
    .map(([reference, d]) => ({
      reference,
      brand: d.brand,
      count: d.count,
      avgPrice: avg(d.prices),
      avgConfidence: avg(d.confidences),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  // 9. Daily trends (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateFilter = thirtyDaysAgo.toISOString();
  const trendRes = await querySupabase(
    `watch_records?select=created_at,confidence,price_usd&created_at=gte.${encodeURIComponent(dateFilter)}`
  );

  const dateMap = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dateMap.set(d.toISOString().slice(0, 10), { count: 0, confidences: [], prices: [] });
  }

  trendRes.forEach(r => {
    const dateKey = (r.created_at || '').slice(0, 10);
    if (dateKey && dateMap.has(dateKey)) {
      const entry = dateMap.get(dateKey);
      entry.count++;
      if (r.confidence > 0) entry.confidences.push(r.confidence);
      if (r.price_usd > 0) entry.prices.push(r.price_usd);
    }
  });

  const dailyTrends = Array.from(dateMap.entries())
    .map(([date, d]) => ({
      date,
      count: d.count,
      avgConfidence: avg(d.confidences),
      avgPrice: avg(d.prices),
    }));

  // 10. Condition distribution
  const condRes = await querySupabase('watch_records?select=condition');
  const condMap = new Map();
  condRes.forEach(r => {
    const cond = r.condition || 'Unknown';
    condMap.set(cond, (condMap.get(cond) || 0) + 1);
  });

  const conditionDistribution = Array.from(condMap.entries())
    .map(([condition, count]) => ({
      condition,
      count,
      percentage: totalRecords > 0 ? Math.round((count / totalRecords) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // 11. Price bins
  const priceBins = [
    { range: '< $1K',     min: 0,      max: 999,     count: 0, percentage: 0 },
    { range: '$1K-5K',    min: 1000,   max: 4999,    count: 0, percentage: 0 },
    { range: '$5K-10K',   min: 5000,   max: 9999,    count: 0, percentage: 0 },
    { range: '$10K-20K',  min: 10000,  max: 19999,   count: 0, percentage: 0 },
    { range: '$20K-50K',  min: 20000,  max: 49999,   count: 0, percentage: 0 },
    { range: '$50K-100K', min: 50000,  max: 99999,   count: 0, percentage: 0 },
    { range: '$100K+',    min: 100000, max: Infinity, count: 0, percentage: 0 },
  ];

  prices.forEach(p => {
    const bin = priceBins.find(b => p >= b.min && p <= b.max);
    if (bin) bin.count++;
  });

  priceBins.forEach(b => {
    b.percentage = totalRecords > 0 ? Math.round((b.count / totalRecords) * 10000) / 100 : 0;
  });

  // ─── Build ReportCache ──────────────────────────────────────────────────────

  const reportCache = {
    generatedAt: dateStr,
    totalRecords,
    verdictCounts,
    avgConfidence,
    avgPrice,
    minPrice,
    maxPrice,
    brandSummary,
    confidenceBins: confBins,
    verdictDistribution,
    topReferences,
    dailyTrends,
    conditionDistribution,
    priceBins,
  };

  // ─── Build Excel ────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    [makeHeader('WatchFacts Master Report Summary')],
    [],
    [makeCell('Generated', { bold: true, bgColor: 'F5F5F5' }), makeCell(dateStr)],
    [makeCell('Total Records', { bold: true, bgColor: 'F5F5F5' }), makeCell(totalRecords)],
    [makeCell('APPROVED', { bold: true, bgColor: COLORS.approved.bg, fontColor: COLORS.approved.font }), makeCell(verdictCounts.APPROVED, { fontColor: COLORS.approved.font })],
    [makeCell('REVIEW', { bold: true, bgColor: COLORS.review.bg, fontColor: COLORS.review.font }), makeCell(verdictCounts.REVIEW, { fontColor: COLORS.review.font })],
    [makeCell('HUMAN', { bold: true, bgColor: COLORS.human.bg, fontColor: COLORS.human.font }), makeCell(verdictCounts.HUMAN, { fontColor: COLORS.human.font })],
    [makeCell('RECYCLE', { bold: true, bgColor: COLORS.recycle.bg, fontColor: COLORS.recycle.font }), makeCell(verdictCounts.RECYCLE, { fontColor: COLORS.recycle.font })],
    [],
    [makeHeader('Price Statistics')],
    [makeCell('Average Price (USD)', { bold: true, bgColor: 'F5F5F5' }), makeCell(avgPrice, { numFmt: '$#,##0.00' })],
    [makeCell('Min Price (USD)', { bold: true, bgColor: 'F5F5F5' }), makeCell(minPrice, { numFmt: '$#,##0.00' })],
    [makeCell('Max Price (USD)', { bold: true, bgColor: 'F5F5F5' }), makeCell(maxPrice, { numFmt: '$#,##0.00' })],
    [makeCell('Average Confidence', { bold: true, bgColor: 'F5F5F5' }), makeCell(`${avgConfidence}%`)],
  ];

  // Sheet 2: Brand Summary
  const brandData = [
    [makeHeader('Brand'), makeHeader('Count'), makeHeader('Avg Price (USD)'), makeHeader('Avg Confidence'), makeHeader('Approval Rate')],
    ...brandSummary.map(b => [
      makeCell(b.brand),
      makeCell(b.count, { align: 'center' }),
      makeCell(b.avgPrice, { numFmt: '$#,##0.00', align: 'right' }),
      makeCell(`${b.avgConfidence}%`, { align: 'center', fontColor: getConfidenceFontColor(b.avgConfidence) }),
      makeCell(`${b.approvalRate}%`, { align: 'center' }),
    ]),
  ];

  // Sheet 3: Confidence Analysis
  const confData = [
    [makeHeader('Confidence Range'), makeHeader('Count'), makeHeader('% of Total')],
    ...confBins.map(b => {
      const fontColor = b.min >= 85 ? '006100' : b.min >= 70 ? '9C5700' : b.min >= 50 ? 'ED7D31' : '9C0006';
      return [
        makeCell(b.range, { fontColor, bold: true }),
        makeCell(b.count, { align: 'center' }),
        makeCell(`${b.percentage}%`, { align: 'center', fontColor }),
      ];
    }),
  ];

  // Sheet 4: Verdict Distribution
  const verdictData = [
    [makeHeader('Verdict'), makeHeader('Count'), makeHeader('% of Total')],
    ...verdictDistribution.map(vd => {
      const vc = getVerdictColor(vd.verdict);
      return [
        makeCell(vd.verdict, { bgColor: vc.bg, fontColor: vc.font, bold: true }),
        makeCell(vd.count, { align: 'center', bgColor: vc.bg, fontColor: vc.font }),
        makeCell(`${vd.percentage}%`, { align: 'center', bgColor: vc.bg, fontColor: vc.font }),
      ];
    }),
  ];

  // Sheet 5: Top References
  const refData = [
    [makeHeader('Reference'), makeHeader('Brand'), makeHeader('Mentions'), makeHeader('Avg Price (USD)'), makeHeader('Avg Confidence')],
    ...topReferences.map(r => [
      makeCell(r.reference),
      makeCell(r.brand),
      makeCell(r.count, { align: 'center' }),
      makeCell(r.avgPrice, { numFmt: '$#,##0.00', align: 'right' }),
      makeCell(`${r.avgConfidence}%`, { align: 'center', fontColor: getConfidenceFontColor(r.avgConfidence) }),
    ]),
  ];

  // Sheet 6: Daily Trends
  const trendData = [
    [makeHeader('Date'), makeHeader('Count'), makeHeader('Avg Confidence'), makeHeader('Avg Price (USD)')],
    ...dailyTrends.map(t => [
      makeCell(t.date),
      makeCell(t.count, { align: 'center' }),
      makeCell(`${t.avgConfidence}%`, { align: 'center', fontColor: getConfidenceFontColor(t.avgConfidence) }),
      makeCell(t.avgPrice, { numFmt: '$#,##0.00', align: 'right' }),
    ]),
  ];

  // Sheet 7: Condition Distribution
  const conditionData = [
    [makeHeader('Condition'), makeHeader('Count'), makeHeader('% of Total')],
    ...conditionDistribution.map(c => [
      makeCell(c.condition),
      makeCell(c.count, { align: 'center' }),
      makeCell(`${c.percentage}%`, { align: 'center' }),
    ]),
  ];

  // Sheet 8: Price Distribution
  const priceDistData = [
    [makeHeader('Price Range'), makeHeader('Count'), makeHeader('% of Total')],
    ...priceBins.map(p => [
      makeCell(p.range),
      makeCell(p.count, { align: 'center' }),
      makeCell(`${p.percentage}%`, { align: 'center' }),
    ]),
  ];

  // Assemble workbook
  const wsSummary   = XLSX.utils.aoa_to_sheet(summaryData);
  const wsBrand     = XLSX.utils.aoa_to_sheet(brandData);
  const wsConf      = XLSX.utils.aoa_to_sheet(confData);
  const wsVerdict   = XLSX.utils.aoa_to_sheet(verdictData);
  const wsRef       = XLSX.utils.aoa_to_sheet(refData);
  const wsTrend     = XLSX.utils.aoa_to_sheet(trendData);
  const wsCondition = XLSX.utils.aoa_to_sheet(conditionData);
  const wsPrice     = XLSX.utils.aoa_to_sheet(priceDistData);

  wsSummary['!cols']   = [{ wch: 25 }, { wch: 30 }];
  wsBrand['!cols']     = [{ wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
  wsConf['!cols']      = [{ wch: 18 }, { wch: 10 }, { wch: 12 }];
  wsVerdict['!cols']   = [{ wch: 14 }, { wch: 10 }, { wch: 12 }];
  wsRef['!cols']       = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
  wsTrend['!cols']     = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
  wsCondition['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 12 }];
  wsPrice['!cols']     = [{ wch: 16 }, { wch: 10 }, { wch: 12 }];

  XLSX.utils.book_append_sheet(wb, wsSummary,   'Summary');
  XLSX.utils.book_append_sheet(wb, wsBrand,     'Brand Summary');
  XLSX.utils.book_append_sheet(wb, wsConf,      'Confidence Analysis');
  XLSX.utils.book_append_sheet(wb, wsVerdict,   'Verdict Distribution');
  XLSX.utils.book_append_sheet(wb, wsRef,       'Top References');
  XLSX.utils.book_append_sheet(wb, wsTrend,     'Daily Trends');
  XLSX.utils.book_append_sheet(wb, wsCondition, 'Condition Distribution');
  XLSX.utils.book_append_sheet(wb, wsPrice,     'Price Distribution');

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return { reportCache, excelBuffer };
}

// ─── File System Helpers ──────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
    const { reportCache, excelBuffer } = await generateReport();

    // Save JSON report
    const reportsDir = path.join(process.cwd(), 'public', 'reports');
    ensureDir(reportsDir);

    const jsonPath = path.join(reportsDir, 'master-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(reportCache, null, 2));

    // Save Excel report
    const excelPath = path.join(reportsDir, 'watchfacts-report.xlsx');
    fs.writeFileSync(excelPath, excelBuffer);

    const filesCreated = [
      'public/reports/master-report.json',
      'public/reports/watchfacts-report.xlsx',
    ];

    return res.status(200).json({
      success: true,
      recordsProcessed: reportCache.totalRecords,
      filesCreated,
      generatedAt: reportCache.generatedAt,
    });

  } catch (err) {
    console.error('[generate-report] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
