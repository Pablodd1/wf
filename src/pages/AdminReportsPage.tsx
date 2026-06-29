/**
 * Reports — Date-range reports for management review
 * Report types: Ingestion, Data Quality, Verdict Distribution, Price Movement
 * All data from Supabase. Export to JSON/CSV.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Download, Calendar, Loader2, FileJson, FileSpreadsheet,
  TrendingUp, Database, Shield, AlertTriangle, BarChart3,
  RefreshCw, ChevronRight,
} from 'lucide-react';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

interface ReportRecord {
  brand: string;
  reference: string;
  price_usd: number;
  confidence: number;
  verdict: string;
  condition: string;
  dial_color: string;
  source: string;
  created_at: string;
  raw_message: string;
}

function fmtPrice(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
}

// ─── Date helpers ────────────────────────────────────────────────────
function getDateRange(range: string): { start: string; end: string; label: string } {
  const end = new Date();
  const start = new Date();
  let label = '';
  switch (range) {
    case '24h': start.setDate(end.getDate() - 1); label = 'Last 24 Hours'; break;
    case '7d': start.setDate(end.getDate() - 7); label = 'Last 7 Days'; break;
    case '30d': start.setDate(end.getDate() - 30); label = 'Last 30 Days'; break;
    case '90d': start.setDate(end.getDate() - 90); label = 'Last 90 Days'; break;
    default: start.setDate(end.getDate() - 30); label = 'Last 30 Days';
  }
  return { start: start.toISOString(), end: end.toISOString(), label };
}

// ─── Report generators ───────────────────────────────────────────────
function generateIngestionReport(records: ReportRecord[]) {
  const byDay = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byBrand = new Map<string, number>();
  for (const r of records) {
    const day = r.created_at ? r.created_at.slice(0, 10) : 'unknown';
    byDay.set(day, (byDay.get(day) || 0) + 1);
    bySource.set(r.source || 'Unknown', (bySource.get(r.source || 'Unknown') || 0) + 1);
    byBrand.set(r.brand || 'Unknown', (byBrand.get(r.brand || 'Unknown') || 0) + 1);
  }
  return {
    totalRecords: records.length,
    byDay: Array.from(byDay.entries()).sort().map(([date, count]) => ({ date, count })),
    bySource: Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
    byBrand: Array.from(byBrand.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([brand, count]) => ({ brand, count })),
  };
}

function generateQualityReport(records: ReportRecord[]) {
  if (!records.length) return { brand: 0, reference: 0, price: 0, dial: 0, condition: 0, year: 0 };
  return {
    brand: Math.round((records.filter(r => r.brand && r.brand !== 'Unknown').length / records.length) * 100),
    reference: Math.round((records.filter(r => r.reference && r.reference !== 'Unknown').length / records.length) * 100),
    price: Math.round((records.filter(r => r.price_usd && r.price_usd > 0).length / records.length) * 100),
    dial: Math.round((records.filter(r => r.dial_color && r.dial_color !== 'Unknown').length / records.length) * 100),
    condition: Math.round((records.filter(r => r.condition && r.condition !== 'Unknown').length / records.length) * 100),
  };
}

function generateVerdictReport(records: ReportRecord[]) {
  const map = new Map<string, number>();
  for (const r of records) { map.set(r.verdict || 'UNKNOWN', (map.get(r.verdict || 'UNKNOWN') || 0) + 1); }
  return Array.from(map.entries()).map(([verdict, count]) => ({ verdict, count }));
}

function generatePriceReport(records: ReportRecord[]) {
  const byRef = new Map<string, { prices: number[]; brand: string }>();
  for (const r of records) {
    if (!r.reference || !r.price_usd) continue;
    const entry = byRef.get(r.reference) || { prices: [], brand: r.brand || '' };
    entry.prices.push(r.price_usd);
    byRef.set(r.reference, entry);
  }
  return Array.from(byRef.entries())
    .map(([reference, v]) => ({
      reference,
      brand: v.brand,
      count: v.prices.length,
      avg: Math.round(v.prices.reduce((a, b) => a + b, 0) / v.prices.length),
      min: Math.min(...v.prices),
      max: Math.max(...v.prices),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export default function AdminReportsPage() {
  const [dateRange, setDateRange] = useState('7d');
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeReport, setActiveReport] = useState('ingestion');

  const rangeInfo = useMemo(() => getDateRange(dateRange), [dateRange]);

  // ─── Fetch data ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${SUPABASE_URL}/rest/v1/watch_records?select=*&created_at=gte.${encodeURIComponent(rangeInfo.start)}&limit=5000`;
      const res = await fetch(url, { headers: REQ });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecords(data || []);
    } catch (err) {
      console.error('Report fetch error:', err);
      setRecords([]);
    }
    setLoading(false);
  }, [rangeInfo.start]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Generated reports ─────────────────────────────────────────────
  const ingestionReport = useMemo(() => generateIngestionReport(records), [records]);
  const qualityReport = useMemo(() => generateQualityReport(records), [records]);
  const verdictReport = useMemo(() => generateVerdictReport(records), [records]);
  const priceReport = useMemo(() => generatePriceReport(records), [records]);

  // ─── Export ────────────────────────────────────────────────────────
  const exportJSON = () => {
    const data = {
      generatedAt: new Date().toISOString(),
      dateRange: rangeInfo.label,
      recordCount: records.length,
      reports: { ingestion: ingestionReport, quality: qualityReport, verdict: verdictReport, priceMovement: priceReport },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Export ALL listings to Excel-compatible CSV ───────────────────
  const [exportingAll, setExportingAll] = useState(false);
  const exportCSV = async (allRecords: boolean = false) => {
    let dataToExport = records;
    if (allRecords) {
      setExportingAll(true);
      try {
        // Fetch up to 50,000 records for export
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/watch_records?select=*&limit=50000`,
          { headers: REQ }
        );
        dataToExport = await res.json();
      } catch {
        setExportingAll(false);
        return;
      }
      setExportingAll(false);
    }
    const rows = dataToExport.map(r => ({
      id: r.id,
      brand: r.brand || '',
      model: r.model || '',
      reference: r.reference || '',
      dial_color: r.dial_color || '',
      condition: r.condition || '',
      price_usd: r.price_usd || 0,
      currency: r.currency || '',
      year: r.year || '',
      confidence: r.confidence || 0,
      verdict: r.verdict || '',
      source: r.source || '',
      created_at: r.created_at || '',
      received_at: r.received_at || '',
      raw_message: (r.raw_message || '').replace(/[\n\r]/g, ' '),
    }));
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csvRows = rows.map(r => headers.map(h => {
      const val = String((r as any)[h] ?? '');
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(','));
    // UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-all-listings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const verdictColors: Record<string, string> = {
    APPROVED: '#22C55E', REVIEW: '#3B82F6', HUMAN: '#F59E0B', RECYCLE: '#EF4444',
  };

  const reportTabs = [
    { id: 'ingestion', label: 'Ingestion', icon: Database },
    { id: 'quality', label: 'Data Quality', icon: Shield },
    { id: 'verdict', label: 'Verdicts', icon: BarChart3 },
    { id: 'price', label: 'Price Movement', icon: TrendingUp },
  ];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet size={22} className="text-amber-400" /> Reports
          </h1>
          <p className="text-sm text-gray-400 mt-1">{rangeInfo.label} • {records.length.toLocaleString()} records</p>
        </div>
        <div className="flex gap-2">
          <select value={dateRange} onChange={e => setDateRange(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-400/50">
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
          <button onClick={exportJSON} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm">
            <FileJson size={16} /> JSON
          </button>
          <button onClick={() => exportCSV(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm">
            <FileSpreadsheet size={16} /> CSV (Current)
          </button>
          <button onClick={() => exportCSV(true)} disabled={exportingAll}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm disabled:opacity-50">
            {exportingAll ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {exportingAll ? 'Exporting...' : 'Excel Export ALL'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Calendar size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-lg">No records for this date range</p>
          <p className="text-sm text-gray-600 mt-1">Try a wider range</p>
        </div>
      ) : (
        <>
          {/* Report Tabs */}
          <div className="flex gap-1 mb-6 overflow-x-auto">
            {reportTabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveReport(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeReport === tab.id ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent'
                  }`}>
                  <Icon size={14} /> {tab.label}
                </button>
              );
            })}
          </div>

          {/* INGESTION REPORT */}
          {activeReport === 'ingestion' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-gray-500 uppercase mb-1">Total Records</div>
                  <div className="text-3xl font-bold text-white">{ingestionReport.totalRecords.toLocaleString()}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-gray-500 uppercase mb-1">Days with Data</div>
                  <div className="text-3xl font-bold text-amber-400">{ingestionReport.byDay.length}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-gray-500 uppercase mb-1">Sources</div>
                  <div className="text-3xl font-bold text-blue-400">{ingestionReport.bySource.length}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Daily Volume</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {ingestionReport.byDay.map(d => (
                      <div key={d.date} className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-24 font-mono">{d.date}</span>
                        <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${Math.min(100, (d.count / Math.max(...ingestionReport.byDay.map(x => x.count))) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-white font-mono w-8 text-right">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Top Sources</h3>
                  <div className="space-y-2">
                    {ingestionReport.bySource.map(s => (
                      <div key={s.source} className="flex items-center justify-between p-2 bg-gray-950 rounded">
                        <span className="text-sm text-white">{s.source}</span>
                        <span className="text-sm font-mono text-amber-400">{s.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* DATA QUALITY REPORT */}
          {activeReport === 'quality' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'Brand Coverage', value: qualityReport.brand, color: '#C9A96E' },
                  { label: 'Reference Coverage', value: qualityReport.reference, color: '#3B82F6' },
                  { label: 'Price Coverage', value: qualityReport.price, color: '#22C55E' },
                  { label: 'Dial Color Coverage', value: qualityReport.dial, color: '#F59E0B' },
                  { label: 'Condition Coverage', value: qualityReport.condition, color: '#8B5CF6' },
                ].map(item => (
                  <div key={item.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="text-[10px] text-gray-500 uppercase mb-2">{item.label}</div>
                    <div className="flex items-end gap-2 mb-2">
                      <span className="text-3xl font-bold" style={{ color: item.color }}>{item.value}%</span>
                      <span className="text-xs text-gray-500 mb-1">
                        {item.value >= 90 ? 'Good' : item.value >= 70 ? 'Fair' : 'Poor'}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${item.value}%` }} transition={{ duration: 1 }} className="h-full rounded-full" style={{ backgroundColor: item.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* VERDICT REPORT */}
          {activeReport === 'verdict' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {verdictReport.map(v => (
                  <div key={v.verdict} className="bg-gray-900 border border-gray-800 rounded-lg p-4"
                    style={{ borderColor: `${verdictColors[v.verdict] || '#6B7280'}30` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: verdictColors[v.verdict] || '#6B7280' }} />
                      <span className="text-sm font-medium text-white">{v.verdict}</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{v.count.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {records.length > 0 ? ((v.count / records.length) * 100).toFixed(1) : 0}% of total
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* PRICE MOVEMENT REPORT */}
          {activeReport === 'price' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800 bg-gray-950">
                      <th className="text-left py-3 px-4">Reference</th>
                      <th className="text-left py-3 px-4">Brand</th>
                      <th className="text-right py-3 px-4">Listings</th>
                      <th className="text-right py-3 px-4">Min</th>
                      <th className="text-right py-3 px-4">Avg</th>
                      <th className="text-right py-3 px-4">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceReport.map(p => (
                      <tr key={p.reference} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-semibold text-white">{p.reference}</td>
                        <td className="py-2.5 px-4 text-gray-300">{p.brand}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-white">{p.count}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-gray-400">{fmtPrice(p.min)}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-amber-400">{fmtPrice(p.avg)}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-gray-400">{fmtPrice(p.max)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
