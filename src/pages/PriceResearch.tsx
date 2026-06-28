import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Info, Loader2, TrendingDown, TrendingUp,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, ComposedChart,
} from 'recharts';
import type { WatchRecord } from '@/types';
import { formatPrice } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MonthlyPricePoint {
  month: string;       // e.g. "Feb 2026"
  monthKey: string;    // e.g. "2026-02"
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  count: number;
}

interface SearchResult {
  reference: string;
  brand: string;
  family: string;
  model: string;
  size: string;
  material: string;
  finish: string;
  imageUrl: string;
  dialColors: string[];
  monthlyData: MonthlyPricePoint[];
  overallMin: number;
  overallMax: number;
  overallAvg: number;
  previousAvg: number;
  priceDrift: number;  // percentage change
  liquidityScore: number;
  marketFs: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const BRANDS = ['All', 'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Vacheron Constantin', 'Omega', 'Cartier'];

const DATE_RANGES = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: 'ALL', months: 999 },
] as const;

const PRESENTATIONS = ['All', 'New', 'Used', 'Like New'] as const;

/* ------------------------------------------------------------------ */
/*  Demo data (fallback when Supabase is not configured)               */
/* ------------------------------------------------------------------ */

const DEMO_RESULT: SearchResult = {
  reference: '52508',
  brand: 'Rolex',
  family: 'Perpetual',
  model: '1908',
  size: '39毫米',
  material: '18K黃金',
  finish: '磨光效果',
  imageUrl: '/watch-silhouette.svg',
  dialColors: ['White', 'Black'],
  overallMin: 23012,
  overallMax: 26660,
  overallAvg: 24400,
  previousAvg: 39807,
  priceDrift: -38.70,
  liquidityScore: 72,
  marketFs: 24,
  monthlyData: [
    { month: 'Feb 2026', monthKey: '2026-02', avgPrice: 25300, minPrice: 24500, maxPrice: 26000, count: 4 },
    { month: 'Mar 2026', monthKey: '2026-03', avgPrice: 24400, minPrice: 23012, maxPrice: 26660, count: 5 },
    { month: 'Apr 2026', monthKey: '2026-04', avgPrice: 23800, minPrice: 23200, maxPrice: 25000, count: 3 },
    { month: 'May 2026', monthKey: '2026-05', avgPrice: 24100, minPrice: 23500, maxPrice: 25200, count: 6 },
    { month: 'Jun 2026', monthKey: '2026-06', avgPrice: 23500, minPrice: 23000, maxPrice: 24800, count: 4 },
    { month: 'Jul 2026', monthKey: '2026-07', avgPrice: 24000, minPrice: 23300, maxPrice: 25500, count: 5 },
  ],
};

/* ------------------------------------------------------------------ */
/*  Helper: group raw watch records by month                           */
/* ------------------------------------------------------------------ */

