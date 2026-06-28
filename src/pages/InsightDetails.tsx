import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, Database } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { formatPrice } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/* ─── demo data ─── */
const DEMO_RECORDS: WatchRecord[] = [
  { id: '1', reference: '52508', brand: 'Rolex', family: '1908', price: 315000, originalPrice: 315000, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 92, mlPredictedPrice: 280000 },
  { id: '2', reference: '52508', brand: 'Rolex', family: '1908', price: 46000, originalPrice: 46000, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 88, mlPredictedPrice: 45000 },
  { id: '3', reference: '52508', brand: 'Rolex', family: '1908', price: 300000, originalPrice: 300000, originalCurrency: 'USD', condition: 'Unworn', year: 2024, dialColor: 'White', confidence: 45, mlPredictedPrice: 280000 },
  { id: '4', reference: '52508', brand: 'Rolex', family: '1908', price: 45500, originalPrice: 45500, originalCurrency: 'USD', condition: 'Like New', year: 2023, dialColor: 'White', confidence: 85, mlPredictedPrice: 44000 },
  { id: '5', reference: '52508', brand: 'Rolex', family: '1908', price: 196000, originalPrice: 196000, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 52, mlPredictedPrice: 180000 },
  { id: '6', reference: '52508', brand: 'Rolex', family: '1908', price: 42800, originalPrice: 42800, originalCurrency: 'USD', condition: 'Used', year: 2023, dialColor: 'White', confidence: 78, mlPredictedPrice: 42000 },
  { id: '7', reference: '52508', brand: 'Rolex', family: '1908', price: 1, originalPrice: 1, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 30, mlPredictedPrice: 45000 },
  { id: '8', reference: '52508', brand: 'Rolex', family: '1908', price: 26780, originalPrice: 26780, originalCurrency: 'USD', condition: 'Used', year: 2022, dialColor: 'White', confidence: 72, mlPredictedPrice: 28000 },
  { id: '9', reference: '52508', brand: 'Rolex', family: '1908', price: 1, originalPrice: 1, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 25, mlPredictedPrice: 45000 },
  { id: '10', reference: '52508', brand: 'Rolex', family: '1908', price: 42300, originalPrice: 42300, originalCurrency: 'USD', condition: 'Like New', year: 2023, dialColor: 'White', confidence: 82, mlPredictedPrice: 41000 },
  { id: '11', reference: '52508', brand: 'Rolex', family: '1908', price: 22309, originalPrice: 22309, originalCurrency: 'USD', condition: 'Used', year: 2021, dialColor: 'White', confidence: 68, mlPredictedPrice: 25000 },
  { id: '12', reference: '52508', brand: 'Rolex', family: '1908', price: 1, originalPrice: 1, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 35, mlPredictedPrice: 45000 },
  { id: '13', reference: '52508', brand: 'Rolex', family: '1908', price: 21780, originalPrice: 21780, originalCurrency: 'USD', condition: 'Used', year: 2020, dialColor: 'White', confidence: 70, mlPredictedPrice: 24000 },
  { id: '14', reference: '52508', brand: 'Rolex', family: '1908', price: 43900, originalPrice: 43900, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 90, mlPredictedPrice: 43000 },
  { id: '15', reference: '52508', brand: 'Rolex', family: '1908', price: 1908, originalPrice: 1908, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 20, mlPredictedPrice: 45000 },
  { id: '16', reference: '52508', brand: 'Rolex', family: '1908', price: 41200, originalPrice: 41200, originalCurrency: 'USD', condition: 'Used', year: 2022, dialColor: 'White', confidence: 75, mlPredictedPrice: 40000 },
  { id: '17', reference: '52508', brand: 'Rolex', family: '1908', price: 44800, originalPrice: 44800, originalCurrency: 'USD', condition: 'Like New', year: 2023, dialColor: 'White', confidence: 86, mlPredictedPrice: 42000 },
  { id: '18', reference: '52508', brand: 'Rolex', family: '1908', price: 1, originalPrice: 1, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 40, mlPredictedPrice: 45000 },
  { id: '19', reference: '52508', brand: 'Rolex', family: '1908', price: 26400, originalPrice: 26400, originalCurrency: 'USD', condition: 'Used', year: 2021, dialColor: 'White', confidence: 74, mlPredictedPrice: 27000 },
  { id: '20', reference: '52508', brand: 'Rolex', family: '1908', price: 43100, originalPrice: 43100, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 89, mlPredictedPrice: 42000 },
  { id: '21', reference: '52508', brand: 'Rolex', family: '1908', price: 39000, originalPrice: 39000, originalCurrency: 'USD', condition: 'Used', year: 2020, dialColor: 'White', confidence: 71, mlPredictedPrice: 38000 },
  { id: '22', reference: '52508', brand: 'Rolex', family: '1908', price: 44200, originalPrice: 44200, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 91, mlPredictedPrice: 43000 },
  { id: '23', reference: '52508', brand: 'Rolex', family: '1908', price: 22900, originalPrice: 22900, originalCurrency: 'USD', condition: 'Like New', year: 2022, dialColor: 'White', confidence: 73, mlPredictedPrice: 26000 },
  { id: '24', reference: '52508', brand: 'Rolex', family: '1908', price: 41500, originalPrice: 41500, originalCurrency: 'USD', condition: 'Used', year: 2021, dialColor: 'White', confidence: 77, mlPredictedPrice: 40000 },
  { id: '25', reference: '52508', brand: 'Rolex', family: '1908', price: 1908, originalPrice: 1908, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 22, mlPredictedPrice: 45000 },
  { id: '26', reference: '52508', brand: 'Rolex', family: '1908', price: 45100, originalPrice: 45100, originalCurrency: 'USD', condition: 'Unworn', year: 2024, dialColor: 'White', confidence: 87, mlPredictedPrice: 44000 },
  { id: '27', reference: '52508', brand: 'Rolex', family: '1908', price: 25600, originalPrice: 25600, originalCurrency: 'USD', condition: 'Used', year: 2019, dialColor: 'White', confidence: 69, mlPredictedPrice: 25000 },
  { id: '28', reference: '52508', brand: 'Rolex', family: '1908', price: 43500, originalPrice: 43500, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 88, mlPredictedPrice: 42000 },
  { id: '29', reference: '52508', brand: 'Rolex', family: '1908', price: 40500, originalPrice: 40500, originalCurrency: 'USD', condition: 'Used', year: 2020, dialColor: 'White', confidence: 76, mlPredictedPrice: 39000 },
  { id: '30', reference: '52508', brand: 'Rolex', family: '1908', price: 46000, originalPrice: 46000, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 93, mlPredictedPrice: 45000 },
  { id: '31', reference: '52508', brand: 'Rolex', family: '1908', price: 1, originalPrice: 1, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 28, mlPredictedPrice: 45000 },
  { id: '32', reference: '52508', brand: 'Rolex', family: '1908', price: 21900, originalPrice: 21900, originalCurrency: 'USD', condition: 'Used', year: 2021, dialColor: 'White', confidence: 67, mlPredictedPrice: 24000 },
  { id: '33', reference: '52508', brand: 'Rolex', family: '1908', price: 44400, originalPrice: 44400, originalCurrency: 'USD', condition: 'Like New', year: 2023, dialColor: 'White', confidence: 84, mlPredictedPrice: 43000 },
  { id: '34', reference: '52508', brand: 'Rolex', family: '1908', price: 1, originalPrice: 1, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 32, mlPredictedPrice: 45000 },
  { id: '35', reference: '52508', brand: 'Rolex', family: '1908', price: 23800, originalPrice: 23800, originalCurrency: 'USD', condition: 'Used', year: 2022, dialColor: 'White', confidence: 72, mlPredictedPrice: 26000 },
  { id: '36', reference: '52508', brand: 'Rolex', family: '1908', price: 45700, originalPrice: 45700, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 90, mlPredictedPrice: 44000 },
  { id: '37', reference: '52508', brand: 'Rolex', family: '1908', price: 42000, originalPrice: 42000, originalCurrency: 'USD', condition: 'Used', year: 2020, dialColor: 'White', confidence: 74, mlPredictedPrice: 41000 },
  { id: '38', reference: '52508', brand: 'Rolex', family: '1908', price: 22100, originalPrice: 22100, originalCurrency: 'USD', condition: 'Like New', year: 2021, dialColor: 'White', confidence: 70, mlPredictedPrice: 25000 },
  { id: '39', reference: '52508', brand: 'Rolex', family: '1908', price: 44500, originalPrice: 44500, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 89, mlPredictedPrice: 43000 },
  { id: '40', reference: '52508', brand: 'Rolex', family: '1908', price: 1908, originalPrice: 1908, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 18, mlPredictedPrice: 45000 },
];

