/**
 * Export Page -- Batch-processed Excel/CSV export with filters
 * Handles ANY dataset size by chunking into 1,000-row batches
 * Filters: brand, date range, price range, verdict, dial color
 */
import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import {
  Download, Loader2, Filter, FileSpreadsheet, Database,
  CheckCircle, AlertTriangle, X, ArrowRight, FileText, CircleOff,
  Timer, Package,
} from 'lucide-react';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';


const BATCH_SIZE = 1000;
const TOTAL_RECORDS = 2390143; // Total records in the database

const COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'reference', label: 'Reference' },
  { key: 'dial_color', label: 'Dial Color' },
  { key: 'condition', label: 'Condition' },
  { key: 'year', label: 'Year' },
  { key: 'price_usd', label: 'Price USD' },
  { key: 'currency', label: 'Currency' },
  { key: 'confidence', label: 'Confidence %' },
  { key: 'verdict', label: 'Verdict' },
  { key: 'source', label: 'Source' },
  { key: 'created_at', label: 'Created At' },
  { key: 'received_at', label: 'Received At' },
  { key: 'raw_message', label: 'Raw Message' },
];

const BRANDS = ['All', 'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier', 'Breitling', 'IWC', 'Jaeger-LeCoultre', 'Panerai', 'Hublot', 'TAG Heuer', 'Tudor', 'Longines', 'Seiko', 'Grand Seiko', 'Zenith', 'Blancpain', 'Breguet', 'Chopard', 'Bulgari', 'Others'];
const VERDICTS = ['All', 'APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE', 'WTB'];

// Escape CSV field
function csvField(val: any): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Build a clean filename from filters and options
function buildFilename(filters: any, allRows: any[], format: 'csv' | 'excel'): string {
  const parts = ['watchfacts'];
  if (filters.brand !== 'All') parts.push(filters.brand.toLowerCase().replace(/\s+/g, '-'));
  if (filters.verdict !== 'All') parts.push(filters.verdict.toLowerCase());
  parts.push(`${allRows.length}-records`);
  parts.push(new Date().toISOString().slice(0, 10));
  return `${parts.join('-')}.${format === 'excel' ? 'xlsx' : 'csv'}`;
}

