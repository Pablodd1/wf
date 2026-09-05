/**
 * Export Clean Analysis results as a branded Excel report.
 * Matches the exact format of the full WatchFacts dataset report:
 * Columns: ID, Brand, Reference, Dial, Price, USD, Currency, Condition, Year, Confidence, Status, Raw Message
 * Colors: Navy headers, Light green = Complete/Approved, Orange = Review/Human, Yellow = Minor
 */

import type { CleanWatch, Verdict } from './cleanAnalyze';

// WatchFacts brand colors (matching the dataset report)
const COLORS = {
  navy: { fg: { rgb: 'FFFFFFFF' }, bg: { rgb: 'FF1F4E78' } },
  lightGreen: { bg: { rgb: 'FF90EE90' } },      // Complete / Approved
  orange: { bg: { rgb: 'FFFFA500' } },          // Review / Human
  yellow: { bg: { rgb: 'FFFFFFE0' } },          // Minor
  red: { bg: { rgb: 'FFFF6B6B' } },             // Recycle
  white: { bg: { rgb: 'FFFFFFFF' } },
};

function statusFromVerdict(v: Verdict, missingCount: number): string {
  if (v === 'APPROVED') return 'Complete';
  if (v === 'RECYCLE') return 'Recycle';
  return missingCount <= 1 ? 'Minor' : 'Review';
}

function statusColor(status: string) {
  if (status === 'Complete') return COLORS.lightGreen;
  if (status === 'Recycle') return COLORS.red;
  if (status === 'Review') return COLORS.orange;
  return COLORS.yellow;
}

function cell(v: any, style?: any) {
  return { v, s: style || {} };
}