/* ─── helpers ─── */
function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-');
  const start = `${year}-${mon}-01`;
  const lastDay = new Date(Number(year), Number(mon), 0).getDate();
  const end = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function detectDuplicates(records: WatchRecord[]): { unique: WatchRecord[]; duplicates: WatchRecord[] } {
  const seen = new Map<string, WatchRecord>();
  const duplicates: WatchRecord[] = [];

  for (const record of records) {
    const key = `${record.reference}-${record.price}-${record.condition}`;
    if (seen.has(key)) {
      duplicates.push(record);
    } else {
      seen.set(key, record);
    }
  }

  return { unique: Array.from(seen.values()), duplicates };
}

function detectOutliers(records: WatchRecord[]): { clean: WatchRecord[]; outliers: WatchRecord[] } {
  const prices = records.map(r => r.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 4) return { clean: records, outliers: [] };

  const q1Idx = Math.floor(prices.length * 0.25);
  const q3Idx = Math.floor(prices.length * 0.75);
  const q1 = prices[q1Idx];
  const q3 = prices[q3Idx];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;

  const clean: WatchRecord[] = [];
  const outliers: WatchRecord[] = [];

  for (const record of records) {
    if (record.price >= lower && record.price <= upper) {
      clean.push(record);
    } else {
      outliers.push(record);
    }
  }

  return { clean, outliers };
}

