import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, PieChart, Pie, LineChart, Line,
  AreaChart, Area, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';
import {
  Database, ShieldCheck, Users, Trash2, DollarSign, Target,
  TrendingUp, FileSpreadsheet, RefreshCw, Loader2, Activity,
} from 'lucide-react';
import type { DashboardStats } from '@/types';
import { formatPrice, formatNumber, confidenceColor } from '@/lib/utils';

const CHART_COLORS = ['#C9A96E', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316'];

const demoStats: DashboardStats = {
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
    { brand: 'Others', count: 91, percentage: 7.3 },
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
  dailyTrends: [
    { date: '2026-06-20', count: 42, avgConfidence: 78, avgPrice: 82100 },
    { date: '2026-06-21', count: 38, avgConfidence: 74, avgPrice: 76500 },
    { date: '2026-06-22', count: 55, avgConfidence: 80, avgPrice: 91200 },
    { date: '2026-06-23', count: 48, avgConfidence: 77, avgPrice: 83400 },
    { date: '2026-06-24', count: 62, avgConfidence: 82, avgPrice: 105600 },
    { date: '2026-06-25', count: 51, avgConfidence: 79, avgPrice: 98700 },
    { date: '2026-06-26', count: 44, avgConfidence: 75, avgPrice: 71200 },
    { date: '2026-06-27', count: 58, avgConfidence: 81, avgPrice: 94300 },
  ],
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
  ],
};

export default function Home() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Try real API first
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.totalRecords) {
        setStats({
          totalRecords: data.totalRecords,
          approvedRate: data.approvedCount ? Math.round((data.approvedCount / data.totalRecords) * 100) : 0,
          humanReview: data.humanCount || 0,
          recycled: data.recycleCount || 0,
          avgPrice: data.avgPrice || 0,
          avgConfidence: data.avgConfidence || 0,
          brandDistribution: data.brandDistribution?.map((b: any) => ({
            brand: b.brand,
            count: b.count,
            percentage: Math.round((b.count / data.totalRecords) * 100 * 10) / 10,
          })) || [],
          confidenceDistribution: [],
          priceDistribution: [],
          dailyTrends: [],
          topReferences: [],
        });
        setLastUpdated(new Date().toLocaleString());
        if (data.demo) setError('Connected — using cached stats');
      } else {
        throw new Error('No data');
      }
    } catch {
      setStats(demoStats);
      setError('Database connection failed — showing demo data');
      setLastUpdated(new Date().toLocaleString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const exportToExcel = useCallback(() => {
    if (!stats) return;
    const rows = stats.topReferences.map((r) => ({
      Reference: r.reference,
      Brand: r.brand,
      Count: r.count,
      'Avg Price': r.avgPrice,
      'Avg Confidence': `${r.avgConfidence}%`,
    }));
    const csv = [
      Object.keys(rows[0]).join(','),
      ...rows.map((r) => Object.values(r).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stats]);

  if (loading) {
    return (<>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <span className="ml-3 text-gray-400">Loading dashboard...</span>
        </div>
      </>);
  }

  if (!stats) {
    return (<>
        <div className="flex flex-col items-center justify-center h-[60vh] text-gray-400">
          <Activity className="w-12 h-12 mb-4 text-gray-600" />
          <p>Failed to load dashboard data</p>
          <button
            onClick={fetchReport}
            className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      </>);
  }

  const kpiCards = [
    { label: 'Total Records', value: formatNumber(stats.totalRecords), icon: Database, color: 'text-amber-400' },
    { label: 'Approved Rate', value: `${stats.approvedRate}%`, icon: ShieldCheck, color: 'text-green-400' },
    { label: 'Human Review', value: formatNumber(stats.humanReview), icon: Users, color: 'text-orange-400' },
    { label: 'Recycled', value: formatNumber(stats.recycled), icon: Trash2, color: 'text-red-400' },
    { label: 'Avg Price', value: formatPrice(stats.avgPrice), icon: DollarSign, color: 'text-blue-400' },
    { label: 'Avg Confidence', value: `${stats.avgConfidence}%`, icon: Target, color: 'text-purple-400' },
  ];

  return (<>
      <div className="p-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-sm text-gray-400 mt-1">
              {error ? (
                <span className="text-yellow-400">{error}</span>
              ) : (
                `Last updated: ${lastUpdated}`
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportToExcel}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
            >
              <FileSpreadsheet size={16} /> Export
            </button>
            <button
              onClick={fetchReport}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {kpiCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={card.color} />
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{card.label}</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">{card.value}</div>
              </motion.div>
            );
          })}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Brand Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Brand Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={stats.brandDistribution} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
                <XAxis type="number" stroke="#6B7280" fontSize={11} />
                <YAxis dataKey="brand" type="category" stroke="#9CA3AF" fontSize={10} width={120} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                  itemStyle={{ color: '#C9A96E' }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {stats.brandDistribution.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Confidence Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Confidence Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={stats.confidenceDistribution}
                  dataKey="count"
                  nameKey="range"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={4}
                >
                  {stats.confidenceDistribution.map((entry, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Price Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Price Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={stats.priceDistribution}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#C9A96E" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#C9A96E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                <XAxis dataKey="range" stroke="#6B7280" fontSize={10} />
                <YAxis stroke="#6B7280" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                  itemStyle={{ color: '#C9A96E' }}
                />
                <Area type="monotone" dataKey="count" stroke="#C9A96E" fill="url(#priceGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Daily Trends */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Daily Trends</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.dailyTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                <XAxis dataKey="date" stroke="#6B7280" fontSize={10} tickFormatter={(v) => v.slice(5)} />
                <YAxis stroke="#6B7280" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111118', border: '1px solid #1E1E2E', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Line type="monotone" dataKey="count" stroke="#C9A96E" strokeWidth={2} dot={{ fill: '#C9A96E', r: 3 }} name="Records" />
                <Line type="monotone" dataKey="avgConfidence" stroke="#22C55E" strokeWidth={2} dot={{ fill: '#22C55E', r: 3 }} name="Avg Confidence" />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Top 10 References Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp size={14} /> Top 10 References
            </h3>
            <span className="text-xs text-gray-500">By volume</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-left py-2 px-3">Reference</th>
                  <th className="text-left py-2 px-3">Brand</th>
                  <th className="text-right py-2 px-3">Count</th>
                  <th className="text-right py-2 px-3">Avg Price</th>
                  <th className="text-right py-2 px-3">Avg Confidence</th>
                </tr>
              </thead>
              <tbody>
                {stats.topReferences.map((ref, i) => (
                  <tr key={ref.reference} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 px-3 text-gray-500 font-mono">{i + 1}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-white">{ref.reference}</td>
                    <td className="py-2.5 px-3 text-gray-300">{ref.brand}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">{ref.count}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-400">{formatPrice(ref.avgPrice)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-mono" style={{ color: confidenceColor(ref.avgConfidence) }}>
                        {ref.avgConfidence}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </>);
}
