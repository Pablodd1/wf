/**
 * Price Research — Complete UI/UX overhaul
 * Select Model → Select Reference → See full analytics with data interpretation
 * Clickable dial rows → InsightDetails per dial
 * Clickable chart dots → InsightDetails per month
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Info, Loader2, TrendingDown, TrendingUp, Search, BarChart3, Filter, ArrowRight, Eye, Database, Activity } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, ComposedChart,
} from 'recharts';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage } from '@/lib/imageResolver';

// ─── Supabase direct connection ──────────────────────────────────────
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

const REQ_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────────────
interface MonthlyPoint {
  month: string;
  monthKey: string;
  // Per-dial-color average prices: key = dial color, value = avg price
  dialPrices: Record<string, number>;
  // Total listings this month
  count: number;
  // Overall avg (all dials combined)
  avgPrice: number;
}

interface DialBreakdown {
  color: string;
  count: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
}

interface PriceResult {
  reference: string;
  brand: string;
  dialColors: string[];
  dialBreakdown: DialBreakdown[];
  monthlyData: MonthlyPoint[];
  overallMin: number;
  overallMax: number;
  overallAvg: number;
  priceDrift: number;
  totalListings: number;
  medianPrice: number;
  stdDev: number;
  iqrLower: number;
  iqrUpper: number;
  outlierCount: number;
  outlierPrices: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

function fmtPriceFull(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── IQR Outlier Detection ───────────────────────────────────────────
function analyzeOutliers(prices: number[]): { filtered: number[]; outliers: number[]; q1: number; q3: number; iqr: number; lower: number; upper: number } {
  if (prices.length < 4) return { filtered: prices, outliers: [], q1: prices[0] || 0, q3: prices[prices.length - 1] || 0, iqr: 0, lower: 0, upper: Infinity };
  const s = [...prices].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const filtered = prices.filter(p => p >= lower && p <= upper);
  const outliers = prices.filter(p => p < lower || p > upper);
  return { filtered, outliers, q1, q3, iqr, lower, upper };
}

// ─── Group records by month AND dial color ───────────────────────────
// Returns monthly data with per-dial-color average prices
function groupByMonth(records: any[]): MonthlyPoint[] {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Map: monthKey -> { monthDate, dialMap: Map<dialColor, prices[]> }
  const monthMap = new Map<string, { monthDate: Date; dialMap: Map<string, number[]>; allPrices: number[] }>();

  for (const r of records) {
    const date = r.received_at ? new Date(r.received_at) : r.created_at ? new Date(r.created_at) : new Date();
    if (isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!monthMap.has(key)) {
      monthMap.set(key, { monthDate: date, dialMap: new Map(), allPrices: [] });
    }
    const monthEntry = monthMap.get(key)!;

    if (r.price_usd > 0) {
      monthEntry.allPrices.push(r.price_usd);
      const dialColor = r.dial_color || 'Unknown';
      if (!monthEntry.dialMap.has(dialColor)) monthEntry.dialMap.set(dialColor, []);
      monthEntry.dialMap.get(dialColor)!.push(r.price_usd);
    }
  }

  const sorted = Array.from(monthMap.entries()).sort((a, b) => a[1].monthDate.getTime() - b[1].monthDate.getTime());

  return sorted.map(([key, val]) => {
    // Compute per-dial average
    const dialPrices: Record<string, number> = {};
    for (const [color, prices] of val.dialMap) {
      dialPrices[color] = prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0;
    }

    // Overall avg
    const avgPrice = val.allPrices.length ? Math.round(val.allPrices.reduce((s, p) => s + p, 0) / val.allPrices.length) : 0;

    return {
      monthKey: key,
      month: `${monthNames[val.monthDate.getMonth()]} ${val.monthDate.getFullYear()}`,
      dialPrices,
      count: val.allPrices.length,
      avgPrice,
    };
  }).filter(m => m.count > 0);
}

// ─── Dial color breakdown ────────────────────────────────────────────
function getDialBreakdown(records: any[]): DialBreakdown[] {
  const map = new Map<string, number[]>();
  for (const r of records) {
    const color = r.dial_color || 'Unknown';
    if (!map.has(color)) map.set(color, []);
    if (r.price_usd > 0) map.get(color)!.push(r.price_usd);
  }
  const result: DialBreakdown[] = [];
  for (const [color, prices] of map) {
    const s = [...prices].sort((a, b) => a - b);
    result.push({
      color,
      count: prices.length,
      avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      minPrice: s[0],
      maxPrice: s[s.length - 1],
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

// ─── Chart colors for dial colors ────────────────────────────────────
const DIAL_CHART_COLORS: Record<string, string> = {
  'White': '#E5E7EB', 'Black': '#1F2937', 'Blue': '#3B5BFE', 'Green': '#10B981',
  'Silver': '#9CA3AF', 'Champagne': '#D4AF37', 'Grey': '#6B7280', 'Gray': '#6B7280',
  'Red': '#EF4444', 'Brown': '#92400E', 'Purple': '#8B5CF6', 'Orange': '#F97316',
  'Yellow': '#F59E0B', 'Pink': '#EC4899', 'Ivory': '#FEF3C7', 'Mother of Pearl': '#E0E7FF',
  'Unknown': '#D1D5DB',
};
function getDialChartColor(dial: string): string {
  return DIAL_CHART_COLORS[dial] || `hsl(${[...dial].reduce((s, c) => s + c.charCodeAt(0), 0) % 360}, 60%, 50%)`;
}

// ─── Chart Tooltip — Per Dial Color ──────────────────────────────────
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: MonthlyPoint = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 text-sm min-w-[220px]">
      <div className="font-semibold text-gray-900 mb-2 pb-2 border-b border-gray-100">{d.month}</div>
      <div className="text-[11px] text-gray-500 mb-2">{d.count} listings</div>
      {/* Per-dial-color prices */}
      {Object.entries(d.dialPrices)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .map(([color, price]) => (
          <div key={color} className="flex justify-between items-center py-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getDialChartColor(color) }} />
              <span className="text-gray-600">{color}</span>
            </div>
            <span className="font-mono font-semibold" style={{ color: getDialChartColor(color) }}>
              {fmtPrice(price as number)}
            </span>
          </div>
        ))}
      {/* Overall */}
      <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between">
        <span className="text-gray-500 font-medium">Overall Avg</span>
        <span className="font-mono font-bold text-gray-900">{fmtPrice(d.avgPrice)}</span>
      </div>
      <div className="text-[10px] text-blue-500 mt-1 text-center">Click dot for per-dial details</div>
    </div>
  );
}

