/**
 * WatchFacts Dataset Excel + CSV Export
 * Home page "Export Excel" / "Export CSV" buttons.
 *
 * Excel: 3 sheets — All Records (colored), Summary, Brand Breakdown
 * CSV:   12-column flat file matching dataset format
 *
 * Color scheme (matches cleanExport.ts):
 *   APPROVED → Light Green  #90EE90
 *   HUMAN    → Orange       #FFA500
 *   RECYCLE  → Red          #FF6B6B
 *   Headers  → Navy         #1F4E78  white bold
 */

import type { WatchRecord } from '@/types';

// Lazy-load SheetJS to avoid bloating the initial bundle
async function getXLSX() {
  const mod = await import('xlsx-js-style');
  return mod;
}

// ── Color palette ──────────────────────────────────────────────────────────────
const C = {
  navyBg:    { rgb: 'FF1F4E78' },
  navyFg:    { rgb: 'FFFFFFFF' },
  green:     { rgb: 'FF90EE90' },
  orange:    { rgb: 'FFFFA500' },
  red:       { rgb: 'FFFF6B6B' },
  yellow:    { rgb: 'FFFFFFE0' },
  white:     { rgb: 'FFFFFFFF' },
  lightGrey: { rgb: 'FFF5F5F5' },
  text:      { rgb: 'FF1A1A1A' },
};

// ── Verdict derivation ─────────────────────────────────────────────────────────
// isResidue in the loaded WatchRecord actually holds the raw verdict string
// (APPROVED / HUMAN / RECYCLE) from col 10 of parsedWatches.json
function getVerdict(r: WatchRecord): 'APPROVED' | 'HUMAN' | 'RECYCLE' {
  const raw = String((r as any).isResidue || '');
  if (raw === 'APPROVED') return 'APPROVED';
  if (raw === 'RECYCLE')  return 'RECYCLE';
  if (raw === 'HUMAN')    return 'HUMAN';
  // Fallback: derive from confidence + failureFlags
  if (r.failureFlags?.length === 0 && r.confidence >= 85) return 'APPROVED';
  if (r.confidence < 35) return 'RECYCLE';
  return 'HUMAN';
}

function verdictBg(v: string) {
  if (v === 'APPROVED') return C.green;
  if (v === 'RECYCLE')  return C.red;
  return C.orange;
}

// ── Cell builders ──────────────────────────────────────────────────────────────
function border() {
  const b = { style: 'thin', color: { rgb: 'FFDDDDDD' } };
  return { top: b, bottom: b, left: b, right: b };
}

