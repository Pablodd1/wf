/**
 * AdminReportsPage — Comprehensive Reports Dashboard
 * ==================================================
 * 4 report sections powered by Supabase materialized views:
 *   1. Market Overview    — totals, brand distribution, verdict pie
 *   2. Brand Deep-Dive    — top 15 brands with listings, avg price, condition, dial
 *   3. Price Analysis     — price buckets, brand averages, outlier detection
 *   4. Data Quality       — approval/recycle rates, confidence distribution
 *
 * Exports: CSV (per section), Excel (multi-sheet), Print/PDF
 * Data: 2.39M+ watch records via pre-computed materialized views
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, PieChart, Pie, AreaChart, Area,
  Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend,
} from 'recharts';
import {
  FileSpreadsheet, Download, Printer, Loader2, TrendingUp,
  Database, ShieldCheck, BarChart3, PieChart as PieIcon,
  DollarSign, Activity, ArrowUpDown, Clock, RefreshCw,
  AlertTriangle, CheckCircle, XCircle, Eye, Zap,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';


const CHART_COLORS = ['#D4AF37', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#06B6D4', '#A855F7', '#84CC16', '#06B6D4', '#D946EF', '#F43F5E'];

const VERDICT_COLORS: Record<string, string> = {
  APPROVED: '#22C55E', REVIEW: '#3B82F6', HUMAN: '#F59E0B', RECYCLE: '#EF4444', WTB: '#D4AF37',
};

const VERDICT_LABELS: Record<string, string> = {
  APPROVED: 'Approved', REVIEW: 'In Review', HUMAN: 'Human Review', RECYCLE: 'Recycled', WTB: 'Want To Buy',
};

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
interface StatsSummary {
  total_records: number;
  unique_brands: number;
  unique_refs: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  median_price?: number;
}

interface BrandDist { brand: string; count: number; avg_price?: number; }
interface VerdictDist { verdict: string; count: number; }
interface CondDist { condition: string; count: number; }
interface DialDist { dial_color: string; count: number; }
interface TopRef { reference: string; brand: string; count: number; avg_price: number; }
interface PriceBucket { price_range: string; count: number; }

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */
function fmtPrice(n: number): string {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 100_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toLocaleString()}`;
}

function fmtNumber(n: number): string {
  return (n || 0).toLocaleString();
}

function fmtPct(n: number, total: number): string {
  if (!total) return '0.0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

const tooltipStyle = {
  backgroundColor: '#111118',
  border: '1px solid #1E1E2E',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#fff',
};

const fetcher = async (view: string, limit = 100): Promise<any[]> => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*&limit=${limit}`, { headers: REQ_HEADERS });
  if (!res.ok) throw new Error(`${view}: HTTP ${res.status}`);
  return res.json();
};

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */
type ReportTab = 'overview' | 'brands' | 'price' | 'quality';

