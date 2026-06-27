/**
 * Generate a color-coded Excel report (.xlsx) of watch inventory.
 * Uses the same xlsx library already imported elsewhere.
 * Columns: #, Brand, Reference, Dial, Price, Year, Condition, Confidence bar, Status, Intent
 * Colors: brand-colored badges, gradient confidence bars, status pills, intent colors
 */

export interface ReportRecord {
  reference: string;
  brand: string;
  dialColor: string;
  price: number;
  currency: string;
  condition: string;
  year: number | null;
  confidence: number;
  status: string;
  intent: string;
  rawMessage: string;
}

// ── Palette ──
const C = {
  navyBg:    { rgb: 'FF1F4E78' },
  navyFg:    { rgb: 'FFFFFFFF' },
  headerBg:  { rgb: 'FF1F4E78' },
  headerFg:  { rgb: 'FFFFFFFF' },
  greenBg:   { rgb: 'FF90EE90' },
  orangeBg:  { rgb: 'FFFFA500' },
  redBg:     { rgb: 'FFFF6B6B' },
  yellowBg:  { rgb: 'FFFFFFE0' },
  purpleBg:  { rgb: 'FFD8B4FE' },
  blueBg:    { rgb: 'FFBFDBFF' },
  whiteBg:   { rgb: 'FFFFFFFF' },
  text:      { rgb: 'FF1A1A1A' },
  whiteText: { rgb: 'FFFFFFFF' },
  greenText: { rgb: 'FF166534' },
  redText:   { rgb: 'FF7F1D1D' },
  goldText:  { rgb: 'FFC9A96E' },
  greyBg:    { rgb: 'FFF0F0F0' },
};

const BRAND_COLORS: Record<string, string> = {
  'Patek Philippe': 'C9A96E',
  'Rolex': '006241',
  'Audemars Piguet': '005A9C',
  'Richard Mille': 'E31B23',
  'Vacheron Constantin': '1A1A2E',
  'Cartier': 'C41E3A',
  'IWC': '003366',
  'Omega': '002147',
  'Tudor': '000000',
  'Panerai': '004D40',
  'Hublot': '1A1A1A',
  'Breitling': '002868',
  'Jaeger-LeCoultre': '001B3B',
  'Grand Seiko': '8B0000',
  'Patek': 'C9A96E',
};

function statusBg(s: string): any {
  if (s === 'AUTO_APPROVED' || s === 'APPROVED' || s === 'NORMALIZED') return C.greenBg;
  if (s === 'HUMAN_REVIEW' || s === 'RESIDUE' || s === 'HUMAN') return C.orangeBg;
  if (s === 'RECYCLE') return C.redBg;
  if (s === 'AI_REVIEW') return C.yellowBg;
  return C.whiteBg;
}

function border(color = 'FFDDDDDD') {
  const b = { style: 'thin' as const, color: { rgb: color } };
  return { top: b, bottom: b, left: b, right: b };
}

function hCell(v: string) {
  return { v, t: 's' as const, s: {
    font: { bold: true, color: C.headerFg, sz: 10, name: 'Calibri' },
    fill: { fgColor: C.headerBg, patternType: 'solid' as const },
    alignment: { horizontal: 'center' as const, vertical: 'center' as const },
    border: border(),
  }};
}

function dCell(v: any, bg: any, align = 'left' as any) {
  const isNum = typeof v === 'number';
  return {
    v: v ?? '', t: isNum ? 'n' as const : 's' as const,
    s: {
      font: { sz: 9, color: C.text, name: 'Calibri' },
      fill: { fgColor: bg, patternType: 'solid' as const },
      alignment: { horizontal: align, vertical: 'center' as const },
      border: border(),
      ...(isNum ? { numFmt: '#,##0' } : {}),
    },
  };
}

function titleCell(v: string) {
  return { v, t: 's' as const, s: {
    font: { bold: true, sz: 14, color: { rgb: 'FF1F4E78' }, name: 'Calibri' },
    alignment: { horizontal: 'left' as const, vertical: 'center' as const },
  }};
}

function intentBg(s: string): any {
  if (s === 'BUY')    return { rgb: 'FFBFDBFF' };  // blue
  if (s === 'INQUIRY') return { rgb: 'FFFFFFE0' };  // yellow
  return { rgb: 'FFD5F5E3' };  // green tint for SELL
}

function intentFg(s: string): any {
  if (s === 'BUY')    return { rgb: 'FF1E40AF' };
  if (s === 'INQUIRY') return { rgb: 'FF854D0E' };
  return { rgb: 'FF166534' };
}