export default function ExportPage() {
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, eta: '' });
  const [filters, setFilters] = useState({
    brand: 'All',
    verdict: 'All',
    minPrice: '',
    maxPrice: '',
    dateFrom: '',
    dateTo: '',
    limit: '50000',
  });
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel'>('csv');
  const [logs, setLogs] = useState<string[]>([]);
  const abortRef = useRef(false);

  const addLog = (msg: string) => setLogs(prev => [msg, ...prev].slice(0, 50));

  const buildQueryUrl = (offset: number, limit: number): string => {
    let url = `${SUPABASE_URL}/rest/v1/watch_records?select=${COLUMNS.map(c => c.key).join(',')}&limit=${limit}&offset=${offset}`;
    if (filters.brand !== 'All') url += `&brand=eq.${encodeURIComponent(filters.brand)}`;
    if (filters.verdict !== 'All') url += `&verdict=eq.${encodeURIComponent(filters.verdict)}`;
    if (filters.minPrice) url += `&price_usd=gte.${filters.minPrice}`;
    if (filters.maxPrice) url += `&price_usd=lte.${filters.maxPrice}`;
    if (filters.dateFrom) url += `&created_at=gte.${encodeURIComponent(filters.dateFrom)}`;
    if (filters.dateTo) url += `&created_at=lte.${encodeURIComponent(filters.dateTo + 'T23:59:59')}`;
    url += `&order=created_at.desc`;
    return url;
  };

  // --- Excel Export ---
  const exportToExcel = (data: any[], filename: string) => {
    // Create worksheet from JSON data
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'WatchFacts Export');

    // Style the header row (gold background, bold)
    const headerRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const headerStyle = {
      font: { bold: true, color: { rgb: '000000' } },
      fill: { fgColor: { rgb: 'D4AF37' }, bgColor: { rgb: 'D4AF37' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };

    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellRef]) continue;
      ws[cellRef].s = headerStyle;
    }

    // Auto-size columns
    const colWidths: number[] = [];
    const headers = COLUMNS.map(c => c.label);
    headers.forEach((h, i) => {
      colWidths[i] = Math.max(h.length + 4, 12);
    });
    data.forEach((row) => {
      COLUMNS.forEach((col, i) => {
        const val = String(row[col.key] ?? '');
        colWidths[i] = Math.max(colWidths[i], Math.min(val.length + 2, 60));
      });
    });
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    // Set row height for header
    ws['!rows'] = [{ hpx: 24 }];

    XLSX.writeFile(wb, filename);
  };

  // --- CSV Export ---
  const exportToCSV = (data: string[][], filename: string) => {
    const headers = COLUMNS.map(c => c.label);
    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(','), ...data.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Regular Export (filtered, with limit) ---
  const doExport = useCallback(async () => {
    abortRef.current = false;
    setExporting(true);
    setLogs([]);
    const maxRecords = parseInt(filters.limit) || 50000;
    const headers = COLUMNS.map(c => c.label);
    let allRows: string[][] = [];
    let allData: any[] = [];
    let offset = 0;
    let hasMore = true;
    const startTime = Date.now();

    addLog(`Starting ${exportFormat.toUpperCase()} export (max ${maxRecords.toLocaleString()} records)...`);

    while (hasMore && !abortRef.current && offset < maxRecords) {
      const batchSize = Math.min(BATCH_SIZE, maxRecords - offset);
      try {
        const res = await fetch(buildQueryUrl(offset, batchSize), { headers: REQ_HEADERS });
        if (!res.ok) {
          addLog(`Error: HTTP ${res.status} at offset ${offset}`);
          break;
        }
        const data = await res.json();
        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        const rows = data.map((r: any) => COLUMNS.map(c => csvField(r[c.key])));
        allRows.push(...rows);
        if (exportFormat === 'excel') {
          allData.push(...data);
        }
        offset += data.length;

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = offset / elapsed;
        const remaining = Math.max(0, Math.round((maxRecords - offset) / rate));
        const etaMin = Math.floor(remaining / 60);
        const etaSec = remaining % 60;

        setProgress({
          current: offset,
          total: maxRecords,
          percent: Math.round((offset / maxRecords) * 100),
          eta: `${etaMin}m ${etaSec}s`,
        });
        addLog(`Batch complete: ${offset.toLocaleString()} records fetched`);

        if (data.length < batchSize) hasMore = false;
      } catch (err: any) {
        addLog(`Error at offset ${offset}: ${err.message}`);
        break;
      }
    }

    if (abortRef.current) {
      addLog('Export aborted');
      setExporting(false);
      setProgress({ current: 0, total: 0, percent: 0, eta: '' });
      return;
    }

    // Export in chosen format
    const filename = buildFilename(filters, allRows, exportFormat);
    if (exportFormat === 'excel') {
      exportToExcel(allData, filename);
    } else {
      exportToCSV(allRows, filename);
    }

    addLog(`✅ Export complete: ${allRows.length.toLocaleString()} records (${exportFormat.toUpperCase()})`);
    setExporting(false);
    setProgress({ current: 0, total: 0, percent: 0, eta: '' });
  }, [filters, exportFormat]);

  // --- Export ALL Records ---
  const doExportAll = useCallback(async () => {
    abortRef.current = false;
    setExportingAll(true);
    setExporting(true);
    setLogs([]);
    const totalRecords = TOTAL_RECORDS;
    let allRows: string[][] = [];
    let allData: any[] = [];
    let offset = 0;
    let hasMore = true;
    let batchCount = 0;
    const totalBatches = Math.ceil(totalRecords / BATCH_SIZE);
    const startTime = Date.now();

    addLog(`🚀 Starting FULL export of ALL records (${totalRecords.toLocaleString()}) in ${exportFormat.toUpperCase()} format...`);

    while (hasMore && !abortRef.current) {
      batchCount++;
      try {
        const res = await fetch(buildQueryUrl(offset, BATCH_SIZE), { headers: REQ_HEADERS });
        if (!res.ok) {
          addLog(`Error: HTTP ${res.status} at offset ${offset}`);
          break;
        }
        const data = await res.json();
        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        const rows = data.map((r: any) => COLUMNS.map(c => csvField(r[c.key])));
        allRows.push(...rows);
        if (exportFormat === 'excel') {
          allData.push(...data);
        }
        offset += data.length;

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = offset / elapsed;
        const remaining = Math.max(0, Math.round((totalRecords - offset) / rate));
        const etaMin = Math.floor(remaining / 60);
        const etaSec = remaining % 60;

        setProgress({
          current: offset,
          total: totalRecords,
          percent: Math.round((offset / totalRecords) * 100),
          eta: `${etaMin}m ${etaSec}s`,
        });

        if (batchCount % 10 === 0 || data.length < BATCH_SIZE) {
          addLog(`Batch ${batchCount}/${totalBatches}: ${offset.toLocaleString()} records fetched (${exportFormat.toUpperCase()})`);
        }

        if (data.length < BATCH_SIZE) hasMore = false;
      } catch (err: any) {
        addLog(`Error at offset ${offset}: ${err.message}`);
        break;
      }
    }

    if (abortRef.current) {
      addLog('❌ Full export aborted');
      setExportingAll(false);
      setExporting(false);
      setProgress({ current: 0, total: 0, percent: 0, eta: '' });
      return;
    }

    // Export in chosen format
    const filename = buildFilename({ ...filters, brand: 'All', verdict: 'All' }, allRows, exportFormat);
    if (exportFormat === 'excel') {
      exportToExcel(allData, filename);
    } else {
      exportToCSV(allRows, filename);
    }

    addLog(`✅ FULL export complete: ${allRows.length.toLocaleString()} records (${exportFormat.toUpperCase()})`);
    setExportingAll(false);
    setExporting(false);
    setProgress({ current: 0, total: 0, percent: 0, eta: '' });
  }, [filters, exportFormat]);

  const cancelExport = () => { abortRef.current = true; };

  return (
    <div className="p-5 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet size={22} className="text-amber-400" /> Export Data
          </h1>
          <p className="text-sm text-gray-400 mt-1">Export filtered watch listings to CSV or Excel (.xlsx)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters Panel */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Filter size={14} /> Filters
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Brand</label>
                <select value={filters.brand} onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none">
                  {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Verdict</label>
                <select value={filters.verdict} onChange={e => setFilters(f => ({ ...f, verdict: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none">
                  {VERDICTS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Min Price</label>
                  <input type="number" value={filters.minPrice} onChange={e => setFilters(f => ({ ...f, minPrice: e.target.value }))}
                    placeholder="0" className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white font-mono focus:border-amber-400 outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Max Price</label>
                  <input type="number" value={filters.maxPrice} onChange={e => setFilters(f => ({ ...f, maxPrice: e.target.value }))}
                    placeholder="∞" className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white font-mono focus:border-amber-400 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">From Date</label>
                  <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">To Date</label>
                  <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Max Records</label>
                <select value={filters.limit} onChange={e => setFilters(f => ({ ...f, limit: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none">
                  <option value="1000">1,000</option>
                  <option value="5000">5,000</option>
                  <option value="10000">10,000</option>
                  <option value="50000">50,000</option>
                  <option value="100000">100,000</option>
                  <option value="2392784">All (2.39M)</option>
                </select>
              </div>

              <button onClick={() => setFilters({ brand: 'All', verdict: 'All', minPrice: '', maxPrice: '', dateFrom: '', dateTo: '', limit: '50000' })}
                className="w-full py-2 border border-gray-700 rounded text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
                Clear All Filters
              </button>
            </div>
          </div>

          {/* Format Selector */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mt-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Package size={14} /> Export Format
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setExportFormat('csv')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                  exportFormat === 'csv'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-[#1A1A24] border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                <FileText size={14} /> CSV
              </button>
              <button
                onClick={() => setExportFormat('excel')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                  exportFormat === 'excel'
                    ? 'bg-green-500/20 border-green-500 text-green-400'
                    : 'bg-[#1A1A24] border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                <FileSpreadsheet size={14} /> Excel (.xlsx)
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {exportFormat === 'excel'
                ? 'Exports as styled Excel with gold headers & auto-sized columns'
                : 'Exports as UTF-8 CSV with BOM -- opens directly in Excel'}
            </p>
          </div>
        </div>

        {/* Export Panel */}
        <div className="lg:col-span-2">
          {/* Regular Export Button */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-4 flex-wrap">
              <button onClick={doExport} disabled={exporting}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting && !exportingAll ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting && !exportingAll ? `Exporting ${exportFormat.toUpperCase()}...` : `Export ${exportFormat === 'excel' ? 'to Excel' : 'to CSV'}`}
              </button>
              {exporting && !exportingAll && (
                <button onClick={cancelExport}
                  className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors flex items-center gap-2">
                  <X size={16} /> Cancel
                </button>
              )}
            </div>

            {/* Progress */}
            {exporting && !exportingAll && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()} records</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${progress.percent}%` }} className="h-full bg-amber-400 rounded-full" />
                </div>
                {progress.eta && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                    <Timer size={10} /> ETA: {progress.eta}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Export ALL Records Button */}
          <div className="bg-gray-900 border border-amber-500/30 rounded-lg p-4 mb-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-16 translate-x-16 pointer-events-none" />
            <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Database size={14} /> Export ALL Records
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              One-click export of all {TOTAL_RECORDS.toLocaleString()} records with progress tracking.
              This will fetch data in {Math.ceil(TOTAL_RECORDS / BATCH_SIZE).toLocaleString()} batches of {BATCH_SIZE.toLocaleString()}.
              Format: <span className="text-amber-400 font-semibold">{exportFormat.toUpperCase()}</span>
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <button onClick={doExportAll} disabled={exportingAll || exporting}
                className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20">
                {exportingAll ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
                {exportingAll ? `Fetching ${progress.current.toLocaleString()}...` : `Export ALL (${exportFormat.toUpperCase()})`}
              </button>
              {exportingAll && (
                <button onClick={cancelExport}
                  className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors flex items-center gap-2">
                  <CircleOff size={16} /> Cancel
                </button>
              )}
            </div>

            {/* Full Export Progress */}
            {exportingAll && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Batch {Math.ceil(progress.current / BATCH_SIZE)} / {Math.ceil(TOTAL_RECORDS / BATCH_SIZE)} · {progress.current.toLocaleString()} / {progress.total.toLocaleString()} records</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${progress.percent}%` }} className="h-full bg-amber-500 rounded-full" />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Timer size={10} /> ETA: {progress.eta}
                  </div>
                  <div className="text-xs text-gray-500">
                    {exportFormat === 'excel' ? 'Building .xlsx file...' : 'Building CSV...'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Columns Preview */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Database size={14} /> Export Columns ({COLUMNS.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {COLUMNS.map(col => (
                <span key={col.key} className="px-2 py-1 bg-[#1A1A24] rounded text-xs text-gray-400 border border-[#1E1E2E]">
                  {col.label}
                </span>
              ))}
            </div>
          </div>

          {/* Log */}
          {logs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-[300px] overflow-y-auto">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Export Log</h3>
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className={`text-[11px] font-mono ${log.includes('✅') ? 'text-green-400' : log.includes('❌') ? 'text-red-400' : log.includes('🚀') ? 'text-amber-400' : log.includes('Error') ? 'text-red-400' : 'text-gray-500'}`}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="mt-4 text-xs text-gray-600 space-y-1">
            <p className="flex items-center gap-1"><ArrowRight size={10} /> Format: {exportFormat === 'excel' ? 'Excel (.xlsx) with gold-styled headers' : 'UTF-8 CSV with BOM -- opens directly in Excel'}</p>
            <p className="flex items-center gap-1"><ArrowRight size={10} /> Batch size: {BATCH_SIZE.toLocaleString()} records per API call</p>
            <p className="flex items-center gap-1"><ArrowRight size={10} /> All {COLUMNS.length} columns included: brand, reference, dial, condition, year, price, verdict, source, dates, raw message</p>
          </div>
        </div>
      </div>
    </div>
  );
}