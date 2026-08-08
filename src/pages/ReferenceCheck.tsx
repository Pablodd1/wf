/**
 * Reference Check — Dealer tool for looking up reference pricing
 * Enter a reference number → see all listings, price stats, dial breakdown
 * Real data from Supabase. No mock data.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, Database, Loader2, TrendingUp, TrendingDown,
  ArrowRight, ExternalLink, Eye, BarChart3,
} from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';


interface Listing {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_usd: number;
  raw_message: string;
  source: string;
  created_at: string;
  verdict: string;
  confidence: number;
}

function fmtPrice(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

// ─── IQR Outliers ────────────────────────────────────────────────────
function detectOutliers(prices: number[]): { removed: number[]; q1: number; q3: number } {
  if (prices.length < 4) return { removed: [], q1: 0, q3: 0 };
  const s = [...prices].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return { removed: prices.filter(p => p < lower || p > upper), q1, q3 };
}

// ─── Dial color dot ──────────────────────────────────────────────────
function DialDot({ color }: { color: string }) {
  const colors: Record<string, string> = {
    White: '#f5f5f5', Black: '#222', Blue: '#3B5BFE', Green: '#10b981',
    Silver: '#c0c0c0', Champagne: '#f7e7ce', Grey: '#888', Gray: '#888',
    Red: '#ef4444', Brown: '#92400e', 'Mother of Pearl': '#e0e7ff', MOP: '#e0e7ff',
  };
  return <span className="w-2.5 h-2.5 rounded-full border border-gray-200 inline-block" style={{ backgroundColor: colors[color] || '#ddd' }} />;
}

export default function ReferenceCheck() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlRef = searchParams.get('ref') || '';

  const [inputRef, setInputRef] = useState(urlRef);
  const [reference, setReference] = useState(urlRef);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(!!urlRef);

  const fetchData = useCallback(async (ref: string) => {
    if (!ref) return;
    setLoading(true);
    setReference(ref);
    setSearched(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/price_research_verified_source?select=*&reference=ilike.*${encodeURIComponent(ref)}*&limit=500`,
        { headers: REQ_HEADERS }
      );
      const data = await res.json();
      setListings(data || []);
    } catch {
      setListings([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (urlRef) fetchData(urlRef); }, [urlRef, fetchData]);

  const handleSearch = () => {
    if (!inputRef.trim()) return;
    navigate(`/reference-check?ref=${encodeURIComponent(inputRef.trim())}`);
    fetchData(inputRef.trim());
  };

  // ─── Stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!listings.length) return null;
    const prices = listings.map(l => l.price_usd).filter(p => p > 0).sort((a, b) => a - b);
    if (!prices.length) return null;
    const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    const { removed: outlierPrices, q1, q3 } = detectOutliers(prices);
    const cleanPrices = prices.filter(p => !outlierPrices.includes(p));
    const cleanAvg = cleanPrices.length ? Math.round(cleanPrices.reduce((s, p) => s + p, 0) / cleanPrices.length) : avg;

    // Per dial
    const dialMap = new Map<string, { count: number; prices: number[] }>();
    for (const l of listings) {
      if (!l.price_usd) continue;
      const c = l.dial_color || 'Unknown';
      const e = dialMap.get(c) || { count: 0, prices: [] };
      e.count++;
      e.prices.push(l.price_usd);
      dialMap.set(c, e);
    }
    const dialStats = Array.from(dialMap.entries())
      .map(([color, v]) => ({
        color, count: v.count,
        avg: Math.round(v.prices.reduce((s, p) => s + p, 0) / v.prices.length),
        min: Math.min(...v.prices),
        max: Math.max(...v.prices),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      total: listings.length,
      priced: prices.length,
      min: prices[0],
      max: prices[prices.length - 1],
      avg,
      median: prices[Math.floor(prices.length / 2)],
      outlierCount: outlierPrices.length,
      outlierPrices,
      cleanMin: cleanPrices[0] || 0,
      cleanMax: cleanPrices[cleanPrices.length - 1] || 0,
      cleanAvg,
      q1, q3,
      dialStats,
      brand: listings[0]?.brand || '',
    };
  }, [listings]);

  const watchImage = stats ? resolveWatchImage(reference, stats.brand) : '';

  return (
    <div className="min-h-screen bg-white">
      <DealerNavbar />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <BarChart3 size={24} className="text-[#3B5BFE]" />
            <h1 className="text-3xl font-light text-gray-900">Reference Check</h1>
          </div>
          <p className="text-sm text-gray-500">Enter a watch reference to see pricing data, market stats, and all listings</p>
        </div>

        {/* Search */}
        <div className="max-w-xl mx-auto mb-10">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={inputRef}
                onChange={e => setInputRef(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="e.g. 178273, 5711, 126610LN..."
                className="w-full pl-9 pr-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] bg-white"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-3 bg-[#3B5BFE] hover:bg-[#2a4ad9] text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Check
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center py-16">
            <Loader2 size={32} className="animate-spin text-[#3B5BFE] mb-3" />
            <p className="text-sm text-gray-400">Searching reference {reference}...</p>
          </div>
        )}

        {/* No results */}
        {!loading && searched && listings.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Database size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg text-gray-500">No listings found for {reference}</p>
          </div>
        )}

        {/* Results */}
        {stats && !loading && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

            {/* Watch Header */}
            <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-gradient-to-r from-gray-50 to-blue-50/30 rounded-xl border border-gray-200">
              {watchImage ? (
                <img src={watchImage} alt={reference} className="w-28 h-28 object-contain rounded-lg bg-white shadow-sm" />
              ) : (
                <div className="w-28 h-28 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                  <span className="text-4xl opacity-20">⌚</span>
                </div>
              )}
              <div className="flex-1 text-center sm:text-left">
                <h2 className="text-xl font-semibold text-gray-900">{stats.brand} {reference}</h2>
                <p className="text-sm text-gray-500 mt-1">{stats.priced} priced listings out of {stats.total} total</p>
                <div className="flex flex-wrap gap-2 mt-3 justify-center sm:justify-start">
                  {stats.dialStats.slice(0, 6).map(d => (
                    <span key={d.color} className="px-2.5 py-1 bg-white rounded-full text-[11px] font-medium text-gray-600 border border-gray-200 shadow-sm flex items-center gap-1">
                      <DialDot color={d.color} /> {d.color}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-[#3B5BFE]">{fmtShort(stats.cleanAvg)}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">Clean Avg</div>
              </div>
            </div>

            {/* 4 Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Original */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-[#3B5BFE] text-white px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
                  <Database size={14} /> Stats (Original)
                </div>
                <div className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Data Points:</span><span className="font-bold text-gray-900">{stats.priced}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Min:</span><span className="font-mono font-semibold">{fmtPrice(stats.min)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Avg:</span><span className="font-mono font-semibold text-[#3B5BFE]">{fmtPrice(stats.avg)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Max:</span><span className="font-mono font-semibold">{fmtPrice(stats.max)}</span></div>
                </div>
              </div>

              {/* Duplicates */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-gray-500 text-white px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
                  <TrendingDown size={14} /> Duplicated
                </div>
                <div className="p-4 text-center">
                  <div className="text-3xl font-bold text-gray-700">{stats.outlierCount}</div>
                  <div className="text-xs text-gray-500 uppercase mt-1">Removed</div>
                  {stats.outlierPrices.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 justify-center">
                      {stats.outlierPrices.map((p, i) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-100 rounded text-[11px] font-mono text-gray-600">{fmtPrice(p)}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Filtered */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-green-600 text-white px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
                  <TrendingUp size={14} /> Stats (Filtered)
                </div>
                <div className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Data Points:</span><span className="font-bold text-gray-900">{stats.priced - stats.outlierCount}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Min:</span><span className="font-mono font-semibold">{fmtPrice(stats.cleanMin)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Avg:</span><span className="font-mono font-semibold text-green-600">{fmtPrice(stats.cleanAvg)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Max:</span><span className="font-mono font-semibold">{fmtPrice(stats.cleanMax)}</span></div>
                </div>
              </div>

              {/* Outliers */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-red-500 text-white px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
                  <Eye size={14} /> Outliers
                </div>
                <div className="p-4 text-center">
                  <div className="text-3xl font-bold text-gray-700">{stats.outlierCount}</div>
                  <div className="text-xs text-gray-500 uppercase mt-1">IQR Method</div>
                  <div className="text-xs text-gray-400 mt-1">Q1={fmtShort(stats.q1)} Q3={fmtShort(stats.q3)}</div>
                </div>
              </div>
            </div>

            {/* Dial Breakdown Table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Dial Color Breakdown</h3>
                <button
                  onClick={() => navigate(`/price-research`)}
                  className="text-xs text-[#3B5BFE] hover:underline flex items-center gap-1"
                >
                  Full Analysis <ArrowRight size={12} />
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-2.5">Dial Color</th>
                    <th className="px-4 py-2.5 text-right">Listings</th>
                    <th className="px-4 py-2.5 text-right">Min</th>
                    <th className="px-4 py-2.5 text-right">Avg</th>
                    <th className="px-4 py-2.5 text-right">Max</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dialStats.map((d, i) => (
                    <tr key={d.color}
                      className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/50 cursor-pointer transition-colors group`}
                      onClick={() => navigate(`/insight?ref=${encodeURIComponent(reference)}&dial=${encodeURIComponent(d.color)}&brand=${encodeURIComponent(stats.brand)}`)}
                    >
                      <td className="px-5 py-3 font-medium text-gray-900 flex items-center gap-2">
                        <DialDot color={d.color} /> {d.color}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{d.count}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600">{fmtShort(d.min)}</td>
                      <td className="px-4 py-3 text-right font-mono text-[#3B5BFE] font-semibold">{fmtShort(d.avg)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600">{fmtShort(d.max)}</td>
                      <td className="px-4 py-3 text-right">
                        <ArrowRight size={14} className="text-gray-300 group-hover:text-[#3B5BFE] transition-colors inline-block" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Individual Listings */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Listings</h3>
              <div className="space-y-3">
                {listings.filter(l => l.price_usd > 0).map((listing, idx) => {
                  const img = resolveWatchImage(listing.reference, listing.brand);
                  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' :
                    listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
                  return (
                    <motion.div key={listing.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx * 0.03, 0.5) }}
                      className="flex gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:shadow-md transition-all cursor-pointer"
                      onClick={() => navigate(`/flash-sales/${listing.id}`)}
                    >
                      {img ? (
                        <img src={img} alt={listing.reference} className="w-20 h-20 object-cover rounded-lg flex-shrink-0" loading="lazy" />
                      ) : (
                        <div className={`w-20 h-20 rounded-lg bg-gradient-to-br ${getBrandGradient(listing.brand)} flex items-center justify-center flex-shrink-0`}>
                          <span className="text-2xl opacity-30">⌚</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{listing.raw_message || `${listing.brand} ${listing.reference}`}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                          <span className="font-mono font-bold text-gray-900">{fmtPrice(listing.price_usd)}</span>
                          <span>•</span>
                          <span>{region}</span>
                          <span>•</span>
                          <span className="font-mono">{listing.source}</span>
                          <span>•</span>
                          <span>{listing.dial_color || 'Unknown'} dial</span>
                          {listing.condition && <><span>•</span><span>{listing.condition}</span></>}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Posted: {listing.created_at?.slice(0, 10)}</p>
                      </div>
                      <div className="flex-shrink-0 flex items-center">
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#3B5BFE] text-[#3B5BFE] text-[11px] font-semibold rounded-full hover:bg-[#3B5BFE] hover:text-white transition-colors">
                          <ExternalLink size={11} /> View
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