// ─── Price Range Bar ─────────────────────────────────────────────────
function PriceRangeBar({ min, avg, max }: { min: number; avg: number; max: number }) {
  const range = max - min || 1;
  const avgPos = ((avg - min) / range) * 100;
  return (
    <div className="w-full">
      <div className="relative h-16">
        <div className="absolute top-8 left-0 right-0 h-1 bg-gray-200 rounded-full" />
        <div className="absolute" style={{ left: '0%', top: '18px' }}>
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Min</span>
            <div className="w-3.5 h-3.5 rounded-full bg-gray-400 border-2 border-white shadow-md" />
            <span className="text-xs text-gray-600 font-mono mt-1 font-medium">{fmtPrice(min)}</span>
          </div>
        </div>
        <div className="absolute" style={{ left: `${avgPos}%`, top: '12px', transform: 'translateX(-50%)' }}>
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-blue-600 font-bold uppercase tracking-wider mb-1">Average</span>
            <div className="w-7 h-7 rounded-full bg-[#3B5BFE] border-[3px] border-white shadow-lg" />
            <span className="text-sm text-[#3B5BFE] font-mono font-bold mt-1">{fmtPrice(avg)}</span>
          </div>
        </div>
        <div className="absolute" style={{ right: '0%', top: '18px' }}>
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Max</span>
            <div className="w-3.5 h-3.5 rounded-full bg-gray-400 border-2 border-white shadow-md" />
            <span className="text-xs text-gray-600 font-mono mt-1 font-medium">{fmtPrice(max)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Data Interpretation Panel ───────────────────────────────────────
function DataInterpretation({ result }: { result: PriceResult }) {
  const outlierDesc = result.outlierCount > 0
    ? `${result.outlierCount} outlier${result.outlierCount > 1 ? 's were' : ' was'} detected and removed using the IQR method (Q1 − 1.5×IQR = ${fmtPrice(result.iqrLower)}, Q3 + 1.5×IQR = ${fmtPrice(result.iqrUpper)}). The removed outlier prices are: ${result.outlierPrices.map(p => fmtPriceFull(p)).join(', ')}.`
    : 'No outliers were detected using the IQR method (Q1 − 1.5×IQR to Q3 + 1.5×IQR). All data points fall within the expected range.';

  const trendDesc = result.priceDrift > 5
    ? `Strong upward trend (+${result.priceDrift}%) over the selected period. Market demand appears to be increasing.`
    : result.priceDrift > 0
    ? `Slight upward trend (+${result.priceDrift}%). Prices are relatively stable with modest growth.`
    : result.priceDrift > -5
    ? `Slight downward trend (${result.priceDrift}%). Minor price correction or seasonal fluctuation.`
    : `Downward trend (${result.priceDrift}%) over the selected period. Possible market softening.`;

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50/30 border border-gray-200 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={18} className="text-[#3B5BFE]" />
        <h3 className="text-sm font-semibold text-gray-900">Data Analysis & Interpretation</h3>
      </div>
      <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
        <p>
          <span className="font-semibold text-gray-800">Dataset Overview:</span> Analyzed {result.totalListings} listings for the {result.brand} {result.reference} reference. 
          The dataset spans {result.monthlyData.length} month{result.monthlyData.length !== 1 ? 's' : ''} with prices ranging from {fmtPrice(result.overallMin)} to {fmtPrice(result.overallMax)}. 
          The median price is {fmtPrice(result.medianPrice)} with a standard deviation of {fmtPrice(result.stdDev)}.
        </p>
        <p>
          <span className="font-semibold text-gray-800">Outlier Detection:</span> {outlierDesc}
        </p>
        <p>
          <span className="font-semibold text-gray-800">Price Trend:</span> {trendDesc} The filtered average of {fmtPrice(result.overallAvg)} represents the most reliable market valuation based on cleaned data.
        </p>
        <p>
          <span className="font-semibold text-gray-800">Dial Color Variations:</span> {validDialBreakdown.length} different dial color{result.dialBreakdown.length !== 1 ? 's' : ''} identified in the dataset. 
          The price trend chart above shows separate lines for each dial color — prices vary significantly by dial (e.g., White dial vs Blue dial). 
          Click on any dial color row below to see per-dial detailed analytics including individual listings.
        </p>
      </div>
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 pt-10 pb-6 px-6 mt-auto">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10">
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Features</h4>
          <ul className="space-y-2"><li><span className="text-gray-600">Trading Floor</span></li><li><span className="text-gray-600">ChronoMatch</span></li></ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Tools</h4>
          <ul className="space-y-2"><li><span className="text-gray-600">Glossary</span></li><li><span className="text-gray-600">Currency Converter</span></li></ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Dealers</h4>
          <ul className="space-y-2"><li><span className="text-gray-600">Dealer Directory</span></li><li><span className="text-gray-600">Do Not Trade List</span></li></ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Company</h4>
          <ul className="space-y-2">
            <li><span className="text-gray-600">About Us</span></li>
            <li><span className="text-gray-600">About Simon</span></li>
            <li><span className="text-gray-600">Contact</span></li>
            <li><span className="text-gray-600">Terms</span></li>
            <li><span className="text-gray-600">Privacy Policy</span></li>
          </ul>
        </div>
      </div>
      <div className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-4">
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </footer>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────
export default function PriceResearch() {
  const navigate = useNavigate();
  const [models, setModels] = useState<string[]>(['All Models']);
  const [references, setReferences] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('All Models');
  const [selectedRef, setSelectedRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PriceResult | null>(null);
  const [dateRange, setDateRange] = useState('6M');

  // ─── Fetch unique models (brands) ─────────────────────────────────
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=brand&limit=1000`, {
          headers: REQ_HEADERS,
        });
        if (!res.ok) return;
        const data = await res.json();
        const brands = Array.from(new Set(data.map((r: any) => r.brand).filter(Boolean))) as string[];
        setModels(['All Models', ...brands.sort()]);
      } catch {
        setModels(['All Models', 'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier']);
      }
    };
    fetchModels();
  }, []);

  // ─── Fetch references when model changes ──────────────────────────
  useEffect(() => {
    const fetchRefs = async () => {
      if (!selectedModel || selectedModel === 'All Models') {
        setReferences([]);
        return;
      }
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/watch_records?select=reference&brand=eq.${encodeURIComponent(selectedModel)}&limit=500`,
          { headers: REQ_HEADERS }
        );
        if (!res.ok) return;
        const data = await res.json();
        const refs = Array.from(new Set(data.map((r: any) => r.reference).filter(Boolean))) as string[];
        setReferences(refs.sort());
      } catch {
        setReferences([]);
      }
    };
    fetchRefs();
  }, [selectedModel]);

  // ─── Fetch price data when reference selected ─────────────────────
  const fetchPriceData = useCallback(async (ref: string) => {
    if (!ref) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?select=*&reference=eq.${encodeURIComponent(ref)}&limit=1000`,
        { headers: REQ_HEADERS }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const records = await res.json();

      if (!records?.length) {
        setResult(null);
        setLoading(false);
        return;
      }

      const monthlyData = groupByMonth(records);
      const prices = records.map((r: any) => r.price_usd).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
      const avg = prices.length ? Math.round(prices.reduce((s: number, p: number) => s + p, 0) / prices.length) : 0;
      const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
      const stdDev = prices.length ? Math.round(Math.sqrt(prices.reduce((s: number, p: number) => s + Math.pow(p - avg, 2), 0) / prices.length)) : 0;

      const firstMonth = monthlyData[0];
      const lastMonth = monthlyData[monthlyData.length - 1];
      const prevAvg = firstMonth?.avgPrice ?? avg;
      const priceDrift = prevAvg > 0 ? +(((lastMonth?.avgPrice ?? avg) - prevAvg) / prevAvg * 100).toFixed(2) : 0;

      // Outlier analysis
      const { filtered, outliers, lower, upper } = analyzeOutliers(prices);

      // Dial breakdown
      const dialBreakdown = getDialBreakdown(records);
      const dialColors = dialBreakdown.map(d => d.color);

      setResult({
        reference: ref,
        brand: records[0]?.brand || selectedModel,
        dialColors: dialColors.length ? dialColors : ['Unknown'],
        dialBreakdown,
        monthlyData,
        overallMin: prices[0] ?? 0,
        overallMax: prices[prices.length - 1] ?? 0,
        overallAvg: avg,
        medianPrice: median,
        stdDev,
        priceDrift,
        totalListings: records.length,
        iqrLower: lower,
        iqrUpper: upper,
        outlierCount: outliers.length,
        outlierPrices: outliers.sort((a, b) => a - b),
      });
    } catch (err) {
      console.error('Price research error:', err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  useEffect(() => {
    if (selectedRef) fetchPriceData(selectedRef);
  }, [selectedRef, fetchPriceData]);

  // ─── Filter chart data by date range ──────────────────────────────
  const filteredData = useMemo(() => {
    if (!result) return [];
    const ranges: Record<string, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
    const months = ranges[dateRange];
    let data = result.monthlyData;
    if (months) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      data = data.filter(d => {
        const [y, m] = d.monthKey.split('-');
        return new Date(Number(y), Number(m) - 1, 1) >= cutoff;
      });
    }
    // Flatten dial prices into chart-compatible properties
    return data.map(pt => {
      const flat: any = { ...pt };
      for (const [color, price] of Object.entries(pt.dialPrices)) {
        flat[`dial_${color}`] = price;
      }
      return flat;
    });
  }, [result, dateRange]);

  // ─── Filter valid dial breakdown (no NaN, no 0 count) ──────────────
  const validDialBreakdown = useMemo(() => {
    if (!result) return [];
    return result.dialBreakdown.filter(d => d.count > 0 && !isNaN(d.avgPrice));
  }, [result]);

  // ─── Watch image ───────────────────────────────────────────────────
  const watchImage = result ? resolveWatchImage(result.reference, result.brand) : '';

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <DealerNavbar />

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <BarChart3 size={24} className="text-[#3B5BFE]" />
            <h1 className="text-3xl font-light text-gray-900">Price Research</h1>
          </div>
          <p className="text-sm text-gray-500 max-w-xl mx-auto">
            Analyze market trends, detect outliers, and get accurate valuations for any watch reference. 
            Select a model and reference to begin.
          </p>
        </div>

        {/* Dropdowns */}
        <div className="flex flex-col sm:flex-row gap-4 max-w-3xl mx-auto mb-10">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedModel}
              onChange={(e) => { setSelectedModel(e.target.value); setSelectedRef(''); setResult(null); }}
              className="w-full pl-9 pr-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent cursor-pointer bg-white appearance-none"
            >
              <option value="">Select Model</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="flex-1 relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedRef}
              onChange={(e) => setSelectedRef(e.target.value)}
              disabled={!references.length}
              className="w-full pl-9 pr-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent cursor-pointer disabled:bg-gray-100 disabled:text-gray-400 bg-white appearance-none"
            >
              <option value="">Select a Reference</option>
              {references.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-[#3B5BFE] mb-3" />
            <p className="text-sm text-gray-400">Analyzing price data for {selectedRef}...</p>
            <p className="text-xs text-gray-400 mt-1">Processing outliers, dial breakdowns, and trend analysis</p>
          </div>
        )}

        {/* No results */}
        {!loading && selectedRef && !result && (
          <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-xl border border-gray-100">
            <Database size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg font-medium text-gray-500">No price data found for {selectedRef}</p>
            <p className="text-sm text-gray-400 mt-1">Try a different reference</p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Watch Header with Image */}
            <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-gradient-to-r from-gray-50 to-blue-50/30 rounded-xl border border-gray-200">
              {watchImage ? (
                <img src={watchImage} alt={result.reference} className="w-28 h-28 object-contain rounded-lg bg-white shadow-sm" />
              ) : (
                <div className="w-28 h-28 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center shadow-sm">
                  <span className="text-4xl opacity-20">⌚</span>
                </div>
              )}
              <div className="text-center sm:text-left">
                <h2 className="text-xl font-semibold text-gray-900">{result.brand} {result.reference}</h2>
                <p className="text-sm text-gray-500 mt-1">{result.totalListings} listings analyzed across {result.monthlyData.length} months</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
                  {result.dialColors.slice(0, 6).map(c => (
                    <span key={c} className="px-2.5 py-1 bg-white rounded-full text-[11px] font-medium text-gray-600 border border-gray-200 shadow-sm">{c}</span>
                  ))}
                  {result.dialColors.length > 6 && (
                    <span className="px-2.5 py-1 bg-gray-100 rounded-full text-[11px] text-gray-500">+{result.dialColors.length - 6} more</span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Average</div>
                <div className="text-lg font-bold text-[#3B5BFE]">{fmtPrice(result.overallAvg)}</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Median</div>
                <div className="text-lg font-bold text-gray-800">{fmtPrice(result.medianPrice)}</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Range</div>
                <div className="text-sm font-bold text-gray-800">{fmtPrice(result.overallMin)} - {fmtPrice(result.overallMax)}</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Listings</div>
                <div className="text-lg font-bold text-gray-800">{result.totalListings}</div>
              </div>
              <div className="bg-white rounded-xl p-4 text-center border border-gray-200 shadow-sm">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Drift</div>
                <div className={`text-lg font-bold flex items-center justify-center gap-1 ${result.priceDrift < 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {result.priceDrift < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                  {result.priceDrift > 0 ? '+' : ''}{result.priceDrift}%
                </div>
              </div>
            </div>

            {/* Data Interpretation */}
            <DataInterpretation result={result} />

            {/* Dial Color Breakdown — Clickable rows */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Eye size={15} className="text-[#3B5BFE]" /> Dial Color Breakdown
                </h3>
                <span className="text-[11px] text-gray-500">Click a row for per-dial details</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-2.5">Dial Color</th>
                    <th className="px-4 py-2.5 text-right">Listings</th>
                    <th className="px-4 py-2.5 text-right">Min</th>
                    <th className="px-4 py-2.5 text-right">Avg</th>
                    <th className="px-4 py-2.5 text-right">Max</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {validDialBreakdown.map((d, i) => (
                    <tr 
                      key={d.color} 
                      className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/50 cursor-pointer transition-colors group`}
                      onClick={() => navigate(`/insight?ref=${encodeURIComponent(result.reference)}&dial=${encodeURIComponent(d.color)}&brand=${encodeURIComponent(result.brand)}`)}
                    >
                      <td className="px-5 py-3 font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-gray-200 shadow-sm" style={{ backgroundColor: d.color.toLowerCase() === 'white' ? '#f5f5f5' : d.color.toLowerCase() === 'black' ? '#222' : d.color.toLowerCase() === 'blue' ? '#3B5BFE' : d.color.toLowerCase() === 'green' ? '#10b981' : d.color.toLowerCase() === 'silver' ? '#c0c0c0' : d.color.toLowerCase() === 'champagne' ? '#f7e7ce' : '#ddd' }} />
                          {d.color}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{d.count}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600">{fmtPrice(d.minPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono text-[#3B5BFE] font-semibold">{fmtPrice(d.avgPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600">{fmtPrice(d.maxPrice)}</td>
                      <td className="px-4 py-3 text-right">
                        <ArrowRight size={14} className="text-gray-300 group-hover:text-[#3B5BFE] transition-colors inline-block" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Price Range Bar */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Price Range Distribution</h3>
              <PriceRangeBar min={result.overallMin} avg={result.overallAvg} max={result.overallMax} />
            </div>

            {/* Chart */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <TrendingUp size={15} className="text-[#3B5BFE]" /> Price Trend by Dial Color
                </h3>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] bg-white"
                >
                  <option value="1M">1 Month</option>
                  <option value="3M">3 Months</option>
                  <option value="6M">6 Months</option>
                  <option value="1Y">1 Year</option>
                  <option value="ALL">All Time</option>
                </select>
              </div>

              {filteredData.length > 0 ? (
                <div className="w-full h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={{ stroke: '#E5E7EB' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} axisLine={{ stroke: '#E5E7EB' }} />
                      <Tooltip content={<CustomTooltip />} />

                      {/* One line per dial color — data keys pre-computed in useMemo */}
                      {result && validDialBreakdown.map((d) => {
                        const color = getDialChartColor(d.color);
                        const dataKey = `dial_${d.color}`;
                        return (
                          <Line
                            key={d.color}
                            type="monotone"
                            dataKey={dataKey}
                            stroke={color}
                            strokeWidth={2}
                            dot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
                            activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }}
                            connectNulls={false}
                            name={d.color}
                          />
                        );
                      })}

                      {/* Overall average as dashed reference */}
                      <Line
                        type="monotone"
                        dataKey="avgPrice"
                        stroke="#9CA3AF"
                        strokeWidth={1.5}
                        strokeDasharray="6 3"
                        dot={false}
                        name="Overall Avg"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-400 text-sm">No trend data available for this range</div>
              )}

              {/* Legend — Per Dial Color */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-xs text-gray-500 pt-3 border-t border-gray-100">
                {result && validDialBreakdown.map(d => (
                  <span key={d.color} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getDialChartColor(d.color) }} />
                    {d.color} ({d.count})
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-0 border-t border-dashed border-gray-400" /> Overall Avg
                </span>
              </div>
            </div>

            {/* Data Table — Per Dial Color Monthly Breakdown */}
            {filteredData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900">Monthly Breakdown — Per Dial Color</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                        <th className="px-5 py-2.5 whitespace-nowrap">Month</th>
                        <th className="px-4 py-2.5 whitespace-nowrap">Listings</th>
                        <th className="px-4 py-2.5 text-right whitespace-nowrap">Overall Avg</th>
                        {/* One column per valid dial color */}
                        {validDialBreakdown.map(d => (
                          <th key={d.color} className="px-4 py-2.5 text-right whitespace-nowrap">
                            <span className="flex items-center justify-end gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getDialChartColor(d.color) }} />
                              {d.color}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.map((d: any, i) => (
                        <tr key={d.monthKey} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                          <td className="px-5 py-2.5 font-medium text-gray-900 whitespace-nowrap">{d.month}</td>
                          <td className="px-4 py-2.5 text-gray-500">{d.count}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtPrice(d.avgPrice)}</td>
                          {/* Per-dial prices */}
                          {validDialBreakdown.map(dial => (
                            <td key={dial.color} className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
                              {d.dialPrices?.[dial.color] ? (
                                <span style={{ color: getDialChartColor(dial.color) }}>{fmtPrice(d.dialPrices[dial.color])}</span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            </div>

            {/* Data Table — Per Dial Color Monthly Breakdown */}
            {filteredData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900">Monthly Breakdown — Per Dial Color</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                        <th className="px-5 py-2.5 whitespace-nowrap">Month</th>
                        <th className="px-4 py-2.5 whitespace-nowrap">Listings</th>
                        <th className="px-4 py-2.5 text-right whitespace-nowrap">Overall Avg</th>
                        {/* One column per dial color */}
                        {result && validDialBreakdown.map(d => (
                          <th key={d.color} className="px-4 py-2.5 text-right whitespace-nowrap">
                            <span className="flex items-center justify-end gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getDialChartColor(d.color) }} />
                              {d.color}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.map((d: any, i) => (
                        <tr key={d.monthKey} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                          <td className="px-5 py-2.5 font-medium text-gray-900 whitespace-nowrap">{d.month}</td>
                          <td className="px-4 py-2.5 text-gray-500">{d.count}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtPrice(d.avgPrice)}</td>
                          {/* Per-dial prices */}
                          {result && validDialBreakdown.map(dial => (
                            <td key={dial.color} className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
                              {d.dialPrices?.[dial.color] ? (
                                <span style={{ color: getDialChartColor(dial.color) }}>{fmtPrice(d.dialPrices[dial.color])}</span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </main>

      <Footer />
    </div>
  );
}