function calcStats(records: WatchRecord[]) {
  const prices = records.map(r => r.price).filter(p => p > 0);
  if (prices.length === 0) return { count: 0, min: 0, avg: 0, max: 0 };
  return {
    count: records.length,
    min: Math.min(...prices),
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    max: Math.max(...prices),
  };
}

function resolveWatchImage(brand: string, reference: string): string {
  const cleanBrand = brand.replace(/\s+/g, '_');
  const cleanRef = reference.replace(/[\/\s]/g, '_');
  const localPath = `/images/${cleanBrand}_${cleanRef}.png`;
  return localPath;
}

/* ─── stat card ─── */
interface StatCardProps {
  title: string;
  color: 'blue' | 'gray' | 'green' | 'red';
  dataPoints?: number;
  min?: number;
  avg?: number;
  max?: number;
  removed?: number;
  removedList?: number[];
}

function StatCard({ title, color, dataPoints, min, avg, max, removed, removedList }: StatCardProps) {
  const headerColors = {
    blue: 'bg-blue-600',
    gray: 'bg-gray-100 text-gray-700 border border-gray-200',
    green: 'bg-green-600',
    red: 'bg-red-500',
  };

  const textColorClass = color === 'gray' ? '' : 'text-white';

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
      <div className={`px-4 py-3 font-medium text-sm ${headerColors[color]} ${textColorClass}`}>
        {title}
      </div>
      <div className="bg-white p-4 space-y-2">
        {dataPoints !== undefined && (
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-sm">Data Points:</span>
            <span className="font-mono font-semibold text-gray-900">{dataPoints}</span>
          </div>
        )}
        {min !== undefined && (
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-sm">Min:</span>
            <span className="font-mono font-semibold text-gray-900">
              ${min.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
        {avg !== undefined && (
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-sm">Avg:</span>
            <span className="font-mono font-semibold text-gray-900">
              ${avg.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
        {max !== undefined && (
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-sm">Max:</span>
            <span className="font-mono font-semibold text-gray-900">
              ${max.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
        {removed !== undefined && (
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-sm">Removed:</span>
            <span className="font-mono font-semibold text-gray-900">{removed}</span>
          </div>
        )}
        {removedList && removedList.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 max-h-36 overflow-y-auto">
            {removedList.map((price, i) => (
              <div key={i} className="font-mono text-sm text-gray-600 py-0.5">
                ${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── main page ─── */
export default function InsightDetails() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const reference = searchParams.get('ref') || '';
  const month = searchParams.get('month') || '';
  const dial = searchParams.get('dial') || '';

  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingDemo, setUsingDemo] = useState(false);

  /* fetch */
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      if (!reference || !month) {
        setError('Missing reference or month parameter');
        setLoading(false);
        return;
      }

      const { start, end } = getMonthRange(month);

      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        try {
          const dialFilter = dial ? `&dial_color=eq.${encodeURIComponent(dial)}` : '';
          const url = `${SUPABASE_URL}/rest/v1/watch_records?reference=ilike.*${encodeURIComponent(reference)}*&received_at=gte.${start}&received_at=lte.${end}${dialFilter}&select=*&limit=1000`;

          const res = await fetch(url, {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data: WatchRecord[] = await res.json();

          if (!cancelled) {
            if (data.length === 0) {
              setRecords(DEMO_RECORDS);
              setUsingDemo(true);
            } else {
              setRecords(data);
              setUsingDemo(false);
            }
          }
        } catch (err) {
          console.warn('Supabase fetch failed, using demo data:', err);
          if (!cancelled) {
            setRecords(DEMO_RECORDS);
            setUsingDemo(true);
          }
        }
      } else {
        // No Supabase config — use demo data
        await new Promise(r => setTimeout(r, 600));
        if (!cancelled) {
          setRecords(DEMO_RECORDS);
          setUsingDemo(true);
        }
      }

      if (!cancelled) setLoading(false);
    }

    fetchData();
    return () => { cancelled = true; };
  }, [reference, month, dial]);

  /* pipeline calculations — OUTLIERS REMOVED FROM STATS */
  const {
    originalStats,
    duplicates,
    duplicateStats,
    outliers,
    outlierStats,
    filteredStats,
  } = useMemo(() => {
    // Step 1: Original stats (all records)
    const orig = calcStats(records);

    // Step 2: Remove duplicates
    const { unique: deduped, duplicates: dups } = detectDuplicates(records);
    const dupPrices = dups.map(r => r.price);

    // Step 3: Remove outliers FROM the deduped set
    const { clean, outliers: outs } = detectOutliers(deduped);
    const outPrices = outs.map(r => r.price);

    // Step 4: Filtered stats = calculated on CLEAN data only (no outliers)
    const filt = calcStats(clean);

    return {
      originalStats: orig,
      duplicates: dups,
      duplicateStats: { count: dups.length, prices: dupPrices },
      outliers: outs,
      outlierStats: { count: outs.length, prices: outPrices },
      // Filtered = stats with outliers EXCLUDED
      filteredStats: filt,
    };
  }, [records]);

  /* image source */
  const watchImage = useMemo(() => {
    if (records.length > 0 && records[0]?.brand) {
      return resolveWatchImage(records[0].brand, reference);
    }
    return '/watch-silhouette.svg';
  }, [records, reference]);

  /* watch metadata */
  const watchMeta = useMemo(() => {
    if (records.length === 0) return null;
    const first = records[0];
    return {
      name: first.family || first.reference,
      brand: first.brand,
      reference: first.reference,
    };
  }, [records]);

  const { start: rangeStart, end: rangeEnd } = useMemo(() => {
    if (!month) return { start: '', end: '' };
    return getMonthRange(month);
  }, [month]);

  /* ─── loading ─── */
  if (loading) {
    return (
      <div className="bg-white min-h-[calc(100dvh-56px)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading insight data...</p>
        </div>
      </div>
    );
  }

  /* ─── error ─── */
  if (error) {
    return (
      <div className="bg-white min-h-[calc(100dvh-56px)] p-5 max-w-[1400px] mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Price Research
        </button>
        <div className="flex items-center gap-3 text-red-500 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-[calc(100dvh-56px)] p-5 max-w-[1400px] mx-auto">
        {/* ── Back button ── */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6 transition-colors text-sm"
        >
          <ArrowLeft size={16} /> Back to Price Research
        </button>

        {/* ── Page Title ── */}
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Insight Details</h1>

        {/* ── Demo badge ── */}
        {usingDemo && (
          <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-6 text-sm">
            <Database size={14} />
            <span>Showing demo data (Supabase not configured or no results found)</span>
          </div>
        )}

        {/* ═══════════ TOP SECTION ═══════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* LEFT: Watch image + info */}
          <div className="flex flex-col items-center text-center">
            <div className="w-64 h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200 mb-5 overflow-hidden">
              <img
                src={watchImage}
                alt={watchMeta?.name || reference}
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/watch-silhouette.svg';
                }}
              />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {watchMeta?.name || reference}
            </h2>
            <p className="text-sm text-gray-500 mb-1">
              {watchMeta?.brand || 'Rolex'} · {dial || 'White'} Dial
            </p>
            <p className="text-sm font-mono text-gray-400">
              型號 {reference}
            </p>
          </div>

          {/* RIGHT: Reference details */}
          <div className="flex flex-col justify-center">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Reference Details
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-gray-500 text-xs block mb-0.5">Reference</span>
                  <span className="font-mono font-semibold text-gray-900 text-sm">{reference}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs block mb-0.5">Dial Color</span>
                  <span className="font-semibold text-gray-900 text-sm">{dial || 'White'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs block mb-0.5">Condition Category</span>
                  <span className="font-semibold text-gray-900 text-sm">Any</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs block mb-0.5">Date Range</span>
                  <span className="font-semibold text-gray-900 text-sm">
                    {rangeStart && rangeEnd
                      ? `Listings created from ${new Date(rangeStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${new Date(rangeEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════ BOTTOM SECTION — 4 STAT CARDS ═══════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {/* 1. Original Stats — Blue */}
          <StatCard
            title="Stats (Original)"
            color="blue"
            dataPoints={originalStats.count}
            min={originalStats.min}
            avg={originalStats.avg}
            max={originalStats.max}
          />

          {/* 2. Duplicates — Gray */}
          <StatCard
            title="Duplicated"
            color="gray"
            removed={duplicateStats.count}
            removedList={duplicateStats.prices}
          />

          {/* 3. Filtered Stats — Green */}
          <StatCard
            title="Stats (Filtered by custom math)"
            color="green"
            dataPoints={filteredStats.count}
            min={filteredStats.min}
            avg={filteredStats.avg}
            max={filteredStats.max}
          />

          {/* 4. Outliers — Red */}
          <StatCard
            title="Outliers"
            color="red"
            removed={outlierStats.count}
            removedList={outlierStats.prices}
          />
        </div>

        {/* ── Data pipeline flow ── */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500 mb-2">Data Processing Pipeline</p>
          <div className="flex items-center justify-center gap-2 text-xs">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Original ({originalStats.count})</span>
            <span className="text-gray-400">→</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" /> −{duplicateStats.count} Duplicates</span>
            <span className="text-gray-400">→</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> −{outlierStats.count} Outliers</span>
            <span className="text-gray-400">→</span>
            <span className="flex items-center gap-1 font-semibold text-green-700"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> Filtered ({filteredStats.count})</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 italic">
            Outliers are excluded from Min/Avg/Max calculations but reported separately
          </p>
        </div>
      </div>
  );
}
