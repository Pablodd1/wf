/**
 * Trading Floor — watchfacts.com/buy/all replica
 * EXACT match to user screenshot: real images, NO RATING, source, region, CHECK AVAILABILITY
 * Optimized for speed: smaller page size, select only needed columns
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Filter, Info, User, CheckCircle, Globe, Loader2 } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';

// ─── Supabase direct ─────────────────────────────────────────────────
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

// ─── Types ───────────────────────────────────────────────────────────
interface WatchListing {
  id: string;
  brand: string;
  reference: string;
  dial_color: string | null;
  condition: string | null;
  price_usd: number;
  currency: string | null;
  raw_message: string | null;
  verdict: string;
  confidence: number;
  source: string | null;
  created_at: string;
  year: number | null;
}

const CONDITIONS = ['All', 'New', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9'];
const REGIONS = ['All', 'North America', 'Europe', 'Asia', 'Middle East'];

// ─── Extract clean title from raw_message ────────────────────────────
function extractTitle(raw: string | null): { line1: string; line2: string } {
  if (!raw) return { line1: '', line2: '' };
  const cleaned = raw
    .replace(/[📢🎅✨🍂🇭🇰🌹💋🎈🎁💞🍄🔵🔴🟢]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Split into 2 lines at natural break
  const words = cleaned.split(' ');
  const mid = Math.min(Math.ceil(words.length / 2) + 2, 12);
  return {
    line1: words.slice(0, mid).join(' '),
    line2: words.slice(mid).join(' ') || '',
  };
}

// ─── Compute rating from data quality ────────────────────────────────
function computeRating(listing: WatchListing): { hasRating: boolean; score: number; label: string } {
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

// ─── Watch Card ──────────────────────────────────────────────────────
function WatchCard({ listing }: { listing: WatchListing }) {
  const navigate = useNavigate();
  const imgUrl = resolveWatchImage(listing.reference || '', listing.brand || '');
  const title = extractTitle(listing.raw_message);
  const rating = computeRating(listing);
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatPrice = (p: number) => p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` : p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;
  // Region from source or default
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : 
                 listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const sourceName = listing.source || 'Unknown';

  return (
    <motion.div
      layout
      className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all cursor-pointer group"
      onClick={() => navigate(`/flash-sales/${listing.id}`)}
    >
      {/* Image */}
      <div className={`relative aspect-square bg-gradient-to-br ${getBrandGradient(listing.brand || '')} flex items-center justify-center overflow-hidden`}>
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={`${listing.brand} ${listing.reference}`}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="text-center">
            <div className="text-5xl opacity-20">⌚</div>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-2 block">{listing.brand}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Title */}
        <p className="text-sm font-medium text-gray-900 line-clamp-1">{title.line1}</p>
        {title.line2 && <p className="text-sm text-gray-600 line-clamp-1">{title.line2}</p>}

        {/* Rating */}
        <div className="flex items-center gap-1.5 mt-2">
          {rating.hasRating ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle size={14} className="text-green-500" />
              <span className="font-semibold">{rating.label}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Info size={14} />
              <span className="font-medium uppercase tracking-wider">{rating.label}</span>
            </span>
          )}
        </div>

        {/* Price + Region */}
        <div className="flex items-center justify-between mt-2">
          <span className="text-sm font-semibold text-gray-900">{listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact'}</span>
          <span className="flex items-center gap-1 text-[11px] text-gray-500 uppercase">
            <Globe size={12} /> {region}
          </span>
        </div>

        {/* Source + Reviews */}
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
          <User size={12} />
          <span className="truncate">{sourceName}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
          <CheckCircle size={12} className="text-blue-500" />
          <span>(0)</span>
        </div>

        {/* Posted */}
        <p className="text-[11px] text-gray-400 mt-1.5">Posted: {formatDate(listing.created_at)}</p>

        {/* CTA */}
        <button className="mt-3 w-full py-2.5 border-2 border-[#3B5BFE] text-[#3B5BFE] text-[11px] font-semibold uppercase tracking-wider rounded-full hover:bg-[#3B5BFE] hover:text-white transition-all flex items-center justify-center gap-1.5">
          <Info size={12} /> Check Availability
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function TradingFloor() {
  const [listings, setListings] = useState<WatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('All');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(2392784);
  const pageSize = 12; // Smaller for faster initial load
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Optimized fetch: select only needed columns, smaller page
  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      // OPTIMIZED: select only columns we need (no raw_message for list view? No, we need it for titles)
      let url = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,currency,raw_message,verdict,confidence,source,created_at,year&limit=${pageSize}&offset=${offset}`;
      if (query) url += `&or=(reference.ilike.*${encodeURIComponent(query)}*,brand.ilike.*${encodeURIComponent(query)}*)`;
      if (condition !== 'All') url += `&condition=eq.${encodeURIComponent(condition)}`;

      const res = await fetch(url, { headers: REQ });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setListings(data || []);
      setTotal(2392784);
    } catch {
      // Keep existing listings on error
    }
    setLoading(false);
  }, [query, condition, page]);

  // Debounced fetch
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setPage(1); fetchListings(); }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query, condition, fetchListings]);

  // Page change fetch
  useEffect(() => {
    fetchListings();
  }, [page, fetchListings]);

  return (
    <div className="min-h-screen bg-white">
      <DealerNavbar />

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-5 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl md:text-2xl font-light">Welcome to the Trading Floor</h1>
          <p className="text-blue-100 text-sm">29,512+ Global Dealers. Search by reference to get the most accurate results</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="border-b border-gray-200 bg-white sticky top-[56px] z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by reference, brand, or keywords..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3B5BFE]"
            />
          </div>
          <select value={condition} onChange={e => { setCondition(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none">
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="text-sm text-gray-500 mb-4">
          Showing <span className="font-semibold text-gray-900">{listings.length}</span> of{' '}
          <span className="font-semibold text-gray-900">{total.toLocaleString()}</span> listings
          {loading && <span className="ml-2"><Loader2 size={14} className="inline animate-spin" /></span>}
        </div>

        {listings.length === 0 && !loading && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-3">⌚</div>
            <p>No listings found</p>
          </div>
        )}

        {/* Grid: 4 columns matching screenshot */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {listings.map((listing) => (
            <WatchCard key={listing.id} listing={listing} />
          ))}
        </div>

        {/* Loading skeleton */}
        {loading && listings.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-gray-50 rounded-xl border border-gray-100 animate-pulse">
                <div className="aspect-square bg-gray-200" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-center gap-3 mt-8">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30">Previous</button>
          <span className="text-sm text-gray-500 font-mono">Page {page}</span>
          <button onClick={() => setPage(page + 1)} disabled={listings.length < pageSize}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30">Next</button>
        </div>
      </div>
    </div>
  );
}
