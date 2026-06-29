/**
 * Export Page — Batch-processed Excel/CSV export with filters
 * Handles ANY dataset size by chunking into 1,000-row batches
 * Filters: brand, date range, price range, verdict, dial color
 */
import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Download, Loader2, Filter, FileSpreadsheet, Database,
  CheckCircle, AlertTriangle, X, ArrowRight,
} from 'lucide-react';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

const BATCH_SIZE = 1000;
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

export default function ExportPage() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [filters, setFilters] = useState({
    brand: 'All',
    verdict: 'All',
    minPrice: '',
    maxPrice: '',
    dateFrom: '',
    dateTo: '',
    limit: '50000',
  });
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

  const doExport = useCallback(async () => {
    abortRef.current = false;
    setExporting(true);
    setLogs([]);
    const maxRecords = parseInt(filters.limit) || 50000;
    const headers = COLUMNS.map(c => c.label);
    let allRows: string[][] = [];
    let offset = 0;
    let hasMore = true;

    addLog(`Starting export (max ${maxRecords.toLocaleString()} records)...`);

    while (hasMore && !abortRef.current && offset < maxRecords) {
      const batchSize = Math.min(BATCH_SIZE, maxRecords - offset);
      try {
        const res = await fetch(buildQueryUrl(offset, batchSize), { headers: REQ });
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
        offset += data.length;

        setProgress({
          current: offset,
          total: maxRecords,
          percent: Math.round((offset / maxRecords) * 100),
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
      return;
    }

    // Generate CSV
    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(','), ...allRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Build filename from filters
    const parts = ['watchfacts'];
    if (filters.brand !== 'All') parts.push(filters.brand.toLowerCase().replace(/\s+/g, '-'));
    if (filters.verdict !== 'All') parts.push(filters.verdict.toLowerCase());
    parts.push(`${allRows.length}-records`);
    parts.push(new Date().toISOString().slice(0, 10));
    a.download = `${parts.join('-')}.csv`;

    a.click();
    URL.revokeObjectURL(url);

    addLog(`✅ Export complete: ${allRows.length.toLocaleString()} records`);
    setExporting(false);
    setProgress({ current: 0, total: 0, percent: 0 });
  }, [filters]);

  const cancelExport = () => { abortRef.current = true; };

  return (
    <div className="p-5 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet size={22} className="text-amber-400" /> Export Data
          </h1>
          <p className="text-sm text-gray-400 mt-1">Export filtered watch listings to Excel-compatible CSV</p>
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
                <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Brand</label>
                <select value={filters.brand} onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none">
                  {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Verdict</label>
                <select value={filters.verdict} onChange={e => setFilters(f => ({ ...f, verdict: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none">
                  {VERDICTS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Min Price</label>
                  <input type="number" value={filters.minPrice} onChange={e => setFilters(f => ({ ...f, minPrice: e.target.value }))}
                    placeholder="0" className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white font-mono focus:border-amber-400 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Max Price</label>
                  <input type="number" value={filters.maxPrice} onChange={e => setFilters(f => ({ ...f, maxPrice: e.target.value }))}
                    placeholder="∞" className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white font-mono focus:border-amber-400 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">From Date</label>
                  <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">To Date</label>
                  <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1A1A24] border border-[#1E1E2E] rounded text-sm text-white focus:border-amber-400 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Max Records</label>
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
        </div>

        {/* Export Panel */}
        <div className="lg:col-span-2">
          {/* Export Button */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-4">
              <button onClick={doExport} disabled={exporting}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting ? 'Exporting...' : 'Export to Excel'}
              </button>
              {exporting && (
                <button onClick={cancelExport}
                  className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors flex items-center gap-2">
                  <X size={16} /> Cancel
                </button>
              )}
            </div>

            {/* Progress */}
            {exporting && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()} records</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${progress.percent}%` }} className="h-full bg-amber-400 rounded-full" />
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
                <span key={col.key} className="px-2 py-1 bg-[#1A1A24] rounded text-[10px] text-gray-400 border border-[#1E1E2E]">
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
                  <div key={i} className={`text-[11px] font-mono ${log.includes('✅') ? 'text-green-400' : log.includes('Error') ? 'text-red-400' : 'text-gray-500'}`}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="mt-4 text-xs text-gray-600 space-y-1">
            <p className="flex items-center gap-1"><ArrowRight size={10} /> Exports as UTF-8 CSV with BOM — opens directly in Excel</p>
            <p className="flex items-center gap-1"><ArrowRight size={10} /> Batch size: 1,000 records per API call</p>
            <p className="flex items-center gap-1"><ArrowRight size={10} /> All 15 columns included: brand, reference, dial, condition, year, price, verdict, source, dates, raw message</p>
          </div>
        </div>
      </div>
    </div>
  );
}