function hCell(v: string) {
  return {
    v, t: 's',
    s: {
      font: { bold: true, color: C.navyFg, sz: 10, name: 'Calibri' },
      fill: { fgColor: C.navyBg, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: border(),
    },
  };
}

function dCell(v: any, bg: any, align = 'left') {
  const isNum = typeof v === 'number';
  return {
    v: v ?? '',
    t: isNum ? 'n' : 's',
    s: {
      font: { sz: 9, color: C.text, name: 'Calibri' },
      fill: { fgColor: bg, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center', wrapText: false },
      border: border(),
      ...(isNum ? { numFmt: '#,##0' } : {}),
    },
  };
}

function titleCell(v: string) {
  return {
    v, t: 's',
    s: {
      font: { bold: true, sz: 14, color: C.navyBg, name: 'Calibri' },
      alignment: { horizontal: 'left', vertical: 'center' },
    },
  };
}

// ── Main Excel export ──────────────────────────────────────────────────────────
export async function exportDatasetExcel(records: WatchRecord[]) {
  const XLSX = await getXLSX();
  const stamp = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  const approved = records.filter(r => getVerdict(r) === 'APPROVED');
  const human    = records.filter(r => getVerdict(r) === 'HUMAN');
  const recycle  = records.filter(r => getVerdict(r) === 'RECYCLE');

  // ── SHEET 1: All Records ───────────────────────────────────────────────────
  const ws1: any[][] = [];

  // Title row
  ws1.push([titleCell(`WatchFacts Dataset Export — ${stamp}`)]);
  ws1.push([{
    v: `${records.length.toLocaleString()} records  ·  ${approved.length.toLocaleString()} Approved  ·  ${human.length.toLocaleString()} Human  ·  ${recycle.length.toLocaleString()} Recycle`,
    t: 's',
    s: { font: { sz: 9, italic: true, color: { rgb: 'FF666666' } } },
  }]);
  ws1.push([]);

  // Header
  const COLS = ['ID','Brand','Reference','Dial','Price','USD','Currency','Condition','Year','Confidence','Status','Raw Message'];
  ws1.push(COLS.map(hCell));

  // Data rows
  for (const r of records) {
    const v = getVerdict(r);
    const bg = verdictBg(v);
    ws1.push([
      dCell(r.id,                              bg),
      dCell(r.brand,                           bg),
      dCell(r.reference,                       bg),
      dCell(r.dialColor,                       bg),
      dCell(r.originalPrice || r.price || 0,  bg, 'right'),
      dCell(r.price || 0,                      bg, 'right'),
      dCell(r.originalCurrency || 'USD',       bg, 'center'),
      dCell(r.condition,                       bg),
      dCell(r.year ?? '',                      bg, 'center'),
      dCell(r.confidence,                      bg, 'right'),
      dCell(v,                                 bg, 'center'),
      dCell(r.rawMessage?.slice(0, 120) || '', bg),
    ]);
  }

  const ws1Sheet = XLSX.utils.aoa_to_sheet(ws1);
  ws1Sheet['!cols'] = [
    {wch:14},{wch:18},{wch:16},{wch:12},
    {wch:12},{wch:12},{wch:10},{wch:12},
    {wch:6},{wch:11},{wch:11},{wch:55},
  ];
  ws1Sheet['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:11} },
    { s:{r:1,c:0}, e:{r:1,c:11} },
  ];
  ws1Sheet['!freeze'] = { xSplit: 0, ySplit: 4 };
  XLSX.utils.book_append_sheet(wb, ws1Sheet, 'All Records');

  // ── SHEET 2: Summary ──────────────────────────────────────────────────────
  const ws2: any[][] = [];
  ws2.push([titleCell('Summary')]);
  ws2.push([]);
  ws2.push(['Status','Count','Pct','Avg Confidence','Avg Price USD'].map(hCell));

  for (const [label, group, bg] of [
    ['APPROVED', approved, C.green],
    ['HUMAN',    human,    C.orange],
    ['RECYCLE',  recycle,  C.red],
  ] as [string, WatchRecord[], any][]) {
    const avgConf = group.length
      ? Math.round(group.reduce((s,r) => s + r.confidence, 0) / group.length)
      : 0;
    const avgPrice = group.length
      ? Math.round(group.filter(r => r.price > 0).reduce((s,r) => s + r.price, 0) / Math.max(1, group.filter(r => r.price > 0).length))
      : 0;
    ws2.push([
      dCell(label, bg, 'center'),
      dCell(group.length, bg, 'right'),
      dCell(`${Math.round(group.length / records.length * 100)}%`, bg, 'right'),
      dCell(avgConf, bg, 'right'),
      dCell(avgPrice, bg, 'right'),
    ]);
  }

  ws2.push([]);
  ws2.push([hCell('Total'), dCell(records.length, C.white, 'right'), dCell('100%', C.white, 'right'), dCell('', C.white), dCell('', C.white)]);

  const ws2Sheet = XLSX.utils.aoa_to_sheet(ws2);
  ws2Sheet['!cols'] = [{wch:14},{wch:10},{wch:8},{wch:16},{wch:16}];
  ws2Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:4} }];
  XLSX.utils.book_append_sheet(wb, ws2Sheet, 'Summary');

  // ── SHEET 3: Brand Breakdown ──────────────────────────────────────────────
  const ws3: any[][] = [];
  ws3.push([titleCell('Brand Breakdown')]);
  ws3.push([]);
  ws3.push(['Brand','Total','Approved','Human','Recycle','Avg Conf','Avg USD'].map(hCell));

  const brands = [...new Set(records.map(r => r.brand))].sort();
  for (const brand of brands) {
    const grp = records.filter(r => r.brand === brand);
    const app = grp.filter(r => getVerdict(r) === 'APPROVED').length;
    const hum = grp.filter(r => getVerdict(r) === 'HUMAN').length;
    const rec = grp.filter(r => getVerdict(r) === 'RECYCLE').length;
    const avgConf = Math.round(grp.reduce((s,r) => s + r.confidence, 0) / grp.length);
    const priced = grp.filter(r => r.price > 0);
    const avgUSD = priced.length ? Math.round(priced.reduce((s,r) => s + r.price, 0) / priced.length) : 0;
    // Row bg: green if >60% approved, orange if mixed, red if majority recycle
    const appPct = app / grp.length;
    const bg = appPct >= 0.6 ? C.green : rec / grp.length >= 0.5 ? C.red : C.orange;
    ws3.push([
      dCell(brand, bg),
      dCell(grp.length, bg, 'right'),
      dCell(app, bg, 'right'),
      dCell(hum, bg, 'right'),
      dCell(rec, bg, 'right'),
      dCell(avgConf, bg, 'right'),
      dCell(avgUSD, bg, 'right'),
    ]);
  }

  const ws3Sheet = XLSX.utils.aoa_to_sheet(ws3);
  ws3Sheet['!cols'] = [{wch:22},{wch:8},{wch:10},{wch:8},{wch:10},{wch:10},{wch:12}];
  ws3Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:6} }];
  XLSX.utils.book_append_sheet(wb, ws3Sheet, 'Brand Breakdown');

  XLSX.writeFile(wb, `WatchFacts_Export_${stamp}.xlsx`);
}

// ── CSV export ─────────────────────────────────────────────────────────────────
export function exportDatasetCsv(records: WatchRecord[]) {
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const COLS = ['ID','Brand','Reference','Dial','Price','USD','Currency','Condition','Year','Confidence','Status','Raw Message'];
  const rows: string[] = [COLS.join(',')];

  for (const r of records) {
    const v = getVerdict(r);
    rows.push([
      esc(r.id),
      esc(r.brand),
      esc(r.reference),
      esc(r.dialColor),
      esc(r.originalPrice || r.price || 0),
      esc(r.price || 0),
      esc(r.originalCurrency || 'USD'),
      esc(r.condition),
      esc(r.year ?? ''),
      esc(r.confidence),
      esc(v),
      esc(r.rawMessage?.slice(0, 200) || ''),
    ].join(','));
  }

  const csv = '\uFEFF' + rows.join('\r\n');   // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `WatchFacts_Export_${records.length}records_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
