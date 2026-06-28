/**
 * reportExport.ts — Client-Side Report Export System for WatchFacts
 *
 * Provides:
 *   - exportToExcel(): Multi-sheet colored Excel workbook (xlsx-js-style)
 *   - exportToJSON(): JSON file download
 *   - exportToCSV(): CSV export with BOM for Excel compatibility
 *   - generateReportCache(): Aggregates records into ReportCache for dashboard charts
 */

import * as XLSX from 'xlsx';
import * as XLSXStyle from 'xlsx-js-style';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Verdict = 'APPROVED' | 'REVIEW' | 'HUMAN' | 'RECYCLE';

export interface WatchRecord {
  id?: string;
  brand: string;
  reference: string;
  dial_color?: string;
  condition?: string;
  year?: number | null;
  price_raw?: number | null;
  price_usd?: number | null;
  currency?: string;
  confidence?: number;
  verdict?: Verdict;
  source?: string;
  raw_message?: string;
  description?: string;
  created_at?: string;
  processed_at?: string;
  reprocessed_at?: string;
}

export interface ReportCache {
  generatedAt: string;
  totalRecords: number;
  verdictCounts: Record<Verdict, number>;
  avgConfidence: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  brandSummary: BrandSummary[];
  confidenceBins: ConfidenceBin[];
  verdictDistribution: VerdictDistribution[];
  topReferences: TopReference[];
  dailyTrends: DailyTrend[];
  conditionDistribution: ConditionDistribution[];
  priceBins: PriceBin[];
}

export interface BrandSummary {
  brand: string;
  count: number;
  avgPrice: number;
  avgConfidence: number;
  approvalRate: number;
}

