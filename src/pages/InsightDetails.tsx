/**
 * Insight Details — Per-dial analytics for a specific reference
 * Shows: original stats, duplicate removal, outlier detection (IQR),
 * filtered stats, and individual listings
 * Triggered by clicking blue dot on Price Research chart
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, MessageCircle } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

interface Listing {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_usd: number;
  raw_message: string;
  source: string;
  received_at: string;
  year: number | null;
}

function fmtPrice(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ─── IQR Outlier Detection ───────────────────────────────────────────
function detectOutliers(prices: number[]): { filtered: number[]; removed: number[]; lowerFence: number; upperFence: number } {
  if (prices.length < 4) return { filtered: prices, removed: [], lowerFence: 0, upperFence: Infinity };
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const filtered = prices.filter(p => p >= lowerFence && p <= upperFence);
  const removed = prices.filter(p => p < lowerFence || p > upperFence);
  return { filtered, removed, lowerFence, upperFence };
}

// ─── Duplicate Detection ─────────────────────────────────────────────
function detectDuplicates(listings: Listing[]): { unique: Listing[]; duplicates: Listing[] } {
  const seen = new Map<string, Listing>();
  const duplicates: Listing[] = [];
  for (const l of listings) {
    // Key: same price + similar first 20 chars of raw message
    const key = `${l.price_usd}_${(l.raw_message || '').slice(0, 20).toLowerCase().trim()}`;
    if (seen.has(key)) {
      duplicates.push(l);
    } else {
      seen.set(key, l);
    }
  }
  return { unique: Array.from(seen.values()), duplicates };
}

// ─── Footer ──────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 pt-10 pb-6 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10">
        <div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Features</h4><ul className="space-y-2"><li><span className="text-gray-600">Trading Floor</span></li><li><span className="text-gray-600">ChronoMatch</span></li></ul></div>
        <div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Tools</h4><ul className="space-y-2"><li><span className="text-gray-600">Glossary</span></li><li><span className="text-gray-600">Currency Converter</span></li></ul></div>
        <div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Dealers</h4><ul className="space-y-2"><li><span className="text-gray-600">Dealer Directory</span></li><li><span className="text-gray-600">Do Not Trade List</span></li></ul></div>
        <div><h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Company</h4><ul className="space-y-2"><li><span className="text-gray-600">About Us</span></li><li><span className="text-gray-600">About Simon</span></li><li><span className="text-gray-600">Contact</span></li><li><span className="text-gray-600">Terms</span></li><li><span className="text-gray-600">Privacy Policy</span></li></ul></div>
      </div>
      <div className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-4">&copy; 2026 Watchfacts Inc. All Rights Reserved.</div>
    </footer>
  );
}

export default function InsightDetails() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || '';
  const dial = searchParams.get('dial') || 'Any';
  const month = searchParams.get('month') || '';

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch listings matching reference + dial color
  useEffect(() => {
    if (!ref) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        let url = `${SUPABASE_URL}/rest/v1/watch_records?select=*&reference=eq.${encodeURIComponent(ref)}&limit=1000`;
        if (dial && dial !== 'Any') {
          url += `&dial_color=eq.${encodeURIComponent(dial)}`;
        }
        // Filter by month if provided
        if (month) {
          const [year, mon] = month.split('-');
          const start = `${year}-${mon}-01`;
          const endMon = parseInt(mon) + 1;
          const endYear = endMon > 12 ? parseInt(year) + 1 : year;
          const endMonStr = endMon > 12 ? '01' : String(endMon).padStart(2, '0');
          const end = `${endYear}-${endMonStr}-01`;
          url += `&received_at=gte.${start}&received_at=lt.${end}`;
        }

        const res = await fetch(url, { headers: REQ_HEADERS });
        const data = await res.json();
        setListings(data || []);
      } catch {
        setListings([]);
      }
      setLoading(false);
    };
    fetchData();
  }, [ref, dial, month]);

  // ─── Stats calculations ────────────────────────────────────────────
  const stats = useMemo(() => {
    const allPrices = listings.map(l => l.price_usd).filter(p => p > 0);
    if (allPrices.length === 0) return null;

    // Original stats
    const origMin = Math.min(...allPrices);
    const origMax = Math.max(...allPrices);
    const origAvg = Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length);

    // Duplicate detection
    const { unique, duplicates } = detectDuplicates(listings);
    const uniquePrices = unique.map(l => l.price_usd).filter(p => p > 0);

    // Outlier detection on unique prices
    const { filtered: outlierFiltered, removed: outliers, lowerFence, upperFence } = detectOutliers(uniquePrices);

    // Filtered stats
    const filMin = outlierFiltered.length ? Math.min(...outlierFiltered) : 0;
    const filMax = outlierFiltered.length ? Math.max(...outlierFiltered) : 0;
    const filAvg = outlierFiltered.length ? Math.round(outlierFiltered.reduce((a, b) => a + b, 0) / outlierFiltered.length) : 0;

    return {
      origCount: allPrices.length,
      origMin, origMax, origAvg,
      dupCount: duplicates.length,
      dupPrices: duplicates.map(d => d.price_usd),
      filCount: outlierFiltered.length,
      filMin, filMax, filAvg,
      outlierCount: outliers.length,
      lowerFence, upperFence,
      uniqueListings: unique,
    };
  }, [listings]);

  // Date range string
  const dateRangeStr = useMemo(() => {
    if (listings.length === 0) return '';
    const dates = listings.map(l => l.received_at ? new Date(l.received_at) : null).filter(Boolean) as Date[];
    if (dates.length === 0) return '';
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(min)} to ${fmt(max)}`;
  }, [listings]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <DealerNavbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <DealerNavbar />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {/* Back link */}
        <Link to="/price-research" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors">
          <ArrowLeft size={16} /> Back to Price Research
        </Link>

        <h1 className="text-xl font-semibold text-gray-900 mb-6">Insight Details</h1>

        {/* Watch Info Header */}
        <div className="flex flex-col sm:flex-row gap-6 mb-8">
          {/* Watch Image Placeholder */}
          <div className="w-full sm:w-48 h-48 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
            <div className="text-center">
              <div className="text-5xl mb-2 opacity-20">
                {ref.startsWith('RM') ? '◇' : '⌚'}
              </div>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">{listings[0]?.brand || 'Watch'}</span>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm">
            <p><span className="font-semibold text-gray-900">Reference:</span> <span className="font-mono">{ref}</span></p>
            <p><span className="font-semibold text-gray-900">Dial Color:</span> {dial}</p>
            <p><span className="font-semibold text-gray-900">Condition Category:</span> Any</p>
            {dateRangeStr && (
              <p className="text-gray-500">Listings created from <span className="font-semibold text-gray-700">{dateRangeStr}</span></p>
            )}
          </div>
        </div>

        {!stats ? (
          <div className="text-center py-16 text-gray-400">No data found for this reference</div>
        ) : (
          <>
            {/* 4 Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">

              {/* Stats (Original) — Blue */}
              <div className="rounded-lg overflow-hidden border border-gray-200">
                <div className="bg-blue-600 text-white px-4 py-3 text-sm font-semibold">Stats (Original)</div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">Data Points:</span><span className="font-semibold">{stats.origCount}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Min:</span><span className="font-mono font-semibold">{fmtPrice(stats.origMin)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Avg:</span><span className="font-mono font-semibold">{fmtPrice(stats.origAvg)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Max:</span><span className="font-mono font-semibold">{fmtPrice(stats.origMax)}</span></div>
                </div>
              </div>

              {/* Duplicated — Gray */}
              <div className="rounded-lg overflow-hidden border border-gray-200">
                <div className="bg-gray-500 text-white px-4 py-3 text-sm font-semibold">Duplicated</div>
                <div className="p-4 space-y-3 text-sm text-center">
                  <div className="text-2xl font-bold text-gray-700">Removed: {stats.dupCount}</div>
                  {stats.dupPrices.length > 0 && (
                    <div className="text-gray-500 text-xs">{stats.dupPrices.map(p => fmtPrice(p)).join(', ')}</div>
                  )}
                </div>
              </div>

              {/* Stats (Filtered) — Green */}
              <div className="rounded-lg overflow-hidden border border-gray-200">
                <div className="bg-green-600 text-white px-4 py-3 text-sm font-semibold">Stats (Filtered by custom math)</div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">Data Points:</span><span className="font-semibold">{stats.filCount}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Min:</span><span className="font-mono font-semibold">{fmtPrice(stats.filMin)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Avg:</span><span className="font-mono font-semibold">{fmtPrice(stats.filAvg)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Max:</span><span className="font-mono font-semibold">{fmtPrice(stats.filMax)}</span></div>
                </div>
              </div>

              {/* Outliers — Red */}
              <div className="rounded-lg overflow-hidden border border-gray-200">
                <div className="bg-red-500 text-white px-4 py-3 text-sm font-semibold">Outliers</div>
                <div className="p-4 space-y-3 text-sm text-center">
                  <div className="text-2xl font-bold text-gray-700">Removed: {stats.outlierCount}</div>
                  {stats.outlierCount > 0 ? (
                    <div className="text-gray-500 text-xs">Outside {fmtPrice(stats.lowerFence)} - {fmtPrice(stats.upperFence)}</div>
                  ) : (
                    <div className="text-gray-400 text-xs">No outliers detected.</div>
                  )}
                </div>
              </div>

            </div>

            {/* Individual Listings */}
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Listings</h2>
            <div className="space-y-3">
              {stats.uniqueListings.map((listing, i) => (
                <motion.div
                  key={listing.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.5) }}
                  className="flex gap-4 p-4 border border-gray-200 rounded-lg hover:shadow-sm transition-shadow"
                >
                  {/* Listing Image */}
                  <div className="w-24 h-24 bg-gradient-to-br from-gray-100 to-gray-200 rounded flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl opacity-20">⌚</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
                      {listing.condition ? `${listing.condition} ` : ''}
                      {listing.brand} {listing.reference}
                      {listing.dial_color ? ` - ${listing.dial_color} Dial` : ''}
                      {listing.year ? ` (${listing.year})` : ''}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-1 mb-2">{listing.raw_message}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                      <span className="font-mono font-semibold text-gray-900">{fmtPrice(listing.price_usd)}</span>
                      <span>North America</span>
                      <span className="text-gray-400">{listing.source || 'Unknown'}</span>
                    </div>

                    <div className="text-[11px] text-gray-400 mt-1">
                      Posted: {listing.received_at ? new Date(listing.received_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
                    </div>
                  </div>

                  {/* View button */}
                  <div className="flex-shrink-0 self-center">
                    <Link
                      to={`/flash-sales/${listing.id}`}
                      className="px-4 py-2 text-xs font-medium text-[#3B5BFE] border border-[#3B5BFE] rounded hover:bg-[#3B5BFE] hover:text-white transition-colors"
                    >
                      View Listing
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