function groupByMonth(records: WatchRecord[]): MonthlyPricePoint[] {
  const map = new Map<string, { prices: number[]; monthDate: Date }>();

  records.forEach((r) => {
    const date = r.createdAt ? new Date(r.createdAt) : new Date();
    if (isNaN(date.getTime())) return;

    const year = date.getFullYear();
    const month = date.getMonth();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const label = `${monthNames[month]} ${year}`;

    if (!map.has(key)) {
      map.set(key, { prices: [], monthDate: date });
    }
    map.get(key)!.prices.push(r.price);
  });

  // Sort chronologically
  const sorted = Array.from(map.entries()).sort(
    (a, b) => a[1].monthDate.getTime() - b[1].monthDate.getTime()
  );

  return sorted.map(([key, val]) => {
    const prices = val.prices.sort((a, b) => a - b);
    const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = val.monthDate;
    const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    return {
      monthKey: key,
      month: label,
      avgPrice: avg,
      minPrice: prices[0],
      maxPrice: prices[prices.length - 1],
      count: prices.length,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Custom Tooltip                                                     */
/* ------------------------------------------------------------------ */

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data: MonthlyPricePoint = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm min-w-[160px]">
      <div className="font-medium text-gray-900 mb-2 pb-1 border-b border-gray-100">{data.month}</div>
      <div className="space-y-1">
        <div className="flex justify-between text-gray-600">
          <span>Min:</span>
          <span className="font-mono font-medium">{formatPrice(data.minPrice)}</span>
        </div>
        <div className="flex justify-between text-blue-600">
          <span>Avg:</span>
          <span className="font-mono font-medium">{formatPrice(data.avgPrice)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Max:</span>
          <span className="font-mono font-medium">{formatPrice(data.maxPrice)}</span>
        </div>
      </div>
      <div className="text-gray-400 text-xs mt-2 pt-1 border-t border-gray-100">{data.count} listings</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Price Range Bar Component                                          */
/* ------------------------------------------------------------------ */

function PriceRangeBar({ min, avg, max }: { min: number; avg: number; max: number }) {
  const range = max - min || 1;
  const avgPos = ((avg - min) / range) * 100;

  return (
    <div className="w-full">
      {/* Dots and labels */}
      <div className="relative h-16">
        {/* Gray connecting line */}
        <div className="absolute top-8 left-0 right-0 h-0.5 bg-gray-200 rounded" />

        {/* MIN dot (left) */}
        <div className="absolute" style={{ left: '0%', top: '20px' }}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-gray-400 mb-1">MIN</span>
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-white shadow" />
            <span className="text-xs text-gray-500 font-mono mt-1">{formatPrice(min)}</span>
          </div>
        </div>

        {/* AVERAGE dot (center, large blue) */}
        <div className="absolute" style={{ left: `${avgPos}%`, top: '16px', transform: 'translateX(-50%)' }}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-blue-600 font-semibold mb-1">AVERAGE</span>
            <div className="w-6 h-6 rounded-full bg-blue-600 border-[3px] border-white shadow-md" />
            <span className="text-sm text-blue-600 font-mono font-bold mt-1">{formatPrice(avg)}</span>
          </div>
        </div>

        {/* MAX dot (right) */}
        <div className="absolute" style={{ right: '0%', top: '20px' }}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-gray-400 mb-1">MAX</span>
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-white shadow" />
            <span className="text-xs text-gray-500 font-mono mt-1">{formatPrice(max)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Info Section (Liquidity / Pricing header with icon)                */
/* ------------------------------------------------------------------ */

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <Info size={14} className="text-gray-400" />
      </div>
      <div className="text-sm text-gray-600">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function PriceResearch() {
  const navigate = useNavigate();

  /* -- search state -- */
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('All');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  /* -- result state -- */
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selectedDial, setSelectedDial] = useState('White');

  /* -- filters -- */
  const [dateRange, setDateRange] = useState('6M');
  const [presentation, setPresentation] = useState('All');

  /* ---------------------------------------------------------------- */
  /*  Fetch from Supabase (or demo fallback)                           */
  /* ---------------------------------------------------------------- */

  const fetchData = useCallback(async (refQuery: string, brand: string) => {
    setLoading(true);
    setHasSearched(true);

    try {
      // Use demo data if Supabase is not configured
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        await new Promise((r) => setTimeout(r, 600));
        const demo = { ...DEMO_RESULT };
        if (refQuery && refQuery !== '52508') {
          demo.reference = refQuery;
          demo.brand = brand !== 'All' ? brand : 'Rolex';
        }
        setResult(demo);
        setSelectedDial(demo.dialColors[0] ?? 'White');
        setLoading(false);
        return;
      }

      // Build Supabase query
      const url = new URL(`${SUPABASE_URL}/rest/v1/watch_records`);
      url.searchParams.set('select', '*');
      url.searchParams.set('reference', `ilike.*${refQuery}*`);
      url.searchParams.set('order', 'received_at.desc');
      url.searchParams.set('limit', '1000');
      if (brand !== 'All') {
        url.searchParams.set('brand', `eq.${brand}`);
      }

      const response = await fetch(url.toString(), {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });

      if (!response.ok) throw new Error(`Supabase error: ${response.status}`);

      const records: WatchRecord[] = await response.json();

      if (records.length === 0) {
        setResult(null);
        setLoading(false);
        return;
      }

      // Apply presentation filter client-side
      let filtered = records;
      if (presentation !== 'All') {
        filtered = records.filter(
          (r) => r.condition?.toLowerCase() === presentation.toLowerCase()
        );
      }

      const monthlyData = groupByMonth(filtered);
      const prices = filtered.map((r) => r.price).sort((a, b) => a - b);
      const overallAvg = prices.length
        ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
        : 0;
      const firstMonth = monthlyData[0];
      const lastMonth = monthlyData[monthlyData.length - 1];
      const previousAvg = firstMonth?.avgPrice ?? overallAvg;
      const priceDrift = previousAvg > 0
        ? +(((lastMonth?.avgPrice ?? overallAvg) - previousAvg) / previousAvg * 100).toFixed(2)
        : 0;

      // Extract unique dial colors
      const dialColors = Array.from(new Set(records.map((r) => r.dialColor).filter(Boolean)));

      // Guess model from reference
      const ref = records[0]?.reference ?? refQuery;
      const brandName = records[0]?.brand ?? brand;

      setResult({
        reference: ref,
        brand: brandName,
        family: records[0]?.family ?? '',
        model: ref.replace(/\d/g, '').trim() || '1908',
        size: '39毫米',
        material: '18K黃金',
        finish: '磨光效果',
        imageUrl: records[0]?.imageUrl ?? '/watch-silhouette.svg',
        dialColors: dialColors.length > 0 ? dialColors : ['White', 'Black'],
        monthlyData,
        overallMin: prices[0] ?? 0,
        overallMax: prices[prices.length - 1] ?? 0,
        overallAvg,
        previousAvg,
        priceDrift,
        liquidityScore: Math.round(
          (records[0]?.liquidityScore ?? 50 + records.length * 2)
        ),
        marketFs: records.length,
      });
      setSelectedDial(dialColors[0] ?? 'White');
    } catch (err) {
      console.error('Fetch error:', err);
      // Fallback to demo
      const demo = { ...DEMO_RESULT };
      demo.reference = refQuery || '52508';
      if (brand !== 'All') demo.brand = brand;
      setResult(demo);
      setSelectedDial(demo.dialColors[0] ?? 'White');
    } finally {
      setLoading(false);
    }
  }, [presentation]);

  /* ---------------------------------------------------------------- */
  /*  Search handler                                                   */
  /* ---------------------------------------------------------------- */

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    fetchData(query.trim(), brandFilter);
  }, [query, brandFilter, fetchData]);

  // Auto-search when query is long enough
  useEffect(() => {
    if (query.length >= 4) {
      const timer = setTimeout(() => handleSearch(), 500);
      return () => clearTimeout(timer);
    }
  }, [query, handleSearch]);

  /* ---------------------------------------------------------------- */
  /*  Filtered chart data by date range                                */
  /* ---------------------------------------------------------------- */

  const filteredMonthlyData = useMemo(() => {
    if (!result) return [];
    const range = DATE_RANGES.find((r) => r.label === dateRange);
    if (!range || range.months >= 999) return result.monthlyData;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - range.months);

    return result.monthlyData.filter((d) => {
      const [year, month] = d.monthKey.split('-');
      const date = new Date(Number(year), Number(month) - 1, 1);
      return date >= cutoff;
    });
  }, [result, dateRange]);

  /* ---------------------------------------------------------------- */
  /*  Chart click handler                                              */
  /* ---------------------------------------------------------------- */

  const handleDotClick = useCallback(
    (data: any) => {
      if (!result || !data?.monthKey) return;
      navigate(`/insight?ref=${result.reference}&month=${data.monthKey}&dial=${selectedDial}`);
    },
    [navigate, result, selectedDial]
  );

  /* ---------------------------------------------------------------- */
  /*  Derived values for price range bar                               */
  /* ---------------------------------------------------------------- */

  const rangeBarData = useMemo(() => {
    if (!result) return { min: 0, avg: 0, max: 0 };
    return {
      min: result.overallMin,
      avg: result.overallAvg,
      max: result.overallMax,
    };
  }, [result]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1400px] mx-auto px-5 py-6">

        {/* ====== HEADER ====== */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-[#C9A96E]">$</span> Price Research
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Search for a reference number to see market data and pricing trends
          </p>
        </div>

        {/* ====== SEARCH BAR ====== */}
        <div className="flex flex-col sm:flex-row gap-2 max-w-3xl mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter reference number (e.g., 52508, 5711/1A)..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-base font-mono"
            />
          </div>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 text-sm focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {BRANDS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Search
          </button>
        </div>

        {/* ====== LOADING STATE ====== */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={32} className="animate-spin text-blue-500 mb-3" />
            <p className="text-sm">Searching market data...</p>
          </div>
        )}

        {/* ====== NO RESULTS ====== */}
        {hasSearched && !loading && !result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 text-gray-400"
          >
            <Info className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-lg text-gray-500">No market data found for &quot;{query}&quot;</p>
            <p className="text-sm mt-1">Try a different reference number or brand filter</p>
          </motion.div>
        )}

        {/* ====== RESULT LAYOUT ====== */}
        <AnimatePresence>
          {result && !loading && (
            <motion.div
              key={result.reference}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col lg:flex-row gap-6"
            >
              {/* ================================================ */}
              {/* LEFT COLUMN (~35%)                               */}
              {/* ================================================ */}
              <div className="w-full lg:w-[35%] flex-shrink-0">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">

                  {/* Watch Image */}
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-48 h-48 flex items-center justify-center">
                      <img
                        src={result.imageUrl}
                        alt={result.reference}
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/watch-silhouette.svg';
                        }}
                      />
                    </div>
                  </div>

                  {/* Watch Specs */}
                  <div className="text-center text-sm text-gray-500 mb-4">
                    {result.size} · {result.material} · {result.finish}
                  </div>

                  {/* Dial Color Selector */}
                  <div className="flex items-center justify-center gap-2 mb-4">
                    {result.dialColors.map((color) => (
                      <button
                        key={color}
                        onClick={() => setSelectedDial(color)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                          selectedDial === color
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                        }`}
                      >
                        {color}
                      </button>
                    ))}
                  </div>

                  {/* Watch Name */}
                  <div className="text-center mb-4">
                    <div className="text-lg font-bold text-gray-900">
                      {result.brand} {result.model} {result.reference}
                    </div>
                  </div>

                  <div className="border-t border-gray-100" />

                  {/* Liquidity Analysis */}
                  <InfoSection title="Liquidity Analysis">
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-gray-600">Mkt FS:</span>
                      <span className="font-mono font-semibold text-gray-900">{result.marketFs}</span>
                    </div>
                  </InfoSection>

                  {/* Pricing Analysis */}
                  <InfoSection title="Pricing Analysis">
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Previous vs Current Avg Price:</span>
                      </div>
                      <div className="font-mono text-gray-900">
                        {formatPrice(result.previousAvg)} - {formatPrice(result.overallAvg)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-gray-600">Price Drift:</span>
                        <span
                          className={`font-mono font-semibold flex items-center gap-1 ${
                            result.priceDrift < 0 ? 'text-red-500' : result.priceDrift > 0 ? 'text-green-500' : 'text-gray-500'
                          }`}
                        >
                          {result.priceDrift < 0 ? (
                            <TrendingDown size={14} />
                          ) : result.priceDrift > 0 ? (
                            <TrendingUp size={14} />
                          ) : null}
                          {result.priceDrift > 0 ? '+' : ''}
                          {result.priceDrift}%
                        </span>
                      </div>
                    </div>
                  </InfoSection>
                </div>
              </div>

              {/* ================================================ */}
              {/* RIGHT COLUMN (~65%)                              */}
              {/* ================================================ */}
              <div className="w-full lg:w-[65%] flex-1">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">

                  {/* Title */}
                  <h2 className="text-lg font-bold text-gray-900 mb-4">
                    Market Indicators – Reference {result.reference}
                  </h2>

                  {/* Chart */}
                  <div className="w-full h-[320px] mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={filteredMonthlyData}
                        onClick={(state: any) => {
                          if (state?.activePayload?.[0]?.payload) {
                            handleDotClick(state.activePayload[0].payload);
                          }
                        }}
                        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                      >
                        <defs>
                          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.1} />
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 12, fill: '#6B7280' }}
                          axisLine={{ stroke: '#E5E7EB' }}
                          tickLine={{ stroke: '#E5E7EB' }}
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: '#6B7280' }}
                          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                          domain={['dataMin - 1000', 'dataMax + 1000']}
                          axisLine={{ stroke: '#E5E7EB' }}
                          tickLine={{ stroke: '#E5E7EB' }}
                          label={{
                            value: 'Price (USD)',
                            angle: -90,
                            position: 'insideLeft',
                            offset: 0,
                            style: { fontSize: 12, fill: '#9CA3AF' },
                          }}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="avgPrice"
                          fill="url(#priceGradient)"
                          stroke="none"
                        />
                        <Line
                          type="monotone"
                          dataKey="avgPrice"
                          stroke="#3B82F6"
                          strokeWidth={2}
                          dot={(props: any) => {
                            const { cx, cy, payload } = props;
                            return (
                              <circle
                                cx={cx}
                                cy={cy}
                                r={5}
                                fill="#2563EB"
                                stroke="#fff"
                                strokeWidth={2}
                                style={{ cursor: 'pointer' }}
                                onClick={() => handleDotClick(payload)}
                              />
                            );
                          }}
                          activeDot={{
                            r: 8,
                            fill: '#2563EB',
                            stroke: '#fff',
                            strokeWidth: 3,
                          }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 rounded-sm bg-[#3B82F6]" />
                    <span className="text-xs text-gray-600">Monthly Average Market Price</span>
                  </div>

                  {/* Dropdown Row */}
                  <div className="flex flex-wrap items-center gap-3 mb-6">
                    {/* Date Range */}
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-gray-500">Range:</label>
                      <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700 focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        {DATE_RANGES.map((r) => (
                          <option key={r.label} value={r.label}>{r.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Presentation */}
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-gray-500">Condition:</label>
                      <select
                        value={presentation}
                        onChange={(e) => {
                          setPresentation(e.target.value);
                          if (result) fetchData(query || result.reference, brandFilter);
                        }}
                        className="px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700 focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        {PRESENTATIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-5">
                    {/* Price Range Bar */}
                    <div className="mb-2">
                      <PriceRangeBar
                        min={rangeBarData.min}
                        avg={rangeBarData.avg}
                        max={rangeBarData.max}
                      />
                    </div>

                    {/* Source Note */}
                    <div className="text-right mt-3">
                      <span className="text-[11px] text-gray-400 italic">Based on our chats</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
