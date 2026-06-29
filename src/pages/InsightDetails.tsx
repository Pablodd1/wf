/**
 * Insight Details — Per-dial analytics for a specific reference
 * Shows: original stats, duplicate removal, outlier detection (IQR),
 * filtered stats, and individual listings in Trading Floor card format
 * Triggered by: clicking blue chart dot OR clicking dial color row in Price Research
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Database, MessageCircle, Info, CheckCircle, Globe, User, ExternalLink } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';

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
  created_at: string;
  year: number | null;
  verdict: string;
  confidence: number;
}

function fmtPrice(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPriceShort(n: number): string {
  if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${n.toLocaleString()}`;
  return `$${n}`;
}

// ─── IQR Outlier Detection ───────────────────────────────────────────
function detectOutliers(prices: number[]): { filtered: number[]; removed: number[]; lowerFence: number; upperFence: number; q1: number; q3: number } {
  if (prices.length < 4) return { filtered: prices, removed: [], lowerFence: 0, upperFence: Infinity, q1: prices[0] || 0, q3: prices[prices.length - 1] || 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const filtered = prices.filter(p => p >= lowerFence && p <= upperFence);
  const removed = prices.filter(p => p < lowerFence || p > upperFence);
  return { filtered, removed, lowerFence, upperFence, q1, q3 };
}

// ─── Duplicate Detection ─────────────────────────────────────────────
function detectDuplicates(listings: Listing[]): { unique: Listing[]; duplicates: Listing[]; dupPrices: number[] } {
  const seen = new Map<string, Listing>();
  const duplicates: Listing[] = [];
  for (const l of listings) {
    const key = `${l.price_usd}_${(l.raw_message || '').slice(0, 20).toLowerCase().trim()}`;
    if (seen.has(key)) {
      duplicates.push(l);
    } else {
      seen.set(key, l);
    }
  }
  return { unique: Array.from(seen.values()), duplicates, dupPrices: duplicates.map(d => d.price_usd) };
}

// ─── Extract title ───────────────────────────────────────────────────
function extractTitle(raw: string | null): { line1: string; line2: string } {
  if (!raw) return { line1: '', line2: '' };
  const cleaned = raw.replace(/[📢✨🍂🇭🇰🌹💋🎈🎁💞🍄🔵🔴🟢🎅]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  const mid = Math.min(Math.ceil(words.length / 2) + 2, 12);
  return { line1: words.slice(0, mid).join(' '), line2: words.slice(mid).join(' ') || '' };
}

// ─── Compute rating ──────────────────────────────────────────────────
function computeRating(listing: Listing): { hasRating: boolean; score: number; label: string } {
  let score = 0;
  if (listing.brand) score += 20;
  if (listing.reference) score += 20;
  if (listing.price_usd > 0) score += 20;
  if (listing.condition) score += 15;
  if (listing.dial_color) score += 10;
  if (listing.year) score += 10;
  if (listing.raw_message && listing.raw_message.length > 20) score += 5;
  if (score >= 80) return { hasRating: true, score, label: `${Math.round(score / 10)}/10` };
  return { hasRating: false, score, label: 'NO RATING' };
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

// ─── Individual Listing Card (Trading Floor style) ───────────────────
function ListingCard({ listing, index }: { listing: Listing; index: number }) {
  const navigate = useNavigate();
  const imgUrl = resolveWatchImage(listing.reference || '', listing.brand || '');
  const title = extractTitle(listing.raw_message);
  const rating = computeRating(listing);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : 
                 listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.5) }}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all cursor-pointer group"
      onClick={() => navigate(`/flash-sales/${listing.id}`)}
    >
      <div className={`relative aspect-square bg-gradient-to-br ${getBrandGradient(listing.brand || '')} flex items-center justify-center overflow-hidden`}>
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={`${listing.brand} ${listing.reference}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="text-center">
            <div className="text-5xl opacity-20">⌚</div>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-2 block">{listing.brand}</span>
          </div>
        )}
        {listing.condition && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-semibold text-gray-700 shadow-sm">
            {listing.condition}
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider">{listing.brand}</span>
          <span className="text-[11px] text-gray-400">{listing.reference}</span>
        </div>
        <p className="text-sm font-medium text-gray-900 line-clamp-1 leading-tight">{title.line1}</p>
        {title.line2 && <p className="text-sm text-gray-500 line-clamp-1 leading-tight">{title.line2}</p>}

        <div className="flex items-center gap-1.5 mt-2">
          {rating.hasRating ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle size={13} className="text-green-500" />
              <span className="font-semibold">{rating.label}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Info size={13} />
              <span className="font-medium uppercase tracking-wider">{rating.label}</span>
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-2.5">
          <span className="text-base font-bold text-gray-900">{fmtPriceShort(listing.price_usd)}</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wider">
            <Globe size={11} /> {region}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
          <User size={11} />
          <span className="truncate">{listing.source || 'Unknown'}</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Posted: {formatDate(listing.received_at || listing.created_at)}</p>

        <button className="mt-3 w-full py-2 border-2 border-[#3B5BFE] text-[#3B5BFE] text-[11px] font-semibold uppercase tracking-wider rounded-full hover:bg-[#3B5BFE] hover:text-white transition-all flex items-center justify-center gap-1.5">
          <ExternalLink size={11} /> View Listing
        </button>
      </div>
    </motion.div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────
export default function InsightDetails() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || '';
  const dial = searchParams.get('dial') || 'Any';
  const month = searchParams.get('month') || '';
  const brand = searchParams.get('brand') || '';

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  const watchImage = resolveWatchImage(ref, brand);

  // Fetch listings
  useEffect(() => {
    if (!ref) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        let url = `${SUPABASE_URL}/rest/v1/watch_records?select=*&reference=eq.${encodeURIComponent(ref)}&limit=1000`;
        if (dial && dial !== 'Any') {
          url += `&dial_color=eq.${encodeURIComponent(dial)}`;
        }
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

  // Stats
  const stats = useMemo(() => {
    const allPrices = listings.map(l => l.price_usd).filter(p => p > 0);
    if (allPrices.length === 0) return null;

    const origMin = Math.min(...allPrices);
    const origMax = Math.max(...allPrices);
    const origAvg = Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length);

    const { unique, duplicates, dupPrices } = detectDuplicates(listings);
    const uniquePrices = unique.map(l => l.price_usd).filter(p => p > 0);

    const { filtered: outlierFiltered, removed: outliers, lowerFence, upperFence, q1, q3 } = detectOutliers(uniquePrices);

    const filMin = outlierFiltered.length ? Math.min(...outlierFiltered) : 0;
    const filMax = outlierFiltered.length ? Math.max(...outlierFiltered) : 0;
    const filAvg = outlierFiltered.length ? Math.round(outlierFiltered.reduce((a, b) => a + b, 0) / outlierFiltered.length) : 0;

    return {
      origCount: allPrices.length,
      origMin, origMax, origAvg,
      dupCount: duplicates.length,
      dupPrices,
      filCount: outlierFiltered.length,
      filMin, filMax, filAvg,
      outlierCount: outliers.length,
      outlierPrices: outliers.sort((a, b) => a - b),
      lowerFence, upperFence,
      q1, q3,
      uniqueListings: unique,
    };
  }, [listings]);

  // Date range
  const dateRangeStr = useMemo(() => {
    if (listings.length === 0) return '';
    const dates = listings.map(l => l.received_at ? new Date(l.received_at) : null).filter(Boolean) as Date[];
    if (dates.length === 0) return '';
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(min)} to ${fmt(max)}`;
  }, [listings]);

  // Month display
  const monthDisplay = useMemo(() => {
    if (!month) return 'All Time';
    const [y, m] = month.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(m) - 1]} ${y}`;
  }, [month]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <DealerNavbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-[#3B5BFE] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Loading insights...</p>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <DealerNavbar />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {/* Back + Breadcrumb */}
        <div className="flex items-center gap-2 mb-4">
          <Link to="/price-research" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200">
            <ArrowLeft size={16} /> Price Research
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-700 font-medium">Insight Details</span>
        </div>

        {/* Watch Info Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            {watchImage ? (
              <img src={watchImage} alt={ref} className="w-32 h-32 object-contain rounded-lg bg-gray-50" />
            ) : (
              <div className="w-32 h-32 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                <span className="text-5xl opacity-20">⌚</span>
              </div>
            )}

            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-semibold text-gray-900">{brand || listings[0]?.brand || 'Watch'} {ref}</h1>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-2 text-sm text-gray-600">
                <span className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 rounded-full">
                  <span className="w-2.5 h-2.5 rounded-full border" style={{ backgroundColor: dial.toLowerCase() === 'white' ? '#f5f5f5' : dial.toLowerCase() === 'black' ? '#222' : dial.toLowerCase() === 'blue' ? '#3B5BFE' : dial.toLowerCase() === 'green' ? '#10b981' : '#ddd' }} />
                  {dial} Dial
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-full text-gray-500">Condition: Any</span>
                <span className="px-3 py-1 bg-gray-100 rounded-full text-gray-500">{monthDisplay}</span>
              </div>
              {dateRangeStr && (
                <p className="text-sm text-gray-500 mt-2">Listings from <span className="font-semibold text-gray-700">{dateRangeStr}</span></p>
              )}
            </div>

            <div className="text-center sm:text-right">
              <div className="text-3xl font-bold text-[#3B5BFE]">{stats ? fmtPriceShort(stats.origAvg) : '--'}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Market Average</div>
            </div>
          </div>
        </div>

        {!stats ? (
          <div className="text-center py-20 text-gray-400 bg-white rounded-xl border border-gray-100">
            <Info size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg font-medium text-gray-500">No data found for this reference</p>
          </div>
        ) : (
          <>
            {/* 4 Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

              {/* Stats (Original) — Blue */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-[#3B5BFE] text-white px-4 py-3 text-sm font-semibold flex items-center gap-2">
                  <Database size={14} /> Stats (Original)
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Data Points</span>
                    <span className="font-bold text-gray-900 text-lg">{stats.origCount}</span>
                  </div>
                  <div className="h-px bg-gray-100" />
                  <div className="flex justify-between"><span className="text-gray-500">Min:</span><span className="font-mono font-semibold">{fmtPrice(stats.origMin)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Avg:</span><span className="font-mono font-semibold text-[#3B5BFE]">{fmtPrice(stats.origAvg)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Max:</span><span className="font-mono font-semibold">{fmtPrice(stats.origMax)}</span></div>
                </div>
              </div>

              {/* Duplicated — Gray */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-gray-500 text-white px-4 py-3 text-sm font-semibold flex items-center gap-2">
                  <MessageCircle size={14} /> Duplicated
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-gray-700">{stats.dupCount}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Removed</div>
                  </div>
                  {stats.dupPrices.length > 0 && (
                    <>
                      <div className="h-px bg-gray-100" />
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Removed Prices</div>
                        <div className="flex flex-wrap gap-1">
                          {stats.dupPrices.slice(0, 8).map((p, i) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 rounded text-[11px] font-mono text-gray-600">{fmtPriceShort(p)}</span>
                          ))}
                          {stats.dupPrices.length > 8 && (
                            <span className="px-2 py-0.5 bg-gray-50 rounded text-[11px] text-gray-400">+{stats.dupPrices.length - 8} more</span>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Stats (Filtered) — Green */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-green-600 text-white px-4 py-3 text-sm font-semibold flex items-center gap-2">
                  <CheckCircle size={14} /> Stats (Filtered)
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Data Points</span>
                    <span className="font-bold text-gray-900 text-lg">{stats.filCount}</span>
                  </div>
                  <div className="h-px bg-gray-100" />
                  <div className="flex justify-between"><span className="text-gray-500">Min:</span><span className="font-mono font-semibold">{fmtPrice(stats.filMin)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Avg:</span><span className="font-mono font-semibold text-green-600">{fmtPrice(stats.filAvg)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Max:</span><span className="font-mono font-semibold">{fmtPrice(stats.filMax)}</span></div>
                  <div className="text-[10px] text-gray-400 pt-1">IQR Method (Q1={fmtPriceShort(stats.q1)}, Q3={fmtPriceShort(stats.q3)})</div>
                </div>
              </div>

              {/* Outliers — Red */}
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="bg-red-500 text-white px-4 py-3 text-sm font-semibold flex items-center gap-2">
                  <Info size={14} /> Outliers
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-gray-700">{stats.outlierCount}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Removed</div>
                  </div>
                  {stats.outlierCount > 0 ? (
                    <>
                      <div className="h-px bg-gray-100" />
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Removed Prices</div>
                        <div className="flex flex-wrap gap-1">
                          {stats.outlierPrices.map((p, i) => (
                            <span key={i} className="px-2 py-0.5 bg-red-50 rounded text-[11px] font-mono text-red-600">{fmtPrice(p)}</span>
                          ))}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-2">
                          Outside {fmtPrice(stats.lowerFence)} - {fmtPrice(stats.upperFence)}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-gray-400 text-xs text-center">No outliers detected</div>
                  )}
                </div>
              </div>
            </div>

            {/* Data Flow Explanation */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Data Processing Flow</h3>
              <div className="flex flex-col sm:flex-row items-center gap-2 text-sm">
                <div className="px-4 py-2 bg-blue-50 rounded-lg text-center">
                  <div className="font-bold text-[#3B5BFE]">{stats.origCount}</div>
                  <div className="text-[10px] text-gray-600">Original</div>
                </div>
                <ArrowLeft size={16} className="text-gray-300 rotate-180 sm:rotate-0" />
                <div className="px-4 py-2 bg-gray-50 rounded-lg text-center">
                  <div className="font-bold text-gray-700">−{stats.dupCount}</div>
                  <div className="text-[10px] text-gray-600">Duplicates</div>
                </div>
                <ArrowLeft size={16} className="text-gray-300 rotate-180 sm:rotate-0" />
                <div className="px-4 py-2 bg-gray-50 rounded-lg text-center">
                  <div className="font-bold text-gray-700">={stats.origCount - stats.dupCount}</div>
                  <div className="text-[10px] text-gray-600">Unique</div>
                </div>
                <ArrowLeft size={16} className="text-gray-300 rotate-180 sm:rotate-0" />
                <div className="px-4 py-2 bg-red-50 rounded-lg text-center">
                  <div className="font-bold text-red-500">−{stats.outlierCount}</div>
                  <div className="text-[10px] text-gray-600">Outliers</div>
                </div>
                <ArrowLeft size={16} className="text-gray-300 rotate-180 sm:rotate-0" />
                <div className="px-4 py-2 bg-green-50 rounded-lg text-center">
                  <div className="font-bold text-green-600">={stats.filCount}</div>
                  <div className="text-[10px] text-gray-600">Final</div>
                </div>
              </div>
            </div>

            {/* Individual Listings — Trading Floor Card Grid */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Individual Listings</h2>
                <span className="text-sm text-gray-500">{stats.uniqueListings.length} unique listing{stats.uniqueListings.length !== 1 ? 's' : ''}</span>
              </div>
              
              {stats.uniqueListings.length === 0 ? (
                <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-100">
                  <Info size={36} className="mx-auto mb-2 text-gray-300" />
                  <p>No unique listings found after filtering</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  {stats.uniqueListings.map((listing, idx) => (
                    <ListingCard key={listing.id} listing={listing} index={idx} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
