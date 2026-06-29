import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, PieChart, Pie, LineChart, Line,
  AreaChart, Area, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  Legend,
} from 'recharts';
import {
  BarChart3, Calendar, TrendingUp, Download, RefreshCw, Loader2, AlertCircle, ArrowUpDown,
} from 'lucide-react';
import type { DashboardStats } from '@/types';
import { formatPrice, confidenceColor } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';

const CHART_COLORS = ['#C9A96E', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316'];

const fullDemoStats: DashboardStats = {
  totalRecords: 1247,
  approvedRate: 68,
  humanReview: 189,
  recycled: 87,
  avgPrice: 84320,
  avgConfidence: 76,
  brandDistribution: [
    { brand: 'Patek Philippe', count: 423, percentage: 33.9 },
    { brand: 'Rolex', count: 312, percentage: 25.0 },
    { brand: 'Audemars Piguet', count: 198, percentage: 15.9 },
    { brand: 'Richard Mille', count: 134, percentage: 10.7 },
    { brand: 'Vacheron Constantin', count: 89, percentage: 7.1 },
    { brand: 'A. Lange & Sohne', count: 34, percentage: 2.7 },
    { brand: 'Breguet', count: 28, percentage: 2.2 },
    { brand: 'Others', count: 29, percentage: 2.3 },
  ],
  confidenceDistribution: [
    { range: '90-100%', min: 90, max: 100, count: 312, percentage: 25.0 },
    { range: '85-89%', min: 85, max: 89, count: 198, percentage: 15.9 },
    { range: '70-84%', min: 70, max: 84, count: 348, percentage: 27.9 },
    { range: '50-69%', min: 50, max: 69, count: 189, percentage: 15.2 },
    { range: '0-49%', min: 0, max: 49, count: 200, percentage: 16.0 },
  ],
  priceDistribution: [
    { range: 'Under $10K', min: 0, max: 10000, count: 98 },
    { range: '$10K-$25K', min: 10000, max: 25000, count: 187 },
    { range: '$25K-$50K', min: 25000, max: 50000, count: 256 },
    { range: '$50K-$100K', min: 50000, max: 100000, count: 312 },
    { range: '$100K-$250K', min: 100000, max: 250000, count: 234 },
    { range: '$250K+', min: 250000, max: 10000000, count: 160 },
  ],
  dailyTrends: Array.from({ length: 30 }, (_, i) => {
    const date = new Date('2026-05-28');
    date.setDate(date.getDate() + i);
    return {
      date: date.toISOString().slice(0, 10),
      count: 30 + Math.floor(Math.random() * 40),
      avgConfidence: 70 + Math.floor(Math.random() * 15),
      avgPrice: 60000 + Math.floor(Math.random() * 50000),
    };
  }),
  topReferences: [
    { reference: '5711/1A', brand: 'Patek Philippe', count: 34, avgPrice: 185000, avgConfidence: 92 },
    { reference: '126610LN', brand: 'Rolex', count: 28, avgPrice: 14200, avgConfidence: 88 },
    { reference: '15202ST', brand: 'Audemars Piguet', count: 26, avgPrice: 98700, avgConfidence: 90 },
    { reference: 'RM11-03', brand: 'Richard Mille', count: 22, avgPrice: 385000, avgConfidence: 85 },
    { reference: '116500LN', brand: 'Rolex', count: 21, avgPrice: 28500, avgConfidence: 91 },
    { reference: '5712R', brand: 'Patek Philippe', count: 19, avgPrice: 124000, avgConfidence: 89 },
    { reference: '15500ST', brand: 'Audemars Piguet', count: 18, avgPrice: 56200, avgConfidence: 87 },
    { reference: '4500V', brand: 'Vacheron Constantin', count: 16, avgPrice: 28900, avgConfidence: 86 },
    { reference: '126710BLNR', brand: 'Rolex', count: 15, avgPrice: 18500, avgConfidence: 88 },
    { reference: '5167A', brand: 'Patek Philippe', count: 14, avgPrice: 45200, avgConfidence: 84 },
    { reference: '5740/1G', brand: 'Patek Philippe', count: 13, avgPrice: 210000, avgConfidence: 93 },
    { reference: '26240ST', brand: 'Audemars Piguet', count: 12, avgPrice: 67800, avgConfidence: 85 },
    { reference: '126613LB', brand: 'Rolex', count: 12, avgPrice: 18600, avgConfidence: 87 },
    { reference: '7900V', brand: 'Vacheron Constantin', count: 11, avgPrice: 32400, avgConfidence: 88 },
    { reference: 'RM67-02', brand: 'Richard Mille', count: 10, avgPrice: 285000, avgConfidence: 82 },
  ],
};

const conditionData = [
  { condition: 'New', count: 534, percentage: 42.8 },
  { condition: 'Used', count: 423, percentage: 33.9 },
  { condition: 'Like New', count: 203, percentage: 16.3 },
  { condition: 'Naked', count: 87, percentage: 7.0 },
];

const catalogMatchData = [
  { name: 'Matched', value: 1143, percentage: 91.7 },
  { name: 'Unmatched', value: 104, percentage: 8.3 },
];

type SortKey = 'reference' | 'brand' | 'count' | 'avgPrice' | 'avgConfidence';
type SortDir = 'asc' | 'desc';

export default function AnalyticsPage() {
  const { data: apiStats, loading: apiLoading } = useApi<any>('/stats');
  const [stats, setStats] = useState<DashboardStats>(fullDemoStats);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [dateRange, setDateRange] = useState('30d');

  // Merge real API stats — show TOTAL LISTINGS count
  useEffect(() => {
    if (apiStats && apiStats.totalRecords) {
      const total = apiStats.totalRecords;
      const approved = apiStats.approvedCount || 0;
      const human = apiStats.humanCount || 0;
      const recycle = apiStats.recycleCount || 0;
      const review = apiStats.reviewCount || 0;

      setStats(prev => ({
        ...prev,
        totalRecords: total,
        approvedRate: total > 0 ? Math.round((approved / total) * 100) : 0,
        humanReview: human,
        recycled: recycle,
        avgPrice: apiStats.avgPrice || 0,
        avgConfidence: apiStats.avgConfidence || 0,
        // Verdict distribution pie chart data
        recordsByVerdict: {
          APPROVED: approved,
          REVIEW: review,
          HUMAN: human,
          RECYCLE: recycle,
        },
        brandDistribution: apiStats.brandDistribution?.map((b: any) => ({
          brand: b.brand,
          count: b.count,
          percentage: total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0,
        })) || prev.brandDistribution,
      }));
    }
  }, [apiStats]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortKey(key);
  }, [sortKey]);

  const sortedRefs = [...stats.topReferences].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'reference') return dir * a.reference.localeCompare(b.reference);
    if (sortKey === 'brand') return dir * a.brand.localeCompare(b.brand);
    if (sortKey === 'count') return dir * (a.count - b.count);
    if (sortKey === 'avgPrice') return dir * (a.avgPrice - b.avgPrice);
    return dir * (a.avgConfidence - b.avgConfidence);
  });

  const exportCSV = useCallback(() => {
    const headers = ['Reference', 'Brand', 'Count', 'Avg Price', 'Avg Confidence'];
    const rows = sortedRefs.map(r => [r.reference, r.brand, r.count, r.avgPrice, `${r.avgConfidence}%`]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedRefs]);

  return (<>
      <div className="p-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BarChart3 size={22} className="text-amber-400" /> Analytics
            </h1>
            <p className="text-sm text-gray-400 mt-1">Detailed analytics and data exploration</p>
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
            <button onClick={fetchReport} disabled={loading} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm disabled:opacity-50">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* Row 1: Brand + Confidence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Brand Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.brandDistribution} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
                    <XAxis type="number" stroke="#6B7280" fontSize={11} />
                    <YAxis dataKey="brand" type="category" stroke="#9CA3AF" fontSize={10} width={140} />
                    <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {stats.brandDistribution.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Confidence Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={stats.confidenceDistribution} dataKey="count" nameKey="range" cx="40%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4}>
                      {stats.confidenceDistribution.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: '12px' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Row 2: Price + Daily */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Price Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={stats.priceDistribution}>
                    <defs>
                      <linearGradient id="priceGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C9A96E" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#C9A96E" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="range" stroke="#6B7280" fontSize={10} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="count" stroke="#C9A96E" fill="url(#priceGrad2)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">30-Day Trend</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={stats.dailyTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="date" stroke="#6B7280" fontSize={10} tickFormatter={(v) => v.slice(5)} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                    <Line type="monotone" dataKey="count" stroke="#C9A96E" strokeWidth={2} dot={false} name="Records" />
                    <Line type="monotone" dataKey="avgConfidence" stroke="#22C55E" strokeWidth={2} dot={false} name="Confidence" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Row 3: Condition + Catalog */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Condition Distribution</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={conditionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                    <XAxis dataKey="condition" stroke="#6B7280" fontSize={11} />
                    <YAxis stroke="#6B7280" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {conditionData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Catalog Match Rate</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={catalogMatchData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percentage }) => `${name}: ${percentage}%`}>
                      <Cell fill="#22C55E" />
                      <Cell fill="#EF4444" />
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Price Range Breakdown */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Price Range Breakdown</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                      <th className="text-left py-2 px-2">Range</th>
                      <th className="text-right py-2 px-2">Count</th>
                      <th className="text-right py-2 px-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.priceDistribution.map((bin) => (
                      <tr key={bin.range} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-2 px-2 text-white">{bin.range}</td>
                        <td className="py-2 px-2 text-right font-mono text-white">{bin.count}</td>
                        <td className="py-2 px-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-950 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(bin.count / stats.totalRecords) * 100 * 4}%` }} />
                            </div>
                            <span className="text-gray-400 font-mono text-xs">{((bin.count / stats.totalRecords) * 100).toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Confidence Distribution Table */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Confidence Distribution</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                      <th className="text-left py-2 px-2">Range</th>
                      <th className="text-right py-2 px-2">Count</th>
                      <th className="text-right py-2 px-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.confidenceDistribution.map((bin) => (
                      <tr key={bin.range} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-2 px-2">
                          <span className="text-white">{bin.range}</span>
                          <span
                            className="ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold"
                            style={{
                              color: confidenceColor((bin.min + bin.max) / 2),
                              backgroundColor: `${confidenceColor((bin.min + bin.max) / 2)}20`,
                            }}
                          >
                            {bin.min >= 85 ? 'APPROVED' : bin.min >= 70 ? 'REVIEW' : bin.min >= 50 ? 'HUMAN' : 'RECYCLE'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-white">{bin.count}</td>
                        <td className="py-2 px-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-950 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${bin.percentage * 1.5}%`, backgroundColor: confidenceColor((bin.min + bin.max) / 2) }}
                              />
                            </div>
                            <span className="text-gray-400 font-mono text-xs">{bin.percentage}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Full Reference Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <TrendingUp size={14} /> All References
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                      {(['reference', 'brand', 'count', 'avgPrice', 'avgConfidence'] as SortKey[]).map((key) => (
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
                    {sortedRefs.map((ref) => (
                      <tr key={ref.reference} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                        <td className="py-2 px-3 font-mono font-semibold text-white">{ref.reference}</td>
                        <td className="py-2 px-3 text-gray-300">{ref.brand}</td>
                        <td className="py-2 px-3 font-mono text-white">{ref.count}</td>
                        <td className="py-2 px-3 font-mono text-amber-400">{formatPrice(ref.avgPrice)}</td>
                        <td className="py-2 px-3">
                          <span className="font-mono" style={{ color: confidenceColor(ref.avgConfidence) }}>
                            {ref.avgConfidence}%
                          </span>
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