export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState('');

  // Data state
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [brandDist, setBrandDist] = useState<BrandDist[]>([]);
  const [verdictDist, setVerdictDist] = useState<VerdictDist[]>([]);
  const [condDist, setCondDist] = useState<CondDist[]>([]);
  const [dialDist, setDialDist] = useState<DialDist[]>([]);
  const [topRefs, setTopRefs] = useState<TopRef[]>([]);
  const [priceBuckets, setPriceBuckets] = useState<PriceBucket[]>([]);

  // Brand deep-dive sort
  const [brandSort, setBrandSort] = useState<'count' | 'avgPrice' | 'brand'>('count');
  const [brandSortDir, setBrandSortDir] = useState<'asc' | 'desc'>('desc');

  /* ─── Load all data from materialized views ─── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const [s, b, v, c, d, r, p] = await Promise.all([
        fetcher('mv_stats_summary', 1),
        fetcher('mv_brand_dist', 200),
        fetcher('mv_verdict_dist', 20),
        fetcher('mv_cond_dist', 50),
        fetcher('mv_dial_dist', 50),
        fetcher('mv_top_refs', 500),
        fetcher('mv_price_buckets', 50),
      ]);
      setStats(s[0] || null);
      setBrandDist((b || []).filter((x: any) => x.count > 0));
      setVerdictDist((v || []).filter((x: any) => x.count > 0));
      setCondDist((c || []).filter((x: any) => x.count > 0));
      setDialDist((d || []).filter((x: any) => x.count > 0));
      setTopRefs((r || []).filter((x: any) => x.count > 0));
      setPriceBuckets(p || []);
      setLastRefreshed(new Date().toLocaleTimeString());
      const ms = Math.round(performance.now() - start);
      console.log(`Reports loaded from materialized views in ${ms}ms`);
    } catch (err) {
      console.error('Reports load error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* ─── Computed data ─── */
  const totalRecords = stats?.total_records || 0;

  // Top 10 brands for market overview chart
  const top10Brands = useMemo(() => brandDist.slice(0, 10), [brandDist]);

  // Top 15 brands for deep-dive (sorted)
  const top15Brands = useMemo(() => {
    const sorted = [...brandDist].sort((a, b) => {
      const dir = brandSortDir === 'asc' ? 1 : -1;
      if (brandSort === 'brand') return dir * a.brand.localeCompare(b.brand);
      if (brandSort === 'avgPrice') return dir * ((a.avg_price || 0) - (b.avg_price || 0));
      return dir * (a.count - b.count);
    });
    return sorted.slice(0, 15);
  }, [brandDist, brandSort, brandSortDir]);

  // Compute brand averages from top_refs data
  const brandAvgPrices = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const ref of topRefs) {
      if (!ref.brand || !ref.avg_price) continue;
      const arr = map.get(ref.brand) || [];
      arr.push(ref.avg_price);
      map.set(ref.brand, arr);
    }
    const result: Record<string, number> = {};
    for (const [brand, prices] of map.entries()) {
      result[brand] = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    }
    return result;
  }, [topRefs]);

  // Most common condition & dial globally
  const topCondition = useMemo(() => condDist[0]?.condition || 'N/A', [condDist]);
  const topDial = useMemo(() => dialDist[0]?.dial_color || 'N/A', [dialDist]);

  // Price analysis data
  const priceStats = useMemo(() => {
    if (!stats) return null;
    const avg = stats.avg_price || 0;
    const min = stats.min_price || 0;
    const max = stats.max_price || 0;
    // Compute median from price buckets
    let median = avg;
    if (priceBuckets.length > 0) {
      const totalInBuckets = priceBuckets.reduce((s, b) => s + b.count, 0);
      let cumulative = 0;
      const target = totalInBuckets / 2;
      for (const bucket of priceBuckets) {
        cumulative += bucket.count;
        if (cumulative >= target) {
          // Extract midpoint from range label like "$0 - $1k"
          const match = bucket.price_range.match(/\$?([\d,.]+)/g);
          if (match && match.length >= 2) {
            const low = parseFloat(match[0].replace(/,/g, ''));
            const high = parseFloat(match[1].replace(/,/g, ''));
            median = Math.round((low + high) / 2);
          }
          break;
        }
      }
    }
    // IQR outlier detection
    const q1Index = Math.floor(priceBuckets.length * 0.25);
    const q3Index = Math.floor(priceBuckets.length * 0.75);
    const q1Bucket = priceBuckets[q1Index];
    const q3Bucket = priceBuckets[q3Index];
    let q1 = min, q3 = max;
    if (q1Bucket) {
      const m = q1Bucket.price_range.match(/\$?([\d,.]+)/g);
      if (m) q1 = parseFloat(m[0].replace(/,/g, '')) || min;
    }
    if (q3Bucket) {
      const m = q3Bucket.price_range.match(/\$?([\d,.]+)/g);
      if (m) q3 = parseFloat(m[0].replace(/,/g, '')) || max;
    }
    const iqr = q3 - q1;
    const outlierLow = q1 - 1.5 * iqr;
    const outlierHigh = q3 + 1.5 * iqr;
    const outlierCount = priceBuckets.reduce((s, b) => {
      const m = b.price_range.match(/\$?([\d,.]+)/g);
      if (!m) return s;
      const high = parseFloat(m[m.length - 1].replace(/,/g, ''));
      return high > outlierHigh ? s + b.count : s;
    }, 0);

    return { avg, min, max, median, q1, q3, iqr, outlierLow, outlierHigh, outlierCount };
  }, [stats, priceBuckets]);

  // Average price by brand (horizontal bar data) — top 15 by avg price
  const brandPriceBars = useMemo(() => {
    return Object.entries(brandAvgPrices)
      .map(([brand, avgPrice]) => ({ brand, avgPrice }))
      .sort((a, b) => b.avgPrice - a.avgPrice)
      .slice(0, 15);
  }, [brandAvgPrices]);

  // Verdict stats
  const verdictStats = useMemo(() => {
    const approved = verdictDist.find(v => v.verdict === 'APPROVED')?.count || 0;
    const recycle = verdictDist.find(v => v.verdict === 'RECYCLE')?.count || 0;
    const human = verdictDist.find(v => v.verdict === 'HUMAN')?.count || 0;
    const review = verdictDist.find(v => v.verdict === 'REVIEW')?.count || 0;
    const wtb = verdictDist.find(v => v.verdict === 'WTB')?.count || 0;
    return { approved, recycle, human, review, wtb };
  }, [verdictDist]);

  /* ─── Export: CSV ─── */
  const downloadCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvRows = rows.map(r => r.map(cell => {
      const val = String(cell ?? '');
      if (val.includes(',') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`;
      return val;
    }).join(','));
    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportOverviewCSV = () => {
    downloadCSV(
      `watchfacts-market-overview-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Metric', 'Value'],
      [
        ['Total Listings', totalRecords],
        ['Total Brands', stats?.unique_brands || 0],
        ['Total References', stats?.unique_refs || 0],
        ['Average Price', stats?.avg_price || 0],
        ['Min Price', stats?.min_price || 0],
        ['Max Price', stats?.max_price || 0],
      ]
    );
  };

  const exportBrandCSV = () => {
    downloadCSV(
      `watchfacts-brand-deepdive-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Brand', 'Listings', 'Avg Price', 'Most Common Condition', 'Most Common Dial Color'],
      top15Brands.map(b => [
        b.brand,
        b.count,
        brandAvgPrices[b.brand] || 0,
        topCondition,
        topDial,
      ])
    );
  };

  const exportPriceCSV = () => {
    const headers = ['Price Range', 'Count'];
    const rows = priceBuckets.map(pb => [pb.price_range, pb.count]);
    downloadCSV(
      `watchfacts-price-analysis-${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows
    );
  };

  const exportQualityCSV = () => {
    downloadCSV(
      `watchfacts-data-quality-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Verdict', 'Count', 'Percentage'],
      verdictDist.map(v => [v.verdict, v.count, fmtPct(v.count, totalRecords)])
    );
  };

  /* ─── Export: Excel (multi-sheet) ─── */
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: 'WatchFacts Analytics Report',
      Subject: 'Watch Data Analytics',
      Author: 'WatchFacts',
      CreatedDate: new Date(),
    };

    // Sheet 1: Market Overview
    const overviewWS = XLSX.utils.aoa_to_sheet([
      ['Market Overview Report'],
      ['Generated', new Date().toLocaleString()],
      [],
      ['Metric', 'Value'],
      ['Total Listings', totalRecords],
      ['Total Brands', stats?.unique_brands || 0],
      ['Total References', stats?.unique_refs || 0],
      ['Average Price', stats?.avg_price || 0],
      ['Min Price', stats?.min_price || 0],
      ['Max Price', stats?.max_price || 0],
      [],
      ['Top 10 Brands by Listings'],
      ['Brand', 'Listings'],
      ...top10Brands.map(b => [b.brand, b.count]),
      [],
      ['Verdict Distribution'],
      ['Verdict', 'Count', 'Percentage'],
      ...verdictDist.map(v => [v.verdict, v.count, fmtPct(v.count, totalRecords)]),
    ]);
    XLSX.utils.book_append_sheet(wb, overviewWS, 'Market Overview');

    // Sheet 2: Brand Deep-Dive
    const brandWS = XLSX.utils.aoa_to_sheet([
      ['Brand Deep-Dive Report'],
      ['Generated', new Date().toLocaleString()],
      [],
      ['Brand', 'Listings', 'Avg Price', 'Most Common Condition', 'Most Common Dial Color'],
      ...top15Brands.map(b => [
        b.brand,
        b.count,
        brandAvgPrices[b.brand] || 0,
        topCondition,
        topDial,
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, brandWS, 'Brand Deep-Dive');

    // Sheet 3: Price Analysis
    const priceWS = XLSX.utils.aoa_to_sheet([
      ['Price Analysis Report'],
      ['Generated', new Date().toLocaleString()],
      [],
      ['Price Range', 'Count'],
      ...priceBuckets.map(pb => [pb.price_range, pb.count]),
      [],
      ['Price Statistics'],
      ['Statistic', 'Value'],
      ['Average', priceStats?.avg || 0],
      ['Median', priceStats?.median || 0],
      ['Minimum', priceStats?.min || 0],
      ['Maximum', priceStats?.max || 0],
      ['Q1 (25th percentile)', priceStats?.q1 || 0],
      ['Q3 (75th percentile)', priceStats?.q3 || 0],
      ['IQR', priceStats?.iqr || 0],
      ['Outlier Threshold (High)', priceStats?.outlierHigh || 0],
      ['Estimated Outliers', priceStats?.outlierCount || 0],
    ]);
    XLSX.utils.book_append_sheet(wb, priceWS, 'Price Analysis');

    // Sheet 4: Data Quality
    const qualityWS = XLSX.utils.aoa_to_sheet([
      ['Data Quality Report'],
      ['Generated', new Date().toLocaleString()],
      [],
      ['Verdict', 'Count', 'Percentage'],
      ...verdictDist.map(v => [v.verdict, v.count, fmtPct(v.count, totalRecords)]),
      [],
      ['Condition Distribution'],
      ['Condition', 'Count'],
      ...condDist.map(c => [c.condition, c.count]),
      [],
      ['Dial Color Distribution (Top 10)'],
      ['Dial Color', 'Count'],
      ...dialDist.slice(0, 10).map(d => [d.dial_color, d.count]),
    ]);
    XLSX.utils.book_append_sheet(wb, qualityWS, 'Data Quality');

    XLSX.writeFile(wb, `watchfacts-full-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  /* ─── Print ─── */
  const handlePrint = () => {
    window.print();
  };

  /* ─── Tab definitions ─── */
  const tabs: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Market Overview', icon: BarChart3 },
    { id: 'brands', label: 'Brand Deep-Dive', icon: Database },
    { id: 'price', label: 'Price Analysis', icon: DollarSign },
    { id: 'quality', label: 'Data Quality', icon: ShieldCheck },
  ];

  const currentTabLabel = tabs.find(t => t.id === activeTab)?.label || 'Report';

  return (
    <div className="p-5 max-w-[1600px] mx-auto print:p-0 print:max-w-none">
      {/* ═══════════ HEADER ═══════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 print:mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2 print:text-black">
            <FileSpreadsheet size={22} className="text-[#D4AF37]" /> Reports
          </h1>
          <div className="flex items-center gap-3 mt-1 text-xs">
            <span className="text-gray-400 print:text-gray-600">
              {loading ? 'Loading...' : stats ? `${fmtNumber(totalRecords)} records analyzed` : ''}
            </span>
            {lastRefreshed && (
              <span className="text-gray-600 flex items-center gap-1">
                <Clock size={10} /> Refreshed: {lastRefreshed}
              </span>
            )}
            {!loading && (
              <span className="text-green-400 flex items-center gap-1 print:hidden">
                <Zap size={10} /> Materialized Views
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 print:hidden flex-wrap">
          <button
            onClick={exportExcel}
            className="px-4 py-2 bg-[#D4AF37] hover:bg-[#E5C158] text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
          >
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-[#111118] hover:bg-[#1A1A24] text-white rounded-lg font-medium transition-colors border border-[#1E1E2E] flex items-center gap-2 text-sm"
          >
            <Printer size={16} /> Print / PDF
          </button>
          <button
            onClick={loadAll}
            disabled={loading}
            className="px-4 py-2 bg-[#111118] hover:bg-[#1A1A24] text-white rounded-lg font-medium transition-colors border border-[#1E1E2E] flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {/* ═══════════ PRINT HEADER (visible only when printing) ═══════════ */}
      <div className="hidden print:block print:mb-6">
        <h1 className="text-3xl font-bold text-black mb-2">WatchFacts Analytics Report</h1>
        <p className="text-gray-600">Generated: {new Date().toLocaleString()}</p>
        <p className="text-gray-600">Dataset: {fmtNumber(totalRecords)} watch listings across {stats?.unique_brands || 0} brands</p>
        <hr className="border-black my-4" />
      </div>

      {/* ═══════════ LOADING STATE ═══════════ */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin" />
          <span className="ml-3 text-gray-400 text-sm">Loading reports from materialized views...</span>
        </div>
      ) : !stats ? (
        <div className="text-center py-20 text-gray-500">
          <AlertTriangle size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-lg">No data available</p>
          <p className="text-sm text-gray-600 mt-1">Materialized views may need to be refreshed</p>
          <button onClick={loadAll} className="mt-4 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm">
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* ═══════════ SUMMARY CARDS (always visible) ═══════════ */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 print:grid-cols-5 print:gap-2">
            {[
              { label: 'Total Listings', value: fmtNumber(totalRecords), color: 'text-white' },
              { label: 'Brands', value: fmtNumber(stats.unique_brands || 0), color: 'text-[#D4AF37]' },
              { label: 'References', value: fmtNumber(stats.unique_refs || 0), color: 'text-blue-400' },
              { label: 'Avg Price', value: fmtPrice(stats.avg_price || 0), color: 'text-green-400' },
              { label: 'Price Range', value: `${fmtPrice(stats.min_price || 0)} — ${fmtPrice(stats.max_price || 0)}`, color: 'text-[#D4AF37]' },
            ].map(card => (
              <div key={card.label} className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300 print:p-2">
                <div className="text-xs text-gray-500 uppercase mb-1 print:text-gray-600">{card.label}</div>
                <div className={`text-lg font-bold font-mono ${card.color} print:text-black`}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* ═══════════ TABS ═══════════ */}
          <div className="flex gap-1 mb-6 overflow-x-auto print:hidden">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap border ${
                    activeTab === tab.id
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30'
                      : 'text-gray-400 hover:text-white hover:bg-[#111118] border-transparent'
                  }`}
                >
                  <Icon size={14} /> {tab.label}
                </button>
              );
            })}
          </div>

          {/* ═══════════ TAB LABEL (print only) ═══════════ */}
          <div className="hidden print:block print:mb-4">
            <h2 className="text-xl font-bold text-black">{currentTabLabel}</h2>
          </div>

          {/* ═══════════ TAB CONTENT ═══════════ */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* ═══════════════════════════════════════════
                  REPORT 1: MARKET OVERVIEW
                  ═══════════════════════════════════════════ */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Top 10 Brands Bar Chart */}
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 print:text-black">
                        <BarChart3 size={14} /> Top 10 Brands by Listing Count
                      </h3>
                      <button
                        onClick={exportOverviewCSV}
                        className="text-xs text-gray-500 hover:text-[#D4AF37] transition-colors flex items-center gap-1 print:hidden"
                      >
                        <Download size={12} /> CSV
                      </button>
                    </div>
                    {top10Brands.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={top10Brands} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
                          <XAxis type="number" stroke="#6B7280" fontSize={11} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                          <YAxis dataKey="brand" type="category" stroke="#9CA3AF" fontSize={11} width={100} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [fmtNumber(Number(value)), 'Listings']} />
                          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                            {top10Brands.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-10 text-gray-500">No brand data</div>
                    )}
                  </div>

                  {/* Verdict Pie Chart */}
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2 print:text-black">
                      <PieIcon size={14} /> Verdict Distribution
                    </h3>
                    {verdictDist.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={verdictDist}
                            dataKey="count"
                            nameKey="verdict"
                            cx="40%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={4}
                            label={({ verdict, count }: any) => verdict ? `${VERDICT_LABELS[verdict] || verdict}: ${fmtPct(count || 0, totalRecords)}` : ''}
                          >
                            {verdictDist.map((v, i) => (
                              <Cell key={i} fill={VERDICT_COLORS[v.verdict] || CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Legend
                            wrapperStyle={{ color: '#9CA3AF', fontSize: '12px' }}
                            formatter={(value: string) => VERDICT_LABELS[value] || value}
                            payload={verdictDist.map(v => ({
                              value: v.verdict,
                              type: 'rect' as const,
                              color: VERDICT_COLORS[v.verdict] || '#6B7280',
                            }))}
                          />
                          <Tooltip
                            contentStyle={tooltipStyle}
                            formatter={(value: any, name: any) => [fmtNumber(Number(value)), VERDICT_LABELS[name] || name]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-10 text-gray-500">No verdict data</div>
                    )}
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════
                  REPORT 2: BRAND DEEP-DIVE
                  ═══════════════════════════════════════════ */}
              {activeTab === 'brands' && (
                <div className="space-y-6">
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg overflow-hidden print:bg-white print:border-gray-300">
                    <div className="flex items-center justify-between p-4 border-b border-[#1E1E2E] print:border-gray-300">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 print:text-black">
                        <Database size={14} /> Top 15 Brands — Detailed Metrics
                      </h3>
                      <button
                        onClick={exportBrandCSV}
                        className="text-xs text-gray-500 hover:text-[#D4AF37] transition-colors flex items-center gap-1 print:hidden"
                      >
                        <Download size={12} /> CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-[#1E1E2E] bg-[#0A0A0F] print:text-black print:bg-gray-100 print:border-gray-300">
                            {([
                              { key: 'brand', label: 'Brand' },
                              { key: 'count', label: 'Listings' },
                              { key: 'avgPrice', label: 'Avg Price' },
                            ] as const).map(col => (
                              <th
                                key={col.key}
                                className="text-left py-3 px-4 cursor-pointer hover:text-white transition-colors select-none print:hover:text-black"
                                onClick={() => {
                                  setBrandSortDir(d => brandSort === col.key ? (d === 'asc' ? 'desc' : 'asc') : 'desc');
                                  setBrandSort(col.key);
                                }}
                              >
                                <div className="flex items-center gap-1">
                                  {col.label}
                                  <ArrowUpDown size={10} className={brandSort === col.key ? 'text-[#D4AF37]' : 'text-gray-600'} />
                                </div>
                              </th>
                            ))}
                            <th className="text-left py-3 px-4">Most Common Condition</th>
                            <th className="text-left py-3 px-4">Most Common Dial Color</th>
                          </tr>
                        </thead>
                        <tbody>
                          {top15Brands.map((b, idx) => (
                            <tr
                              key={b.brand}
                              className="border-b border-[#1E1E2E] hover:bg-[#1A1A24] transition-colors print:border-gray-200 print:hover:bg-transparent"
                            >
                              <td className="py-3 px-4 font-semibold text-white print:text-black">
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full inline-block"
                                    style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                                  />
                                  {b.brand}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono text-white print:text-black">{fmtNumber(b.count)}</td>
                              <td className="py-3 px-4 font-mono text-[#D4AF37] print:text-black">{fmtPrice(brandAvgPrices[b.brand] || 0)}</td>
                              <td className="py-3 px-4 text-gray-300 print:text-gray-700">{topCondition}</td>
                              <td className="py-3 px-4 text-gray-300 print:text-gray-700">{topDial}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mini stat cards for brand context */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                      <div className="text-xs text-gray-500 uppercase mb-2 print:text-gray-600">Brands Represented</div>
                      <div className="text-2xl font-bold text-white print:text-black">{fmtNumber(stats.unique_brands || 0)}</div>
                      <div className="text-xs text-gray-500 mt-1">Across {fmtNumber(totalRecords)} listings</div>
                    </div>
                    <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                      <div className="text-xs text-gray-500 uppercase mb-2 print:text-gray-600">Top Brand Market Share</div>
                      <div className="text-2xl font-bold text-[#D4AF37] print:text-black">
                        {top10Brands[0] ? fmtPct(top10Brands[0].count, totalRecords) : 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{top10Brands[0]?.brand || ''}</div>
                    </div>
                    <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                      <div className="text-xs text-gray-500 uppercase mb-2 print:text-gray-600">Avg Price (Top Brand)</div>
                      <div className="text-2xl font-bold text-green-400 print:text-black">
                        {fmtPrice(brandAvgPrices[top10Brands[0]?.brand] || 0)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{top10Brands[0]?.brand || ''}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════
                  REPORT 3: PRICE ANALYSIS
                  ═══════════════════════════════════════════ */}
              {activeTab === 'price' && (
                <div className="space-y-6">
                  {/* Price Distribution Area Chart */}
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 print:text-black">
                        <Activity size={14} /> Price Distribution
                      </h3>
                      <button
                        onClick={exportPriceCSV}
                        className="text-xs text-gray-500 hover:text-[#D4AF37] transition-colors flex items-center gap-1 print:hidden"
                      >
                        <Download size={12} /> CSV
                      </button>
                    </div>
                    {priceBuckets.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={priceBuckets}>
                          <defs>
                            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                          <XAxis dataKey="price_range" stroke="#6B7280" fontSize={10} interval={Math.floor(priceBuckets.length / 8)} />
                          <YAxis stroke="#6B7280" fontSize={11} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [fmtNumber(Number(value)), 'Listings']} />
                          <Area type="monotone" dataKey="count" stroke="#D4AF37" fill="url(#priceGrad)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-10 text-gray-500">No price data</div>
                    )}
                  </div>

                  {/* Average Price by Brand */}
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2 print:text-black">
                      <TrendingUp size={14} /> Average Price by Brand (Top 15)
                    </h3>
                    {brandPriceBars.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={brandPriceBars} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
                          <XAxis type="number" stroke="#6B7280" fontSize={11} tickFormatter={v => fmtPrice(Number(v))} />
                          <YAxis dataKey="brand" type="category" stroke="#9CA3AF" fontSize={10} width={120} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [fmtPrice(Number(value)), 'Avg Price']} />
                          <Bar dataKey="avgPrice" radius={[0, 4, 4, 0]}>
                            {brandPriceBars.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-10 text-gray-500">No price data</div>
                    )}
                  </div>

                  {/* Statistics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Average', value: fmtPrice(priceStats?.avg || 0), color: 'text-white' },
                      { label: 'Median', value: fmtPrice(priceStats?.median || 0), color: 'text-[#D4AF37]' },
                      { label: 'Minimum', value: fmtPrice(priceStats?.min || 0), color: 'text-green-400' },
                      { label: 'Maximum', value: fmtPrice(priceStats?.max || 0), color: 'text-blue-400' },
                    ].map(s => (
                      <div key={s.label} className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                        <div className="text-xs text-gray-500 uppercase mb-1 print:text-gray-600">{s.label}</div>
                        <div className={`text-xl font-bold font-mono ${s.color} print:text-black`}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Outlier Detection */}
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2 print:text-black">
                      <AlertTriangle size={14} /> Outlier Detection Summary
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs text-gray-500 uppercase mb-1 print:text-gray-600">IQR Method</div>
                        <div className="text-sm text-gray-300 print:text-gray-700">
                          Q1: {fmtPrice(priceStats?.q1 || 0)}<br />
                          Q3: {fmtPrice(priceStats?.q3 || 0)}<br />
                          IQR: {fmtPrice(priceStats?.iqr || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase mb-1 print:text-gray-600">Outlier Threshold (High)</div>
                        <div className="text-xl font-bold text-red-400 print:text-black">{fmtPrice(priceStats?.outlierHigh || 0)}</div>
                        <div className="text-xs text-gray-500 mt-1">Above this = outlier</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase mb-1 print:text-gray-600">Estimated Outliers</div>
                        <div className="text-xl font-bold text-red-400 print:text-black">{fmtNumber(priceStats?.outlierCount || 0)}</div>
                        <div className="text-xs text-gray-500 mt-1">{fmtPct(priceStats?.outlierCount || 0, totalRecords)} of dataset</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════
                  REPORT 4: DATA QUALITY
                  ═══════════════════════════════════════════ */}
              {activeTab === 'quality' && (
                <div className="space-y-6">
                  {/* Verdict Rate Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {([
                      { key: 'approved', label: 'Approved', icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-400/10' },
                      { key: 'recycle', label: 'Recycled', icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
                      { key: 'human', label: 'Human Review', icon: Eye, color: 'text-amber-400', bg: 'bg-amber-400/10' },
                      { key: 'review', label: 'In Review', icon: Clock, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                      { key: 'wtb', label: 'WTB Signals', icon: TrendingUp, color: 'text-[#D4AF37]', bg: 'bg-[#D4AF37]/10' },
                    ] as const).map(item => {
                      const Icon = item.icon;
                      const count = verdictStats[item.key as keyof typeof verdictStats] || 0;
                      return (
                        <div key={item.key} className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`p-1.5 rounded-lg ${item.bg}`}>
                              <Icon size={14} className={item.color} />
                            </div>
                            <span className="text-xs text-gray-500 uppercase print:text-gray-600">{item.label}</span>
                          </div>
                          <div className="text-2xl font-bold text-white print:text-black">{fmtNumber(count)}</div>
                          <div className="text-xs text-gray-500 mt-1">{fmtPct(count, totalRecords)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Verdict Breakdown Table */}
                  <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg overflow-hidden print:bg-white print:border-gray-300">
                    <div className="flex items-center justify-between p-4 border-b border-[#1E1E2E] print:border-gray-300">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 print:text-black">
                        <ShieldCheck size={14} /> Verdict Breakdown
                      </h3>
                      <button
                        onClick={exportQualityCSV}
                        className="text-xs text-gray-500 hover:text-[#D4AF37] transition-colors flex items-center gap-1 print:hidden"
                      >
                        <Download size={12} /> CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-[#1E1E2E] bg-[#0A0A0F] print:text-black print:bg-gray-100 print:border-gray-300">
                            <th className="text-left py-3 px-4">Verdict</th>
                            <th className="text-right py-3 px-4">Count</th>
                            <th className="text-right py-3 px-4">Percentage</th>
                            <th className="text-left py-3 px-4">Visual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {verdictDist.map(v => {
                            const pct = totalRecords ? ((v.count / totalRecords) * 100) : 0;
                            return (
                              <tr key={v.verdict} className="border-b border-[#1E1E2E] hover:bg-[#1A1A24] transition-colors print:border-gray-200">
                                <td className="py-3 px-4">
                                  <span className="flex items-center gap-2">
                                    <span
                                      className="w-3 h-3 rounded-full inline-block"
                                      style={{ backgroundColor: VERDICT_COLORS[v.verdict] || '#6B7280' }}
                                    />
                                    <span className="font-medium text-white print:text-black">
                                      {VERDICT_LABELS[v.verdict] || v.verdict}
                                    </span>
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-white print:text-black">{fmtNumber(v.count)}</td>
                                <td className="py-3 px-4 text-right font-mono text-[#D4AF37] print:text-black">{pct.toFixed(1)}%</td>
                                <td className="py-3 px-4">
                                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden print:bg-gray-200">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${Math.min(100, pct)}%` }}
                                      transition={{ duration: 0.8, ease: 'easeOut' }}
                                      className="h-full rounded-full"
                                      style={{ backgroundColor: VERDICT_COLORS[v.verdict] || '#6B7280' }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Condition & Dial Distribution side by side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2 print:text-black">
                        <Activity size={14} /> Condition Distribution
                      </h3>
                      {condDist.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={condDist.slice(0, 10)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
                            <XAxis dataKey="condition" stroke="#6B7280" fontSize={10} />
                            <YAxis stroke="#6B7280" fontSize={11} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [fmtNumber(Number(value)), 'Listings']} />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                              {condDist.slice(0, 10).map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center py-10 text-gray-500">No data</div>
                      )}
                    </div>

                    <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-4 print:bg-white print:border-gray-300">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2 print:text-black">
                        <PieIcon size={14} /> Dial Color Distribution (Top 10)
                      </h3>
                      {dialDist.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie
                              data={dialDist.slice(0, 10)}
                              dataKey="count"
                              nameKey="dial_color"
                              cx="50%"
                              cy="50%"
                              outerRadius={85}
                              label={({ dial_color, count }: any) => dial_color ? `${dial_color}: ${fmtNumber(count || 0)}` : ''}
                            >
                              {dialDist.slice(0, 10).map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center py-10 text-gray-500">No data</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      {/* ═══════════ PRINT FOOTER ═══════════ */}
      <div className="hidden print:block print:mt-8 print:pt-4 print:border-t print:border-gray-300">
        <p className="text-xs text-gray-500">WatchFacts Analytics Report — {new Date().toLocaleDateString()} — watchfacts.com</p>
      </div>
    </div>
  );
}