export interface ConfidenceBin {
  range: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface VerdictDistribution {
  verdict: Verdict;
  count: number;
  percentage: number;
}

export interface TopReference {
  reference: string;
  brand: string;
  count: number;
  avgPrice: number;
  avgConfidence: number;
}

export interface DailyTrend {
  date: string;
  count: number;
  avgConfidence: number;
  avgPrice: number;
}

export interface ConditionDistribution {
  condition: string;
  count: number;
  percentage: number;
}

export interface PriceBin {
  range: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
}

// ─── Color Constants ──────────────────────────────────────────────────────────

const COLORS = {
  approved: { bg: 'C6EFCE', font: '006100' },
  review:   { bg: 'BDD7EE', font: '1F4E79' },
  human:    { bg: 'FFEB9C', font: '9C5700' },
  recycle:  { bg: 'FFC7CE', font: '9C0006' },
  header:   { bg: 'C9A96E', font: '000000' },
  gold:     'FFC000',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVerdictColor(verdict?: Verdict | string): { bg: string; font: string } {
  switch (verdict) {
    case 'APPROVED': return COLORS.approved;
    case 'REVIEW':   return COLORS.review;
    case 'HUMAN':    return COLORS.human;
    case 'RECYCLE':  return COLORS.recycle;
    default:         return { bg: 'FFFFFF', font: '000000' };
  }
}

function getConfidenceFontColor(confidence: number): string {
  if (confidence >= 85) return '006100';
  if (confidence >= 70) return '9C5700';
  if (confidence >= 50) return 'ED7D31';
  return '9C0006';
}

function makeCell(value: string | number, options: {
  bold?: boolean;
  bgColor?: string;
  fontColor?: string;
  align?: 'left' | 'center' | 'right';
  numFmt?: string;
} = {}): any {
  const { bold = false, bgColor = 'FFFFFF', fontColor = '000000', align = 'left', numFmt } = options;
  return {
    v: value,
    t: typeof value === 'number' ? 'n' : 's',
    s: {
      font: { bold, color: { rgb: fontColor }, name: 'Calibri', sz: 11 },
      fill: { fgColor: { rgb: bgColor }, patternType: 'solid' as const },
      alignment: { horizontal: align, vertical: 'center' as const },
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

function makeHeader(value: string): any {
  return makeCell(value, { bold: true, bgColor: COLORS.header.bg, fontColor: COLORS.header.font, align: 'center' });
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function downloadBlob(data: BlobPart, mime: string, filename: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

export function exportToExcel(records: WatchRecord[], filename: string = 'watchfacts-report'): void {
  if (!records || records.length === 0) {
    throw new Error('No records to export');
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timestamp = now.toISOString();

  // ── Summary stats ──────────────────────────────────────────────────────────
  const total = records.length;
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

  // ── Sheet 1: Summary ───────────────────────────────────────────────────────
  const summaryData = [
    [makeHeader('WatchFacts Report Summary')],
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

  // ── Sheet 2: Listings ──────────────────────────────────────────────────────
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
    const priceUsd = record.price_usd ?? (record.price_raw && record.currency ? record.price_raw : 0);

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
      makeCell(record.raw_message || record.description || '', { bgColor: vc.bg, fontColor: vc.font }),
    ];
  });

  const listingsData = [listingsHeaders, ...listingsRows];

  // ── Sheet 3: Brand Summary ─────────────────────────────────────────────────
  const brandMap = new Map<string, { count: number; prices: number[]; confidences: number[]; approved: number }>();
  for (const r of records) {
    const brand = r.brand || 'Unknown';
    if (!brandMap.has(brand)) {
      brandMap.set(brand, { count: 0, prices: [], confidences: [], approved: 0 });
    }
    const entry = brandMap.get(brand)!;
    entry.count++;
    if (r.price_usd ?? r.price_raw) entry.prices.push(r.price_usd ?? r.price_raw ?? 0);
    if (r.confidence) entry.confidences.push(r.confidence);
    if (r.verdict === 'APPROVED') entry.approved++;
  }

  const brandSummaries = Array.from(brandMap.entries())
    .map(([brand, data]) => ({
      brand,
      count: data.count,
      avgPrice: avg(data.prices),
      avgConfidence: avg(data.confidences),
      approvalRate: Math.round((data.approved / data.count) * 10000) / 100,
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

  // ── Sheet 4: Confidence Analysis ───────────────────────────────────────────
  const confBins: ConfidenceBin[] = [
    { range: '90-100%', min: 90, max: 100, count: 0, percentage: 0 },
    { range: '85-89%',  min: 85, max: 89,  count: 0, percentage: 0 },
    { range: '70-84%',  min: 70, max: 84,  count: 0, percentage: 0 },
    { range: '50-69%',  min: 50, max: 69,  count: 0, percentage: 0 },
    { range: '<50%',    min: 0,  max: 49,  count: 0, percentage: 0 },
  ];

  for (const r of records) {
    const c = r.confidence ?? 0;
    if (c >= 90) confBins[0].count++;
    else if (c >= 85) confBins[1].count++;
    else if (c >= 70) confBins[2].count++;
    else if (c >= 50) confBins[3].count++;
    else confBins[4].count++;
  }

  confBins.forEach(b => {
    b.percentage = Math.round((b.count / total) * 10000) / 100;
  });

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

  // ── Sheet 5: Verdict Distribution ──────────────────────────────────────────
  const verdicts: Verdict[] = ['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'];
  const verdictData = [
    [makeHeader('Verdict'), makeHeader('Count'), makeHeader('% of Total')],
    ...verdicts.map(v => {
      const count = records.filter(r => r.verdict === v).length;
      const pct = Math.round((count / total) * 10000) / 100;
      const vc = getVerdictColor(v);
      return [
        makeCell(v, { bgColor: vc.bg, fontColor: vc.font, bold: true }),
        makeCell(count, { align: 'center', bgColor: vc.bg, fontColor: vc.font }),
        makeCell(`${pct}%`, { align: 'center', bgColor: vc.bg, fontColor: vc.font }),
      ];
    }),
  ];

  // ── Sheet 6: Top References ────────────────────────────────────────────────
  const refMap = new Map<string, { brand: string; count: number; prices: number[]; confidences: number[] }>();
  for (const r of records) {
    const key = r.reference || 'Unknown';
    if (!refMap.has(key)) {
      refMap.set(key, { brand: r.brand || '', count: 0, prices: [], confidences: [] });
    }
    const entry = refMap.get(key)!;
    entry.count++;
    if (r.price_usd ?? r.price_raw) entry.prices.push(r.price_usd ?? r.price_raw ?? 0);
    if (r.confidence) entry.confidences.push(r.confidence);
  }

  const topRefs = Array.from(refMap.entries())
    .map(([ref, data]) => ({
      reference: ref,
      brand: data.brand,
      count: data.count,
      avgPrice: avg(data.prices),
      avgConfidence: avg(data.confidences),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const refData = [
    [makeHeader('Reference'), makeHeader('Brand'), makeHeader('Mentions'), makeHeader('Avg Price (USD)'), makeHeader('Avg Confidence')],
    ...topRefs.map(r => [
      makeCell(r.reference),
      makeCell(r.brand),
      makeCell(r.count, { align: 'center' }),
      makeCell(r.avgPrice, { numFmt: '$#,##0.00', align: 'right' }),
      makeCell(`${r.avgConfidence}%`, { align: 'center', fontColor: getConfidenceFontColor(r.avgConfidence) }),
    ]),
  ];

  // ── Build workbook ─────────────────────────────────────────────────────────
  const wb = XLSXStyle.utils.book_new();

  const wsSummary  = XLSXStyle.utils.aoa_to_sheet(summaryData);
  const wsListings = XLSXStyle.utils.aoa_to_sheet(listingsData);
  const wsBrand    = XLSXStyle.utils.aoa_to_sheet(brandData);
  const wsConf     = XLSXStyle.utils.aoa_to_sheet(confData);
  const wsVerdict  = XLSXStyle.utils.aoa_to_sheet(verdictData);
  const wsRef      = XLSXStyle.utils.aoa_to_sheet(refData);

  // Column widths
  wsSummary['!cols'] = [{ wch: 25 }, { wch: 30 }];
  wsListings['!cols'] = [
    { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 50 },
  ];
  wsBrand['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
  wsConf['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }];
  wsVerdict['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }];
  wsRef['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];

  XLSXStyle.utils.book_append_sheet(wb, wsSummary, 'Summary');
  XLSXStyle.utils.book_append_sheet(wb, wsListings, 'Listings');
  XLSXStyle.utils.book_append_sheet(wb, wsBrand, 'Brand Summary');
  XLSXStyle.utils.book_append_sheet(wb, wsConf, 'Confidence Analysis');
  XLSXStyle.utils.book_append_sheet(wb, wsVerdict, 'Verdict Distribution');
  XLSXStyle.utils.book_append_sheet(wb, wsRef, 'Top References');

  const outFile = `${filename}.xlsx`;
  XLSXStyle.writeFile(wb, outFile);
}

// ─── JSON Export ──────────────────────────────────────────────────────────────

export function exportToJSON(records: WatchRecord[], filename: string = 'watchfacts-report'): void {
  if (!records || records.length === 0) {
    throw new Error('No records to export');
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    records,
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  downloadBlob(jsonStr, 'application/json', `${filename}.json`);
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export function exportToCSV(records: WatchRecord[], filename: string = 'watchfacts-report'): void {
  if (!records || records.length === 0) {
    throw new Error('No records to export');
  }

  const headers = ['Brand', 'Reference', 'Dial', 'Condition', 'Year', 'Price', 'Currency', 'Price USD', 'Confidence', 'Verdict', 'Description'];

  const escapeCSV = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = records.map(r => [
    escapeCSV(r.brand),
    escapeCSV(r.reference),
    escapeCSV(r.dial_color),
    escapeCSV(r.condition),
    escapeCSV(r.year),
    escapeCSV(r.price_raw),
    escapeCSV(r.currency || 'USD'),
    escapeCSV(r.price_usd),
    escapeCSV(r.confidence),
    escapeCSV(r.verdict),
    escapeCSV(r.raw_message || r.description),
  ].join(','));

  const bom = '\uFEFF';
  const csv = bom + [headers.join(','), ...rows].join('\n');

  downloadBlob(csv, 'text/csv;charset=utf-8', `${filename}.csv`);
}

// ─── Report Cache Generator ───────────────────────────────────────────────────

export function generateReportCache(records: WatchRecord[]): ReportCache {
  if (!records || records.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalRecords: 0,
      verdictCounts: { APPROVED: 0, REVIEW: 0, HUMAN: 0, RECYCLE: 0 },
      avgConfidence: 0,
      avgPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      brandSummary: [],
      confidenceBins: [],
      verdictDistribution: [],
      topReferences: [],
      dailyTrends: [],
      conditionDistribution: [],
      priceBins: [],
    };
  }

  const total = records.length;

  // Verdict counts
  const verdictCounts: Record<Verdict, number> = {
    APPROVED: records.filter(r => r.verdict === 'APPROVED').length,
    REVIEW:   records.filter(r => r.verdict === 'REVIEW').length,
    HUMAN:    records.filter(r => r.verdict === 'HUMAN').length,
    RECYCLE:  records.filter(r => r.verdict === 'RECYCLE').length,
  };

  // Prices
  const prices = records.map(r => r.price_usd ?? r.price_raw ?? 0).filter(p => p > 0);
  const avgPrice = avg(prices);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  // Confidence
  const confidences = records.map(r => r.confidence ?? 0).filter(c => c > 0);
  const avgConfidence = avg(confidences);

  // Brand summary
  const brandMap = new Map<string, { count: number; prices: number[]; confidences: number[]; approved: number }>();
  for (const r of records) {
    const brand = r.brand || 'Unknown';
    if (!brandMap.has(brand)) {
      brandMap.set(brand, { count: 0, prices: [], confidences: [], approved: 0 });
    }
    const b = brandMap.get(brand)!;
    b.count++;
    if ((r.price_usd ?? r.price_raw ?? 0) > 0) b.prices.push(r.price_usd ?? r.price_raw ?? 0);
    if ((r.confidence ?? 0) > 0) b.confidences.push(r.confidence!);
    if (r.verdict === 'APPROVED') b.approved++;
  }

  const brandSummary: BrandSummary[] = Array.from(brandMap.entries())
    .map(([brand, d]) => ({
      brand,
      count: d.count,
      avgPrice: avg(d.prices),
      avgConfidence: avg(d.confidences),
      approvalRate: Math.round((d.approved / d.count) * 10000) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Confidence bins
  const confidenceBins: ConfidenceBin[] = [
    { range: '90-100%', min: 90, max: 100, count: 0, percentage: 0 },
    { range: '85-89%',  min: 85, max: 89,  count: 0, percentage: 0 },
    { range: '70-84%',  min: 70, max: 84,  count: 0, percentage: 0 },
    { range: '50-69%',  min: 50, max: 69,  count: 0, percentage: 0 },
    { range: '<50%',    min: 0,  max: 49,  count: 0, percentage: 0 },
  ];

  for (const r of records) {
    const c = r.confidence ?? 0;
    if (c >= 90) confidenceBins[0].count++;
    else if (c >= 85) confidenceBins[1].count++;
    else if (c >= 70) confidenceBins[2].count++;
    else if (c >= 50) confidenceBins[3].count++;
    else confidenceBins[4].count++;
  }

  confidenceBins.forEach(b => {
    b.percentage = Math.round((b.count / total) * 10000) / 100;
  });

  // Verdict distribution
  const verdictDistribution: VerdictDistribution[] = (['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'] as Verdict[])
    .map(v => ({
      verdict: v,
      count: verdictCounts[v],
      percentage: Math.round((verdictCounts[v] / total) * 10000) / 100,
    }));

  // Top references
  const refMap = new Map<string, { brand: string; count: number; prices: number[]; confidences: number[] }>();
  for (const r of records) {
    const key = r.reference || 'Unknown';
    if (!refMap.has(key)) {
      refMap.set(key, { brand: r.brand || '', count: 0, prices: [], confidences: [] });
    }
    const ref = refMap.get(key)!;
    ref.count++;
    if ((r.price_usd ?? r.price_raw ?? 0) > 0) ref.prices.push(r.price_usd ?? r.price_raw ?? 0);
    if ((r.confidence ?? 0) > 0) ref.confidences.push(r.confidence!);
  }

  const topReferences: TopReference[] = Array.from(refMap.entries())
    .map(([reference, d]) => ({
      reference,
      brand: d.brand,
      count: d.count,
      avgPrice: avg(d.prices),
      avgConfidence: avg(d.confidences),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  // Daily trends (last 30 days)
  const dateMap = new Map<string, { count: number; confidences: number[]; prices: number[] }>();
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateMap.set(key, { count: 0, confidences: [], prices: [] });
  }

  for (const r of records) {
    const dateKey = (r.created_at || r.processed_at || '').slice(0, 10);
    if (dateKey && dateMap.has(dateKey)) {
      const entry = dateMap.get(dateKey)!;
      entry.count++;
      if ((r.confidence ?? 0) > 0) entry.confidences.push(r.confidence!);
      if ((r.price_usd ?? r.price_raw ?? 0) > 0) entry.prices.push(r.price_usd ?? r.price_raw ?? 0);
    }
  }

  const dailyTrends: DailyTrend[] = Array.from(dateMap.entries())
    .map(([date, d]) => ({
      date,
      count: d.count,
      avgConfidence: avg(d.confidences),
      avgPrice: avg(d.prices),
    }));

  // Condition distribution
  const condMap = new Map<string, number>();
  for (const r of records) {
    const cond = r.condition || 'Unknown';
    condMap.set(cond, (condMap.get(cond) || 0) + 1);
  }

  const conditionDistribution: ConditionDistribution[] = Array.from(condMap.entries())
    .map(([condition, count]) => ({
      condition,
      count,
      percentage: Math.round((count / total) * 10000) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Price bins
  const priceRanges = [
    { range: '< $1K',    min: 0,      max: 999 },
    { range: '$1K-5K',   min: 1000,   max: 4999 },
    { range: '$5K-10K',  min: 5000,   max: 9999 },
    { range: '$10K-20K', min: 10000,  max: 19999 },
    { range: '$20K-50K', min: 20000,  max: 49999 },
    { range: '$50K-100K',min: 50000,  max: 99999 },
    { range: '$100K+',   min: 100000, max: Infinity },
  ];

  const priceBins: PriceBin[] = priceRanges.map(pr => ({
    ...pr,
    count: 0,
    percentage: 0,
  }));

  for (const r of records) {
    const p = r.price_usd ?? r.price_raw ?? 0;
    if (p <= 0) continue;
    const bin = priceBins.find(b => p >= b.min && p <= b.max);
    if (bin) bin.count++;
  }

  priceBins.forEach(b => {
    b.percentage = Math.round((b.count / total) * 10000) / 100;
  });

  return {
    generatedAt: new Date().toISOString(),
    totalRecords: total,
    verdictCounts,
    avgConfidence,
    avgPrice,
    minPrice,
    maxPrice,
    brandSummary,
    confidenceBins,
    verdictDistribution,
    topReferences,
    dailyTrends,
    conditionDistribution,
    priceBins,
  };
}