// ── Main export ──
export async function downloadStyledReport(records: ReportRecord[], filename?: string) {
  const XLSX = await import('xlsx-js-style');
  const stamp = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // ── SHEET 1: All Records ──
  const ws1: any[][] = [];
  ws1.push([titleCell(`WatchFacts Colored Report — ${stamp}`)]);
  ws1.push([{ v: `${records.length} records`, t: 's', s: { font: { sz: 9, italic: true, color: { rgb: 'FF666666' } } } }]);
  ws1.push([]);

  const COLS = ['#', 'Brand', 'Reference', 'Dial', 'Price', 'Year', 'Condition', 'Confidence', 'Status', 'Intent'];
  ws1.push(COLS.map(hCell));

  records.forEach((r, i) => {
    const sb = statusBg(r.status);
    const ib = intentBg(r.intent);
    const hex = BRAND_COLORS[r.brand] || '999999';
    const brandLight = { rgb: `FF${hex}44` };
    ws1.push([
      dCell(i + 1, sb, 'center'),
      { ...dCell(r.brand || 'Unknown', brandLight), s: {
        font: { bold: true, sz: 9, color: { rgb: `FF${hex}` }, name: 'Calibri' },
        fill: { fgColor: brandLight, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: border(),
      }},
      dCell(r.reference || '—', sb),
      dCell(r.dialColor || '—', sb),
      dCell(r.price || 0, sb, 'right'),
      dCell(r.year ?? '—', sb, 'center'),
      dCell(r.condition || '—', sb, 'center'),
      // Confidence as percentage
      { v: r.confidence / 100, t: 'n', s: {
        font: {
          sz: 9,
          bold: true,
          color: r.confidence >= 90 ? { rgb: 'FF166534' } : r.confidence >= 60 ? { rgb: 'FF854D0E' } : { rgb: 'FF7F1D1D' },
          name: 'Calibri',
        },
        fill: { fgColor: r.confidence >= 90 ? { rgb: 'FF90EE90' } : r.confidence >= 60 ? { rgb: 'FFFFFFE0' } : { rgb: 'FFFF6B6B' }, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: border(),
        numFmt: '0%',
        // Show as percentage of 100
      }},
      // Status
      { ...dCell(r.status, sb, 'center'), s: {
        font: { bold: true, sz: 9, color: r.status === 'AUTO_APPROVED' || r.status === 'NORMALIZED' || r.status === 'APPROVED'
          ? { rgb: 'FF166534' } : r.status === 'RECYCLE' ? { rgb: 'FF7F1D1D' } : { rgb: 'FF854D0E' }, name: 'Calibri' },
        fill: { fgColor: sb, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: border(),
      }},
      // Intent
      { ...dCell(r.intent || 'SELL', ib, 'center'), s: {
        font: { bold: true, sz: 9, color: intentFg(r.intent), name: 'Calibri' },
        fill: { fgColor: ib, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: border(),
      }},
    ]);
  });

  const ws1Sheet = XLSX.utils.aoa_to_sheet(ws1);
  ws1Sheet['!cols'] = [{wch:5},{wch:20},{wch:16},{wch:14},{wch:12},{wch:6},{wch:10},{wch:12},{wch:14},{wch:10}];
  ws1Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:9} }, { s:{r:1,c:0}, e:{r:1,c:9} }];
  ws1Sheet['!freeze'] = { xSplit: 0, ySplit: 4 };
  XLSX.utils.book_append_sheet(wb, ws1Sheet, 'Styled Report');

  // ── SHEET 2: Summary ──
  const ws2: any[][] = [];
  ws2.push([titleCell('Summary')]);
  ws2.push([]);

  const total = records.length;
  const approved = records.filter(r => r.status === 'AUTO_APPROVED' || r.status === 'APPROVED' || r.status === 'NORMALIZED').length;
  const human = records.filter(r => r.status === 'HUMAN_REVIEW' || r.status === 'RESIDUE' || r.status === 'HUMAN').length;
  const recycle = records.filter(r => r.status === 'RECYCLE').length;
  const review = total - approved - human - recycle;

  ws2.push(['Status', 'Count', 'Percentage'].map(hCell));
  const summaryRows: [string, number, any][] = [
    ['APPROVED', approved, C.greenBg],
    ['HUMAN', human, C.orangeBg],
    ['RECYCLE', recycle, C.redBg],
    ['AI REVIEW', review, C.yellowBg],
  ];
  for (const [label, count, bg] of summaryRows) {
    ws2.push([
      { ...dCell(label, bg, 'center'), s: { font: { bold: true, sz: 10, color: C.text, name: 'Calibri' }, fill: { fgColor: bg, patternType: 'solid' }, border: border() }},
      dCell(count, bg, 'right'),
      dCell(`${total > 0 ? Math.round(count / total * 100) : 0}%`, bg, 'right'),
    ]);
  }
  ws2.push([]);
  ws2.push([hCell('TOTAL'), dCell(total, C.whiteBg, 'right'), dCell('100%', C.whiteBg, 'right')]);

  const ws2Sheet = XLSX.utils.aoa_to_sheet(ws2);
  ws2Sheet['!cols'] = [{wch:16},{wch:10},{wch:12}];
  ws2Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:2} }];
  XLSX.utils.book_append_sheet(wb, ws2Sheet, 'Summary');

  // Write
  const fname = filename || `WatchFacts_Styled_Report_${stamp}.xlsx`;
  XLSX.writeFile(wb, fname);
}
