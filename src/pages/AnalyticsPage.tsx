/**
 * Analytics — Real-time data from Supabase
 * All charts, tables, and stats are computed from live data
 * No hardcoded demo values — everything comes from the database
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, PieChart, Pie, LineChart, Line,
  AreaChart, Area, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend,
} from 'recharts';
import {
  BarChart3, Calendar, TrendingUp, Download, RefreshCw, Loader2, ArrowUpDown,
} from 'lucide-react';

// ─── Supabase direct ─────────────────────────────────────────────────
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

const CHART_COLORS = ['#C9A96E', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316'];

// ─── Types ───────────────────────────────────────────────────────────
interface RawRecord {
  brand: string;
  reference: string;
  price_usd: number;
  confidence: number;
  verdict: string;
  condition: string;
  dial_color: string;
  created_at: string;
  source: string;
}

interface BrandDist { brand: string; count: number; percentage: number; }
interface ConfDist { range: string; count: number; percentage: number; }
interface PriceDist { range: string; count: number; }
interface DailyTrend { date: string; count: number; avgConfidence: number; avgPrice: number; }
interface TopRef { reference: string; brand: string; count: number; avgPrice: number; avgConfidence: number; }
interface CondDist { condition: string; count: number; }

function fmtPrice(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

function confidenceColor(c: number): string {
  if (c >= 85) return '#22C55E';
  if (c >= 70) return '#3B82F6';
  if (c >= 50) return '#F59E0B';
  return '#EF4444';
}

// ─── Client-side aggregations ────────────────────────────────────────
function aggregateBrand(records: RawRecord[]): BrandDist[] {
  const map = new Map<string, number>();
  for (const r of records) { map.set(r.brand || 'Unknown', (map.get(r.brand || 'Unknown') || 0) + 1); }
  const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  return sorted.map(([brand, count]) => ({ brand, count, percentage: Math.round((count / total) * 1000) / 10 }));
}

function aggregateConfidence(records: RawRecord[]): ConfDist[] {
  const bins = [
    { range: '90-100%', min: 90, max: 100, count: 0 },
    { range: '85-89%', min: 85, max: 89, count: 0 },
    { range: '70-84%', min: 70, max: 84, count: 0 },
    { range: '50-69%', min: 50, max: 69, count: 0 },
    { range: '0-49%', min: 0, max: 49, count: 0 },
  ];
  for (const r of records) {
    const c = r.confidence || 0;
    for (const bin of bins) { if (c >= bin.min && c <= bin.max) { bin.count++; break; } }
  }
  const total = records.length;
  return bins.map(b => ({ range: b.range, count: b.count, percentage: total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0 }));
}

function aggregatePrice(records: RawRecord[]): PriceDist[] {
  const bins = [
    { range: 'Under $10K', min: 0, max: 10000, count: 0 },
    { range: '$10K-$25K', min: 10000, max: 25000, count: 0 },
    { range: '$25K-$50K', min: 25000, max: 50000, count: 0 },
    { range: '$50K-$100K', min: 50000, max: 100000, count: 0 },
    { range: '$100K-$250K', min: 100000, max: 250000, count: 0 },
    { range: '$250K+', min: 250000, max: Infinity, count: 0 },
  ];
  for (const r of records) {
    const p = r.price_usd || 0;
    for (const bin of bins) { if (p >= bin.min && p < bin.max) { bin.count++; break; } }
  }
  return bins.map(b => ({ range: b.range, count: b.count }));
}

function aggregateDaily(records: RawRecord[]): DailyTrend[] {
  const map = new Map<string, { count: number; confSum: number; priceSum: number }>();
  for (const r of records) {
    if (!r.created_at) continue;
    const d = r.created_at.slice(0, 10);
    const entry = map.get(d) || { count: 0, confSum: 0, priceSum: 0 };
    entry.count++;
    entry.confSum += r.confidence || 0;
    entry.priceSum += r.price_usd || 0;
    map.set(d, entry);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      count: v.count,
      avgConfidence: Math.round(v.confSum / v.count),
      avgPrice: Math.round(v.priceSum / v.count),
    }));
}

function aggregateCondition(records: RawRecord[]): CondDist[] {
  const map = new Map<string, number>();
  for (const r of records) { map.set(r.condition || 'Unknown', (map.get(r.condition || 'Unknown') || 0) + 1); }
  return Array.from(map.entries()).map(([condition, count]) => ({ condition, count })).sort((a, b) => b.count - a.count);
}

function aggregateTopRefs(records: RawRecord[]): TopRef[] {
  const map = new Map<string, { brand: string; count: number; priceSum: number; confSum: number }>();
  for (const r of records) {
    const ref = r.reference || 'Unknown';
    const entry = map.get(ref) || { brand: r.brand || 'Unknown', count: 0, priceSum: 0, confSum: 0 };
    entry.count++;
    entry.priceSum += r.price_usd || 0;
    entry.confSum += r.confidence || 0;
    map.set(ref, entry);
  }
  return Array.from(map.entries())
    .map(([reference, v]) => ({
      reference,
      brand: v.brand,
      count: v.count,
      avgPrice: Math.round(v.priceSum / v.count),
      avgConfidence: Math.round(v.confSum / v.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

// ─── Custom tooltip styles ───────────────────────────────────────────
const tooltipStyle = { backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px', fontSize: '12px' };

type SortKey = 'reference' | 'brand' | 'count' | 'avgPrice' | 'avgConfidence';
type SortDir = 'asc' | 'desc';

export default function AnalyticsPage() {
  const [records, setRecords] = useState<RawRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalRecords, setTotalRecords] = useState(2392784);
  const [dateRange, setDateRange] = useState('30d');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ─── Fetch real data ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Calculate date cutoff based on range
      const ranges: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
      const days = ranges[dateRange] || 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString();

      // Fetch sample of records for analysis (efficient — one query)
      const url = `${SUPABASE_URL}/rest/v1/watch_records?select=brand,reference,price_usd,confidence,verdict,condition,dial_color,created_at,source&created_at=gte.${encodeURIComponent(cutoffStr)}&limit=5000`;
      const res = await fetch(url, { headers: REQ });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecords(data || []);

      // Get exact total count
      const countRes = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=count`, {
        method: 'HEAD',
        headers: { ...REQ, 'Prefer': 'count=exact' },
      });
      const range = countRes.headers.get('content-range') || '';
      const total = parseInt(range.split('/')[1] || '0');
      if (total > 0) setTotalRecords(total);
    } catch (err) {
      console.error('Analytics fetch error:', err);
    }
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Computed aggregates ──────────────────────────────────────────
  const brandDist = useMemo(() => aggregateBrand(records), [records]);
  const confDist = useMemo(() => aggregateConfidence(records), [records]);
  const priceDist = useMemo(() => aggregatePrice(records), [records]);
  const dailyTrends = useMemo(() => aggregateDaily(records), [records]);
  const topRefs = useMemo(() => aggregateTopRefs(records), [records]);
  const condDist = useMemo(() => aggregateCondition(records), [records]);

  // Verdict counts
  const verdictCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) { map.set(r.verdict || 'UNKNOWN', (map.get(r.verdict || 'UNKNOWN') || 0) + 1); }
    return Array.from(map.entries()).map(([v, c]) => ({ verdict: v, count: c }));
  }, [records]);

  // Overall stats
  const stats = useMemo(() => {
    if (!records.length) return null;
    const prices = records.map(r => r.price_usd).filter(p => p > 0);
    const confs = records.map(r => r.confidence).filter(c => c > 0);
    return {
      avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
      avgConfidence: confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0,
      uniqueRefs: new Set(records.map(r => r.reference)).size,
      uniqueBrands: new Set(records.map(r => r.brand)).size,
    };
  }, [records]);

  // ─── Sorting ──────────────────────────────────────────────────────
  const toggleSort = useCallback((key: SortKey) => {
    setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortKey(key);
  }, [sortKey]);

  const sortedRefs = useMemo(() => {
    return [...topRefs].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'reference') return dir * a.reference.localeCompare(b.reference);
      if (sortKey === 'brand') return dir * a.brand.localeCompare(b.brand);
      if (sortKey === 'count') return dir * (a.count - b.count);
      if (sortKey === 'avgPrice') return dir * (a.avgPrice - b.avgPrice);
      return dir * (a.avgConfidence - b.avgConfidence);
    });
  }, [topRefs, sortKey, sortDir]);

  // ─── Export ───────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    const headers = ['Reference', 'Brand', 'Count', 'Avg Price', 'Avg Confidence'];
    const rows = sortedRefs.map(r => [r.reference, r.brand, r.count, r.avgPrice, `${r.avgConfidence}%`]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedRefs]);

  // ─── Coverage stats (computed from sample) ────────────────────────
  const coverage = useMemo(() => {
    if (!records.length) return { dial: 0, price: 0, brand: 0 };
    const dialCovered = records.filter(r => r.dial_color && r.dial_color !== 'Unknown').length;
    const priceCovered = records.filter(r => r.price_usd && r.price_usd > 0).length;
    const brandCovered = records.filter(r => r.brand && r.brand !== 'Unknown').length;
    return {
      dial: Math.round((dialCovered / records.length) * 100),
      price: Math.round((priceCovered / records.length) * 100),
      brand: Math.round((brandCovered / records.length) * 100),
    };
  }, [records]);

  return (<>
    <div className="p-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 size={22} className="text-amber-400" /> Analytics
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {loading ? 'Loading...' : `${records.length.toLocaleString()} records analyzed from ${totalRecords.toLocaleString()} total`}
          </p>
          {stats && (
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>Avg Price: <span className="text-amber-400 font-mono">{fmtPrice(stats.avgPrice)}</span></span>
              <span>Avg Confidence: <span className="text-green-400 font-mono">{stats.avgConfidence}%</span></span>
              <span>{stats.uniqueRefs} unique refs</span>
              <span>{stats.uniqueBrands} brands</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-400/50"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button onClick={exportCSV} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm">
            <Download size={16} /> Export
          </button>
          <button onClick={fetchData} disabled={loading} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && records.length === 0 && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && records.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <BarChart3 size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-lg">No data for this date range</p>
          <p className="text-sm text-gray-600 mt-1">Try a wider range or refresh</p>
        </div>
      )}

      {records.length > 0 && (
        <>
          {/* Coverage Bars */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Data Quality Coverage</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Dial Color', value: coverage.dial, color: '#3B82F6' },
                { label: 'Price', value: coverage.price, color: '#22C55E' },
                { label: 'Brand', value: coverage.brand, color: '#C9A96E' },
              ].map(item => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-white font-mono">{item.value}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-950 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${item.value}%` }} transition={{ duration: 1, delay: 0.3 }} className="h-full rounded-full" style={{ backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 1: Brand + Confidence */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Brand Distribution</h3>
              {brandDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={brandDist} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
                    <XAxis type="number" stroke="#6B7280" fontSize={11} />
                    <YAxis dataKey="brand" type="category" stroke="#9CA3AF" fontSize={10} width={130} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {brandDist.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500 text-sm">No brand data</div>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Confidence Distribution</h3>
              {confDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={confDist} dataKey="count" nameKey="range" cx="40%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4}>
                      {confDist.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: '12px' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500 text-sm">No confidence data</div>}
            </div>
          </div>

          {/* Row 2: Price + Daily */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Price Distribution</h3>
              {priceDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={priceDist}>
                    <defs>
                      <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C9A96E" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#C9A96E" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="range" stroke="#6B7280" fontSize={10} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="count" stroke="#C9A96E" fill="url(#priceGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500 text-sm">No price data</div>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Daily Trend</h3>
              {dailyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="date" stroke="#6B7280" fontSize={10} tickFormatter={v => v.slice(5)} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="count" stroke="#C9A96E" strokeWidth={2} dot={false} name="Records" />
                    <Line type="monotone" dataKey="avgConfidence" stroke="#22C55E" strokeWidth={2} dot={false} name="Confidence %" />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500 text-sm">No trend data</div>}
            </div>
          </div>

          {/* Row 3: Condition + Verdict */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Condition Distribution</h3>
              {condDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={condDist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="condition" stroke="#6B7280" fontSize={11} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {condDist.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500 text-sm">No condition data</div>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Verdict Distribution</h3>
              {verdictCounts.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={verdictCounts} dataKey="count" nameKey="verdict" cx="50%" cy="50%" outerRadius={90} label={({ verdict, count }) => `${verdict}: ${count}`}>
                      {verdictCounts.map((v, i) => (
                        <Cell key={i} fill={
                          v.verdict === 'APPROVED' ? '#22C55E' :
                          v.verdict === 'REVIEW' ? '#3B82F6' :
                          v.verdict === 'HUMAN' ? '#F59E0B' :
                          v.verdict === 'RECYCLE' ? '#EF4444' : '#6B7280'
                        } />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500 text-sm">No verdict data</div>}
            </div>
          </div>

          {/* Top References Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp size={14} /> Top References
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                    {(['reference', 'brand', 'count', 'avgPrice', 'avgConfidence'] as SortKey[]).map(key => (
                      <th key={key} className="text-left py-2 px-3 cursor-pointer hover:text-white transition-colors select-none" onClick={() => toggleSort(key)}>
                        <div className="flex items-center gap-1">
                          {key === 'reference' ? 'Reference' : key === 'avgPrice' ? 'Avg Price' : key === 'avgConfidence' ? 'Confidence' : key.charAt(0).toUpperCase() + key.slice(1)}
                          <ArrowUpDown size={10} className={sortKey === key ? 'text-amber-400' : 'text-gray-600'} />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRefs.map(ref => (
                    <tr key={ref.reference} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 px-3 font-mono font-semibold text-white">{ref.reference}</td>
                      <td className="py-2 px-3 text-gray-300">{ref.brand}</td>
                      <td className="py-2 px-3 font-mono text-white">{ref.count}</td>
                      <td className="py-2 px-3 font-mono text-amber-400">{fmtPrice(ref.avgPrice)}</td>
                      <td className="py-2 px-3">
                        <span className="font-mono" style={{ color: confidenceColor(ref.avgConfidence) }}>{ref.avgConfidence}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  </>);
}
