/**
 * Price Research — Standalone page matching watchfacts.com/market-discovery/search
 * Select Model → Select Reference → See price charts with ALL 2.39M watches
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Info, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, ComposedChart,
} from 'recharts';
import { DealerNavbar } from '@/components/DealerNavbar';

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
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  count: number;
}

interface PriceResult {
  reference: string;
  brand: string;
  dialColors: string[];
  monthlyData: MonthlyPoint[];
  overallMin: number;
  overallMax: number;
  overallAvg: number;
  priceDrift: number;
  totalListings: number;
}

// ─── Helper: format price ────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

// ─── Helper: group records by month ──────────────────────────────────
function groupByMonth(records: any[]): MonthlyPoint[] {
  const map = new Map<string, { prices: number[]; monthDate: Date }>();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (const r of records) {
    const date = r.received_at ? new Date(r.received_at) : r.created_at ? new Date(r.created_at) : new Date();
    if (isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, { prices: [], monthDate: date });
    if (r.price_usd > 0) map.get(key)!.prices.push(r.price_usd);
  }

  const sorted = Array.from(map.entries()).sort((a, b) => a[1].monthDate.getTime() - b[1].monthDate.getTime());
  return sorted.map(([key, val]) => {
    const prices = val.prices.sort((a, b) => a - b);
    const avg = prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0;
    return {
      monthKey: key,
      month: `${monthNames[val.monthDate.getMonth()]} ${val.monthDate.getFullYear()}`,
      avgPrice: avg,
      minPrice: prices[0] ?? 0,
      maxPrice: prices[prices.length - 1] ?? 0,
      count: prices.length,
    };
  }).filter(m => m.count > 0);
}

// ─── Chart Tooltip ───────────────────────────────────────────────────
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: MonthlyPoint = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm min-w-[160px]">
      <div className="font-medium text-gray-900 mb-2 pb-1 border-b border-gray-100">{d.month}</div>
      <div className="space-y-1">
        <div className="flex justify-between text-gray-600"><span>Min:</span><span className="font-mono font-medium">{fmtPrice(d.minPrice)}</span></div>
        <div className="flex justify-between text-blue-600"><span>Avg:</span><span className="font-mono font-medium">{fmtPrice(d.avgPrice)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Max:</span><span className="font-mono font-medium">{fmtPrice(d.maxPrice)}</span></div>
      </div>
      <div className="text-gray-400 text-xs mt-2 pt-1 border-t border-gray-100">{d.count} listings</div>
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
        <div className="absolute top-8 left-0 right-0 h-0.5 bg-gray-200 rounded" />
        <div className="absolute" style={{ left: '0%', top: '20px' }}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-gray-400 mb-1">MIN</span>
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-white shadow" />
            <span className="text-xs text-gray-500 font-mono mt-1">{fmtPrice(min)}</span>
          </div>
        </div>
        <div className="absolute" style={{ left: `${avgPos}%`, top: '16px', transform: 'translateX(-50%)' }}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-blue-600 font-semibold mb-1">AVERAGE</span>
            <div className="w-6 h-6 rounded-full bg-blue-600 border-[3px] border-white shadow-md" />
            <span className="text-sm text-blue-600 font-mono font-bold mt-1">{fmtPrice(avg)}</span>
          </div>
        </div>
        <div className="absolute" style={{ right: '0%', top: '20px' }}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-gray-400 mb-1">MAX</span>
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-white shadow" />
            <span className="text-xs text-gray-500 font-mono mt-1">{fmtPrice(max)}</span>
          </div>
        </div>
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
  const [models, setModels] = useState<string[]>(['All Models']);
  const [references, setReferences] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('All Models');
  const [selectedRef, setSelectedRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PriceResult | null>(null);
  const [selectedDial, setSelectedDial] = useState('');
  const [dateRange, setDateRange] = useState('6M');

  // ─── Fetch unique models (brands) on mount ────────────────────────
  useEffect(() => {
    const fetchModels = async () => {
      try {
        // Get sample to extract unique brands
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=brand&limit=1000`, {
          headers: REQ_HEADERS,
        });
        if (!res.ok) return;
        const data = await res.json();
        const brands = Array.from(new Set(data.map((r: any) => r.brand).filter(Boolean))) as string[];
        setModels(['All Models', ...brands.sort()]);
      } catch {
        // fallback
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

      const firstMonth = monthlyData[0];
      const lastMonth = monthlyData[monthlyData.length - 1];
      const prevAvg = firstMonth?.avgPrice ?? avg;
      const priceDrift = prevAvg > 0 ? +(((lastMonth?.avgPrice ?? avg) - prevAvg) / prevAvg * 100).toFixed(2) : 0;

      const dialColors = Array.from(new Set(records.map((r: any) => r.dial_color).filter(Boolean))) as string[];

      setResult({
        reference: ref,
        brand: records[0]?.brand || selectedModel,
        dialColors: dialColors.length ? dialColors : ['Unknown'],
        monthlyData,
        overallMin: prices[0] ?? 0,
        overallMax: prices[prices.length - 1] ?? 0,
        overallAvg: avg,
        priceDrift,
        totalListings: records.length,
      });
      setSelectedDial(dialColors[0] || 'Unknown');
    } catch (err) {
      console.error('Price research error:', err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  // Auto-fetch when reference selected
  useEffect(() => {
    if (selectedRef) fetchPriceData(selectedRef);
  }, [selectedRef, fetchPriceData]);

  // ─── Filter chart data by date range ──────────────────────────────
  const filteredData = useMemo(() => {
    if (!result) return [];
    const ranges: Record<string, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
    const months = ranges[dateRange];
    if (!months) return result.monthlyData;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return result.monthlyData.filter(d => {
      const [y, m] = d.monthKey.split('-');
      return new Date(Number(y), Number(m) - 1, 1) >= cutoff;
    });
  }, [result, dateRange]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <DealerNavbar />

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light text-gray-900 mb-2">
            Price Research <Info size={20} className="inline text-blue-500" />
          </h1>
          <p className="text-sm text-gray-500">
            This feature is currently optimized for Rolex references only. Additional brands are planned for upcoming releases.
          </p>
        </div>

        {/* Dropdowns */}
        <div className="flex flex-col sm:flex-row gap-4 max-w-3xl mx-auto mb-10">
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); setSelectedRef(''); setResult(null); }}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          >
            <option value="">Select Model</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            value={selectedRef}
            onChange={(e) => setSelectedRef(e.target.value)}
            disabled={!references.length}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">Select a Reference</option>
            {references.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-blue-500 mb-3" />
            <p className="text-sm text-gray-400">Loading price data for {selectedRef}...</p>
          </div>
        )}

        {/* No results */}
        {!loading && selectedRef && !result && (
          <div className="text-center py-16 text-gray-400">
            <Info size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg">No price data found for {selectedRef}</p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Watch Header */}
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-900">
                {result.brand} {result.reference}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {result.totalListings} listings analyzed
              </p>
              {result.dialColors.length > 0 && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  {result.dialColors.map(c => (
                    <button
                      key={c}
                      onClick={() => setSelectedDial(c)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        selectedDial === c ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-[10px] text-gray-500 uppercase">Average</div>
                <div className="text-lg font-bold text-blue-600">{fmtPrice(result.overallAvg)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-[10px] text-gray-500 uppercase">Min</div>
                <div className="text-lg font-bold text-gray-700">{fmtPrice(result.overallMin)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-[10px] text-gray-500 uppercase">Max</div>
                <div className="text-lg font-bold text-gray-700">{fmtPrice(result.overallMax)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-[10px] text-gray-500 uppercase">Drift</div>
                <div className={`text-lg font-bold flex items-center justify-center gap-1 ${result.priceDrift < 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {result.priceDrift < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                  {result.priceDrift > 0 ? '+' : ''}{result.priceDrift}%
                </div>
              </div>
            </div>

            {/* Price Range Bar */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Price Range</h3>
              <PriceRangeBar min={result.overallMin} avg={result.overallAvg} max={result.overallMax} />
            </div>

            {/* Chart */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Price Trend</h3>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-600 focus:outline-none"
                >
                  <option value="1M">1M</option>
                  <option value="3M">3M</option>
                  <option value="6M">6M</option>
                  <option value="1Y">1Y</option>
                  <option value="ALL">ALL</option>
                </select>
              </div>

              {filteredData.length > 0 ? (
                <div className="w-full h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                      <defs>
                        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={{ stroke: '#E5E7EB' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} axisLine={{ stroke: '#E5E7EB' }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="avgPrice" fill="url(#pg)" stroke="none" />
                      <Line type="monotone" dataKey="avgPrice" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4, fill: '#2563EB', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="minPrice" stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="maxPrice" stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-400 text-sm">No trend data available for this range</div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 rounded" /> Avg Price</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-gray-400 border-dashed" /> Min/Max</span>
              </div>
            </div>

            {/* Data Table */}
            {filteredData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3">Month</th>
                      <th className="px-4 py-3">Listings</th>
                      <th className="px-4 py-3 text-right">Min</th>
                      <th className="px-4 py-3 text-right">Avg</th>
                      <th className="px-4 py-3 text-right">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.map((d, i) => (
                      <tr key={d.monthKey} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2.5 font-medium">{d.month}</td>
                        <td className="px-4 py-2.5 text-gray-500">{d.count}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(d.minPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-blue-600 font-medium">{fmtPrice(d.avgPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(d.maxPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </main>

      <Footer />
    </div>
  );
}
