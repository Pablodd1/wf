/**
 * EXPORT REPORT — /api/export-report
 *
 * Accepts: POST { watches: [...parsed watches from clean-analyze] }
 * Returns: colored Excel (3 sheets) + CSV download
 *
 * Sheets:
 *   1. APPROVED  (green rows)
 *   2. HUMAN     (yellow rows)
 *   3. RECYCLE   (red rows)
 *
 * Colors: conditional row coloring per verdict
 */

const XLSX = require('xlsx-js-style');

const COLORS = {
  APPROVED: { fg: { rgb: '006100' }, bg: { rgb: 'C6EFCE' } },   // green
  HUMAN:    { fg: { rgb: '9C5700' }, bg: { rgb: 'FFEB9C' } },   // yellow
  RECYCLE:  { fg: { rgb: '9C0006' }, bg: { rgb: 'FFC7CE' } },   // red
};

function styleRow(ws, rowIdx, color) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
    if (!ws[addr]) ws[addr] = {};
    ws[addr].s = {
      font: { color: color.fg, bold: true },
      fill: { patternType: 'solid', fgColor: color.bg },
      alignment: { vertical: 'center', horizontal: 'left' },
    };
  }
}

function addLegend(ws, startRow) {
  const legend = [
    ['LEGEND', '', ''],
    ['APPROVED', 'Auto-approved (confidence >= 85%)', ''],
    ['HUMAN', 'Needs human review', ''],
    ['RECYCLE', 'Not enough info / recycle bin', ''],
  ];
  XLSX.utils.sheet_add_aoa(ws, legend, { origin: { r: startRow, c: 0 } });

  const colors = [null, COLORS.APPROVED, COLORS.HUMAN, COLORS.RECYCLE];
  for (let i = 0; i < legend.length; i++) {
    if (colors[i]) styleRow(ws, startRow + i, colors[i]);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const { watches, format = 'xlsx' } = req.body || {};
  if (!Array.isArray(watches) || watches.length === 0) {
    return res.status(400).json({ error: 'watches array required' });
  }

  const headers = ['Reference', 'Brand', 'Dial Color', 'Condition', 'Year', 'Price', 'Currency', 'Confidence', 'Verdict', 'Reason', 'Input'];

  const approved = watches.filter(w => w.verdict === 'APPROVED');
  const human = watches.filter(w => w.verdict === 'HUMAN');
  const recycle = watches.filter(w => w.verdict === 'RECYCLE');

  const wb = XLSX.utils.book_new();

  function makeSheet(data, name, color) {
    const rows = data.map(w => [
      w.parsed?.reference || '',
      w.parsed?.brand || '',
      w.parsed?.dialColor || '',
      w.parsed?.condition || '',
      w.parsed?.year || '',
      w.parsed?.price || '',
      w.parsed?.currency || '',
      w.confidence || '',
      w.verdict || '',
      w.reason || '',
      w.input || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Auto-width
    const colWidths = headers.map((h, i) => {
      const max = Math.max(h.length, ...rows.map(r => String(r[i] || '').length));
      return { wch: Math.min(max + 2, 60) };
    });
    ws['!cols'] = colWidths;

    // Style rows
    for (let i = 0; i < rows.length; i++) {
      styleRow(ws, i + 1, color);
    }

    // Header style
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      ws[addr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '4472C4' } },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }

    // Add legend at bottom
    addLegend(ws, rows.length + 2);

    XLSX.utils.book_append_sheet(wb, ws, name);
    return ws;
  }

  makeSheet(approved, 'APPROVED', COLORS.APPROVED);
  makeSheet(human, 'HUMAN', COLORS.HUMAN);
  makeSheet(recycle, 'RECYCLE', COLORS.RECYCLE);

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `watchfacts-report-${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Length', buf.length);
  return res.status(200).send(buf);
}