function headerCell(v: string) {
  return cell(v, {
    font: { bold: true, color: COLORS.navy.fg, sz: 11 },
    fill: { fgColor: COLORS.navy.bg, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

function dataCell(v: any, bg?: any, align?: string) {
  return cell(v, {
    font: { sz: 10, color: { rgb: 'FF000000' } },
    fill: bg ? { fgColor: bg, patternType: 'solid' } : undefined,
    alignment: { horizontal: align || 'left', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

function numCell(v: number | null, bg?: any) {
  return cell(v, {
    font: { sz: 10, color: { rgb: 'FF000000' } },
    fill: bg ? { fgColor: bg, patternType: 'solid' } : undefined,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0',
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

function pctCell(v: number, bg?: any) {
  return cell(v, {
    font: { sz: 10, color: { rgb: 'FF000000' } },
    fill: bg ? { fgColor: bg, patternType: 'solid' } : undefined,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '0"%"',
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

// Calculate missing fields count for status determination
function getMissingCount(w: CleanWatch): number {
  let missing = 0;
  if (w.parsed.brand === 'Unknown') missing++;
  if (!w.parsed.reference || w.parsed.reference === 'Unknown') missing++;
  if (!w.parsed.dialColor || w.parsed.dialColor === 'UNKNOWN') missing++;
  if (!w.parsed.price || w.parsed.price === 0) missing++;
  if (w.parsed.condition === 'Unknown') missing++;
  return missing;
}

export function exportCleanExcel(watches: CleanWatch[], summary: any) {
  const XLSX = (window as any).XLSX;
  if (!XLSX) {
    throw new Error('xlsx library not loaded');
  }

  const wb = XLSX.utils.book_new();

  // ════════════════════════ Sheet 1: All Records (matches dataset format) ════════════════════════
  const ws1Data: any[][] = [];

  // Title
  ws1Data.push([
    cell('CURATED LUXURY CLEAN ANALYSIS REPORT', {
      font: { bold: true, sz: 16, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws1Data.push([
    cell(`Generated: ${new Date().toLocaleString()} | Total Watches: ${watches.length} | Threshold: ${summary.threshold}%`, {
      font: { sz: 10, italic: true, color: { rgb: 'FF666666' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws1Data.push([]);

  // Summary metrics
  ws1Data.push([
    headerCell('SUMMARY'),
    headerCell('Approved'),
    headerCell('Human Review'),
    headerCell('Recycle'),
    headerCell('Total'),
  ]);
  ws1Data.push([
    dataCell('Count'),
    numCell(summary.approved, COLORS.lightGreen.bg),
    numCell(summary.human, COLORS.orange.bg),
    numCell(summary.recycle, COLORS.red.bg),
    numCell(summary.total),
  ]);
  ws1Data.push([
    dataCell('Percentage'),
    pctCell(Math.round((summary.approved / summary.total) * 100), COLORS.lightGreen.bg),
    pctCell(Math.round((summary.human / summary.total) * 100), COLORS.orange.bg),
    pctCell(Math.round((summary.recycle / summary.total) * 100), COLORS.red.bg),
    pctCell(100),
  ]);
  ws1Data.push([]);

  // Main data headers — EXACT match to dataset report format
  const mainHeaders = ['ID', 'Brand', 'Reference', 'Dial', 'Price', 'USD', 'Currency', 'Condition', 'Year', 'Confidence', 'Status', 'Raw Message'];
  ws1Data.push(mainHeaders.map(h => headerCell(h)));

  // Data rows — EXACT match to dataset format
  watches.forEach((w, i) => {
    const missingCount = getMissingCount(w);
    const status = statusFromVerdict(w.verdict, missingCount);
    const bg = statusColor(status).bg;

    // Estimate USD (simplified: if HKD divide by 7.8, else use price as-is)
    const price = w.parsed.price || 0;
    const usd = w.parsed.currency === 'HKD' && price > 0
      ? Math.round(price / 7.8)
      : price;

    ws1Data.push([
      dataCell(`clean_${i}`, bg),                          // ID
      dataCell(w.parsed.brand, bg),                         // Brand
      dataCell(w.parsed.reference || 'Unknown', bg),        // Reference
      dataCell(w.parsed.dialColor || 'UNKNOWN', bg),        // Dial
      numCell(price, bg),                                   // Price
      numCell(usd, bg),                                     // USD
      dataCell(w.parsed.currency || 'Unknown', bg),         // Currency
      dataCell(w.parsed.condition, bg),                     // Condition
      numCell(w.parsed.year, bg),                           // Year
      numCell(w.confidence, bg),                            // Confidence
      dataCell(status, bg, 'center'),                       // Status
      dataCell(w.input, bg),                                // Raw Message
    ]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 55 },
  ];
  ws1['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 0 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 0 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'All Records');

  // ════════════════════════ Sheet 2: Stage Details ════════════════════════
  const ws2Data: any[][] = [];
  ws2Data.push([
    cell('STAGE-BY-STAGE WORKFLOW', {
      font: { bold: true, sz: 16, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws2Data.push([
    cell('Full visibility into the analysis pipeline for each watch', {
      font: { sz: 10, italic: true, color: { rgb: 'FF666666' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws2Data.push([]);

  const stageHeaders = ['Watch #', 'Input', 'Stage', 'Engine', 'Confidence', 'Verdict', 'Note'];
  ws2Data.push(stageHeaders.map(h => headerCell(h)));

  watches.forEach((w, wi) => {
    w.stages.forEach((s) => {
      const stageBg = s.stage === 'PARSE' ? { rgb: 'FFE8F5E9' }
        : s.stage === 'AI_TEXT' ? { rgb: 'FFE0F7FA' }
        : s.stage === 'ONLINE' ? { rgb: 'FFFFF3E0' }
        : s.stage === 'IMAGE' ? { rgb: 'FFF3E5F5' }
        : COLORS.white.bg;

      ws2Data.push([
        numCell(wi + 1, stageBg),
        dataCell(w.input.slice(0, 60), stageBg),
        dataCell(s.stage, stageBg),
        dataCell(s.engine, stageBg),
        numCell(s.confidence, stageBg),
        dataCell(s.verdict || '—', stageBg, 'center'),
        dataCell(s.note || s.error || '—', stageBg),
      ]);
    });
  });

  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
  ws2['!cols'] = [
    { wch: 8 }, { wch: 40 }, { wch: 12 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 50 },
  ];
  ws2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Stage Details');

  // ════════════════════════ Sheet 3: Summary ════════════════════════
  const ws3Data: any[][] = [];
  ws3Data.push([
    cell('VERDICT SUMMARY', {
      font: { bold: true, sz: 16, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws3Data.push([]);

  const vHeaders = ['Verdict', 'Count', 'Percentage', 'Avg Confidence'];
  ws3Data.push(vHeaders.map(h => headerCell(h)));

  const verdicts: Verdict[] = ['APPROVED', 'HUMAN', 'RECYCLE'];
  verdicts.forEach(v => {
    const group = watches.filter(w => w.verdict === v);
    const avgConf = group.length > 0
      ? Math.round(group.reduce((s, w) => s + w.confidence, 0) / group.length)
      : 0;
    const bg = v === 'APPROVED' ? COLORS.lightGreen.bg
      : v === 'HUMAN' ? COLORS.orange.bg
      : COLORS.red.bg;

    ws3Data.push([
      dataCell(v, bg, 'center'),
      numCell(group.length, bg),
      pctCell(group.length > 0 ? Math.round((group.length / watches.length) * 100) : 0, bg),
      numCell(avgConf, bg),
    ]);
  });

  // Per-watch reference table
  ws3Data.push([]);
  ws3Data.push([
    headerCell('#'), headerCell('Brand'), headerCell('Reference'),
    headerCell('Dial'), headerCell('Verdict'), headerCell('Confidence'),
    headerCell('Stages'),
  ]);

  watches.forEach((w, i) => {
    const missingCount = getMissingCount(w);
    const status = statusFromVerdict(w.verdict, missingCount);
    const bg = statusColor(status).bg;

    ws3Data.push([
      numCell(i + 1, bg),
      dataCell(w.parsed.brand, bg),
      dataCell(w.parsed.reference || '—', bg),
      dataCell(w.parsed.dialColor || '—', bg),
      dataCell(w.verdict, bg, 'center'),
      numCell(w.confidence, bg),
      dataCell(w.stages.map(s => s.stage).join(' → '), bg),
    ]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
  ws3['!cols'] = [
    { wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 30 },
  ];
  ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

  // Download
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `Curated_Luxury_CleanAnalysis_${now}.xlsx`);
}

// ═══════════════════════ CSV Export ═══════════════════════

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function exportCleanCsv(watches: CleanWatch[], _summary: any) {
  const rows: string[] = [];

  // Header
  rows.push(['ID', 'Brand', 'Reference', 'Dial', 'Price', 'USD', 'Currency', 'Condition', 'Year', 'Confidence', 'Status', 'Raw Message'].join(','));

  // Data rows — EXACT same format as the Excel sheet
  watches.forEach((w, i) => {
    const missingCount = getMissingCount(w);
    const status = statusFromVerdict(w.verdict, missingCount);
    const price = w.parsed.price || 0;
    const usd = w.parsed.currency === 'HKD' && price > 0
      ? Math.round(price / 7.8)
      : price;

    rows.push([
      escapeCsv(`clean_${i}`),
      escapeCsv(w.parsed.brand),
      escapeCsv(w.parsed.reference || 'Unknown'),
      escapeCsv(w.parsed.dialColor || 'UNKNOWN'),
      escapeCsv(price),
      escapeCsv(usd),
      escapeCsv(w.parsed.currency || 'Unknown'),
      escapeCsv(w.parsed.condition),
      escapeCsv(w.parsed.year ?? ''),
      escapeCsv(w.confidence),
      escapeCsv(status),
      escapeCsv(w.input),
    ].join(','));
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.href = URL.createObjectURL(blob);
  link.download = `Curated_Luxury_CleanAnalysis_${now}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
