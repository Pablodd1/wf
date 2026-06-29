/**
 * Analytics — Uses Supabase MATERIALIZED VIEWS for instant loading
 * All data pre-computed server-side via PostgreSQL GROUP BY
 * Views auto-refresh every 15 minutes via Cron
 * Dashboard loads in < 100ms regardless of dataset size (2.39M+ rows)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, PieChart, Pie, LineChart, Line,
  AreaChart, Area, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend,
} from 'recharts';
import {
  BarChart3, Download, Loader2, ArrowUpDown, Database, Shield,
  TrendingUp, Clock, RefreshCw, AlertTriangle, Zap,
} from 'lucide-react';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

const CHART_COLORS = ['#C9A96E', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#06B6D4'];

function fmtPrice(n: number): string {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

// ─── Types ───────────────────────────────────────────────────────────
interface StatsSummary { total_records: number; unique_brands: number; unique_refs: number; avg_price: number; min_price: number; max_price: number; }
interface BrandDist { brand: string; count: number; }
interface VerdictDist { verdict: string; count: number; }
interface CondDist { condition: string; count: number; }
interface DialDist { dial_color: string; count: number; }
interface TopRef { reference: string; brand: string; count: number; avg_price: number; }
interface PriceBucket { price_range: string; count: number; }

type SortKey = 'reference' | 'brand' | 'count' | 'avgPrice';

// ─── Data fetchers (query materialized views, not raw table) ─────────
const fetcher = async (view: string): Promise<any[]> => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*&limit=100`, { headers: REQ });
  if (!res.ok) throw new Error(`${view}: HTTP ${res.status}`);
  return res.json();
};

const verdictColors: Record<string, string> = {
  APPROVED: '#22C55E', REVIEW: '#3B82F6', HUMAN: '#F59E0B', RECYCLE: '#EF4444',
};

const tooltipStyle = { backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px', fontSize: '12px', color: '#fff' };

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [brandDist, setBrandDist] = useState<BrandDist[]>([]);
  const [verdictDist, setVerdictDist] = useState<VerdictDist[]>([]);
  const [condDist, setCondDist] = useState<CondDist[]>([]);
  const [dialDist, setDialDist] = useState<DialDist[]>([]);
  const [topRefs, setTopRefs] = useState<TopRef[]>([]);
  const [priceDist, setPriceDist] = useState<PriceBucket[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // ─── Load from MATERIALIZED VIEWS (pre-computed) ──────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const [s, b, v, c, d, r, p] = await Promise.all([
        fetcher('mv_stats_summary'),
        fetcher('mv_brand_dist'),
        fetcher('mv_verdict_dist'),
        fetcher('mv_cond_dist'),
        fetcher('mv_dial_dist'),
        fetcher('mv_top_refs'),
        fetcher('mv_price_buckets'),
      ]);
      setStats(s[0] || null);
      setBrandDist((b || []).filter((x: any) => x.count > 0));
      setVerdictDist(v || []);
      setCondDist((c || []).filter((x: any) => x.count > 0));
      setDialDist((d || []).filter((x: any) => x.count > 0));
      setTopRefs((r || []).filter((x: any) => x.count > 0));
      setPriceDist(p || []);
      setLastRefreshed(new Date().toLocaleTimeString());
      const ms = Math.round(performance.now() - start);
      console.log(`Analytics loaded from materialized views in ${ms}ms`);
    } catch (err) {
      console.error('Analytics load error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── Sorting ────────────────────────────────────────────────────────
  const toggleSort = (key: SortKey) => {
    setSortDir(d => sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortKey(key);
  };
  const sortedRefs = useMemo(() => {
    return [...topRefs].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'reference') return dir * a.reference.localeCompare(b.reference);
      if (sortKey === 'brand') return dir * a.brand.localeCompare(b.brand);
      if (sortKey === 'count') return dir * (a.count - b.count);
      return dir * (a.avg_price - b.avg_price);
    });
  }, [topRefs, sortKey, sortDir]);

  // ─── Export ─────────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    const headers = ['Reference', 'Brand', 'Listings', 'Avg Price'];
    const rows = sortedRefs.map(r => [r.reference, r.brand, r.count, r.avg_price]);
    const csv = ['\uFEFF' + headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedRefs]);

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 size={22} className="text-amber-400" /> Analytics
          </h1>
          <div className="flex items-center gap-3 mt-1 text-xs">
            <span className="text-gray-400">
              {loading ? 'Loading...' : stats ? `${(stats.total_records || 0).toLocaleString()} records analyzed` : ''}
            </span>
            {lastRefreshed && (
              <span className="text-gray-600 flex items-center gap-1">
                <Clock size={10} /> Refreshed: {lastRefreshed}
              </span>
            )}
            {!loading && <span className="text-green-400 flex items-center gap-1"><Zap size={10} /> Materialized Views</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm">
            <Download size={16} /> Export
          </button>
          <button onClick={loadAll} disabled={loading} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <span className="ml-3 text-gray-400 text-sm">Loading from materialized views...</span>
        </div>
      ) : !stats ? (
        <div className="text-center py-20 text-gray-500">
          <AlertTriangle size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-lg">No data available</p>
          <p className="text-sm text-gray-600 mt-1">Materialized views may need to be refreshed</p>
          <button onClick={loadAll} className="mt-4 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm">Retry</button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {[
              { label: 'Total Records', value: (stats.total_records || 0).toLocaleString(), color: 'text-white' },
              { label: 'Brands', value: (stats.unique_brands || 0).toLocaleString(), color: 'text-amber-400' },
              { label: 'References', value: (stats.unique_refs || 0).toLocaleString(), color: 'text-blue-400' },
              { label: 'Avg Price', value: fmtPrice(stats.avg_price || 0), color: 'text-green-400' },
              { label: 'Price Range', value: `${fmtPrice(stats.min_price || 0)} - ${fmtPrice(stats.max_price || 0)}`, color: 'text-amber-400' },
            ].map(card => (
              <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-[10px] text-gray-500 uppercase mb-1">{card.label}</div>
                <div className={`text-lg font-bold font-mono ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Row 1: Brand + Verdict */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Brand Distribution</h3>
              {brandDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={brandDist.slice(0, 15)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
                    <XAxis type="number" stroke="#6B7280" fontSize={11} />
                    <YAxis dataKey="brand" type="category" stroke="#9CA3AF" fontSize={10} width={120} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {brandDist.slice(0, 15).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500">No data</div>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Verdict Distribution</h3>
              {verdictDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={verdictDist} dataKey="count" nameKey="verdict" cx="40%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4}>
                      {verdictDist.map((v, i) => <Cell key={i} fill={verdictColors[v.verdict] || CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: '12px' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500">No data</div>}
            </div>
          </div>

          {/* Row 2: Price + Condition */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Price Distribution</h3>
              {priceDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={priceDist}>
                    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#C9A96E" stopOpacity={0.3} /><stop offset="95%" stopColor="#C9A96E" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="price_range" stroke="#6B7280" fontSize={10} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="count" stroke="#C9A96E" fill="url(#pg)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500">No data</div>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Condition Distribution</h3>
              {condDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
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
              ) : <div className="text-center py-10 text-gray-500">No data</div>}
            </div>
          </div>

          {/* Row 3: Dial Color + Top References */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Dial Color Distribution</h3>
              {dialDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={dialDist.slice(0, 10)} dataKey="count" nameKey="dial_color" cx="50%" cy="50%" outerRadius={90} label={({ dial_color, count }: any) => `${dial_color}: ${(count || 0).toLocaleString()}`}>
                      {dialDist.slice(0, 10).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-10 text-gray-500">No data</div>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Shield size={14} /> Data Source Info
              </h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <Database size={14} /> Using Materialized Views (pre-computed)
                </div>
                <div className="text-xs text-gray-500">
                  Analytics data is pre-aggregated via PostgreSQL materialized views that refresh every 15 minutes. This ensures instant loading regardless of dataset size.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-950 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Min Price</div>
                    <div className="text-xl font-bold font-mono text-white">{fmtPrice(stats.min_price || 0)}</div>
                  </div>
                  <div className="bg-gray-950 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Max Price</div>
                    <div className="text-xl font-bold font-mono text-white">{fmtPrice(stats.max_price || 0)}</div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-600 flex items-center gap-1">
                  <RefreshCw size={10} /> Auto-refreshes every 15 min via Cron
                </div>
              </div>
            </div>
          </div>

          {/* Top References Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp size={14} /> Top {topRefs.length} References
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                    {(['reference', 'brand', 'count', 'avgPrice'] as SortKey[]).map(key => (
                      <th key={key} className="text-left py-2 px-3 cursor-pointer hover:text-white transition-colors select-none" onClick={() => toggleSort(key)}>
                        <div className="flex items-center gap-1">
                          {key === 'reference' ? 'Reference' : key === 'avgPrice' ? 'Avg Price' : key.charAt(0).toUpperCase() + key.slice(1)}
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
                      <td className="py-2 px-3 font-mono text-white">{(ref.count || 0).toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono text-amber-400">{fmtPrice(ref.avg_price || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
