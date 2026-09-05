import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import {
  BarChart3, TrendingUp, TrendingDown, Activity, DollarSign,
  Users, Clock, Target, Zap, ArrowUpRight, ArrowDownRight,
  PieChart, LineChart, BarChart, CheckCircle2
} from 'lucide-react';
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, BarChart as ReBarChart,
  Bar, PieChart as RePieChart, Pie, Cell, Legend
} from 'recharts';

interface AnalyticsData {
  date: string;
  listings: number;
  avgPrice: number;
  confidence: number;
  accuracy: number;
  humanReviews: number;
  approved: number;
  rejected: number;
}

const COLORS = {
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  gold: '#d4af37',
};

export default function AnalyticsDashboard() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [data, setData] = useState<AnalyticsData[]>([]);

  // Generate demo data
  useEffect(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 180;
    const generated: AnalyticsData[] = [];
    const now = new Date();
    
    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      generated.push({
        date: date.toISOString().slice(0, 10),
        listings: Math.floor(Math.random() * 50) + 100,
        avgPrice: Math.floor(Math.random() * 20000) + 40000,
        confidence: Math.floor(Math.random() * 20) + 75,
        accuracy: Math.floor(Math.random() * 15) + 80,
        humanReviews: Math.floor(Math.random() * 20) + 5,
        approved: Math.floor(Math.random() * 40) + 60,
        rejected: Math.floor(Math.random() * 10) + 2,
      });
    }
    
    setData(generated);
  }, [timeRange]);

  const latest = data[data.length - 1] || {} as AnalyticsData;
  const previous = data[data.length - 2] || {} as AnalyticsData;

  const getTrend = (current: number, prev: number) => {
    if (!prev) return { icon: Activity, color: 'text-text-muted', value: '0%' };
    const pct = ((current - prev) / prev * 100).toFixed(1);
    const isUp = current > prev;
    return {
      icon: isUp ? ArrowUpRight : ArrowDownRight,
      color: isUp ? 'text-emerald-400' : 'text-red-400',
      value: `${isUp ? '+' : ''}${pct}%`,
    };
  };

  const confidenceDistribution = [
    { name: 'Verified (100%)', value: 35, color: COLORS.emerald },
    { name: 'Review (90%)', value: 25, color: COLORS.blue },
    { name: 'Check (80%)', value: 20, color: COLORS.amber },
    { name: 'Flagged (<80%)', value: 20, color: COLORS.red },
  ];

  const brandDistribution = [
    { name: 'Rolex', value: 985, color: COLORS.gold },
    { name: 'Patek Philippe', value: 3301, color: COLORS.blue },
    { name: 'Breitling', value: 846, color: COLORS.emerald },
    { name: 'Cartier', value: 762, color: COLORS.purple },
    { name: 'Others', value: 875, color: COLORS.amber },
  ];

  return (
    <Layout>
      <TabNav />
      <div className="max-w-7xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <BarChart3 size={22} className="text-gold-primary" />
            Analytics Dashboard
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Real-time accuracy metrics, confidence trends, and data quality analytics.
          </p>
        </div>

        {/* Time Range */}
        <div className="flex items-center gap-2 mb-6">
          {(['7d', '30d', '90d', 'all'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                timeRange === range 
                  ? 'bg-gold-primary text-black' 
                  : 'border border-border-default bg-bg-card text-text-muted hover:text-text-primary'
              }`}
            >
              {range === 'all' ? 'All Time' : `Last ${range}`}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          {[
            { label: 'Total Listings', value: latest.listings?.toLocaleString() || '0', metric: getTrend(latest.listings, previous.listings), icon: BarChart3 },
            { label: 'Avg Price', value: `$${latest.avgPrice?.toLocaleString() || '0'}`, metric: getTrend(latest.avgPrice, previous.avgPrice), icon: DollarSign },
            { label: 'Avg Confidence', value: `${latest.confidence}%`, metric: getTrend(latest.confidence, previous.confidence), icon: Target },
            { label: 'Accuracy Rate', value: `${latest.accuracy}%`, metric: getTrend(latest.accuracy, previous.accuracy), icon: Activity },
            { label: 'Human Reviews', value: latest.humanReviews?.toString() || '0', metric: getTrend(latest.humanReviews, previous.humanReviews), icon: Users },
            { label: 'Approval Rate', value: `${Math.round((latest.approved / (latest.approved + latest.rejected)) * 100)}%`, metric: { icon: CheckCircle2, color: 'text-emerald-400', value: '+2.1%' }, icon: CheckCircle2 },
          ].map((kpi, i) => (
            <div key={i} className="rounded-xl border border-border-default bg-bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <kpi.icon size={16} className="text-gold-primary" />
                <div className={`flex items-center gap-1 text-[10px] font-bold ${kpi.metric.color}`}>
                  <kpi.metric.icon size={10} />
                  {kpi.metric.value}
                </div>
              </div>
              <div className="text-xl font-extrabold text-text-primary">{kpi.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Confidence Trend */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-gold-primary" />
              Confidence Trend Over Time
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.gold} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.gold} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#666' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                  labelStyle={{ color: '#999' }}
                />
                <Area type="monotone" dataKey="confidence" stroke={COLORS.gold} fill="url(#confGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Accuracy vs Human Reviews */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <Activity size={14} className="text-gold-primary" />
              Accuracy vs Human Reviews
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <ReLineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} />
                <YAxis tick={{ fontSize: 10, fill: '#666' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                />
                <Legend />
                <Line type="monotone" dataKey="accuracy" stroke={COLORS.emerald} strokeWidth={2} dot={false} name="Accuracy %" />
                <Line type="monotone" dataKey="humanReviews" stroke={COLORS.amber} strokeWidth={2} dot={false} name="Human Reviews" />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Confidence Distribution */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <PieChart size={14} className="text-gold-primary" />
              Confidence Distribution
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <RePieChart>
                <Pie
                  data={confidenceDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {confidenceDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }} />
                <Legend fontSize={10} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          {/* Brand Distribution */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <BarChart size={14} className="text-gold-primary" />
              Catalog by Brand
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <ReBarChart data={brandDistribution} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#666' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#666' }} width={80} />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {brandDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </ReBarChart>
            </ResponsiveContainer>
          </div>

          {/* Processing Stats */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <Zap size={14} className="text-gold-primary" />
              Processing Performance
            </h3>
            <div className="space-y-4">
              {[
                { label: 'AI Parse Success', value: 94.2, color: 'bg-emerald-500', target: 95 },
                { label: 'Catalog Match Rate', value: 87.5, color: 'bg-blue-500', target: 90 },
                { label: 'Human Review Required', value: 12.3, color: 'bg-amber-500', target: 10 },
                { label: 'Error Rate', value: 2.1, color: 'bg-red-500', target: 1 },
              ].map(stat => (
                <div key={stat.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary">{stat.label}</span>
                    <span className="text-xs font-mono text-text-primary">{stat.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
                    <div 
                      className={`h-full ${stat.color} transition-all duration-500`} 
                      style={{ width: `${Math.min(100, (stat.value / stat.target) * 100)}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-text-muted mt-0.5">Target: {stat.target}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Data Quality Table */}
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
            <Target size={14} className="text-gold-primary" />
            Data Quality Metrics
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left text-[10px] uppercase tracking-wider text-text-muted py-2">Metric</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-text-muted py-2">Current</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-text-muted py-2">Target</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-text-muted py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { metric: 'Reference Accuracy', current: '96.4%', target: '98%', status: 'good' },
                  { metric: 'Price Validation', current: '92.1%', target: '95%', status: 'warning' },
                  { metric: 'Brand Detection', current: '98.7%', target: '98%', status: 'good' },
                  { metric: 'Dial Color Match', current: '89.3%', target: '92%', status: 'warning' },
                  { metric: 'Currency Conversion', current: '99.1%', target: '99%', status: 'good' },
                  { metric: 'Duplicate Detection', current: '94.5%', target: '95%', status: 'warning' },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-border-default/50">
                    <td className="text-xs text-text-secondary py-2">{row.metric}</td>
                    <td className="text-xs font-mono text-text-primary text-right py-2">{row.current}</td>
                    <td className="text-xs font-mono text-text-muted text-right py-2">{row.target}</td>
                    <td className="text-right py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        row.status === 'good' 
                          ? 'bg-emerald-500/10 text-emerald-400' 
                          : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {row.status === 'good' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
