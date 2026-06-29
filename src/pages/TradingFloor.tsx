/**
 * Trading Floor — watchfacts.com/buy/all replica
 * Enhanced UI: gold accents, better cards, stats bar, improved filters
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Filter, Info, User, CheckCircle, Globe, Loader2, TrendingUp, Shield, Award } from 'lucide-react';
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
    .replace(/[📢✨🍂🇭🇰🌹💋🎈🎁💞🍄🔵🔴🟢🎅]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

// ─── Format helpers ──────────────────────────────────────────────────
const formatPrice = (p: number) => p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` : p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;
const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─── Watch Card ──────────────────────────────────────────────────────
function WatchCard({ listing }: { listing: WatchListing }) {
  const navigate = useNavigate();
  const imgUrl = resolveWatchImage(listing.reference || '', listing.brand || '');
  const title = extractTitle(listing.raw_message);
  const rating = computeRating(listing);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : 
                 listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const sourceName = listing.source || 'Unknown';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-xl hover:border-gray-300 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group"
      onClick={() => navigate(`/flash-sales/${listing.id}`)}
    >
      {/* Image */}
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
        {/* Subtle overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
        {/* Condition badge */}
        {listing.condition && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-semibold text-gray-700 shadow-sm">
            {listing.condition}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Reference + Brand */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider">{listing.brand}</span>
          <span className="text-[11px] text-gray-400">{listing.reference}</span>
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-gray-900 line-clamp-1 leading-tight">{title.line1}</p>
        {title.line2 && <p className="text-sm text-gray-500 line-clamp-1 leading-tight">{title.line2}</p>}

        {/* Rating */}
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

        {/* Price + Region */}
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-base font-bold text-gray-900">{listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact'}</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wider">
            <Globe size={11} /> {region}
          </span>
        </div>

        {/* Source */}
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
          <User size={11} />
          <span className="truncate">{sourceName}</span>
        </div>

        {/* Posted date */}
        <p className="text-[10px] text-gray-400 mt-1">Posted: {formatDate(listing.created_at)}</p>

        {/* CTA */}
        <button className="mt-3 w-full py-2.5 border-2 border-[#3B5BFE] text-[#3B5BFE] text-[11px] font-semibold uppercase tracking-wider rounded-full hover:bg-[#3B5BFE] hover:text-white transition-all flex items-center justify-center gap-1.5 group/btn">
          <Info size={11} className="group-hover/btn:rotate-12 transition-transform" /> Check Availability
        </button>
      </div>
    </motion.div>
  );
}

// ─── Stats Bar ───────────────────────────────────────────────────────
function StatsBar({ total, loaded }: { total: number; loaded: number }) {
  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-6 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 whitespace-nowrap">
          <Shield size={13} className="text-[#D4AF37]" />
          <span className="font-semibold text-gray-900">{total.toLocaleString()}</span>
          <span className="text-gray-500">Total Listings</span>
        </div>
        <div className="w-px h-4 bg-gray-200" />
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 whitespace-nowrap">
          <Award size={13} className="text-[#D4AF37]" />
          <span className="font-semibold text-gray-900">29,512+</span>
          <span className="text-gray-500">Global Dealers</span>
        </div>
        <div className="w-px h-4 bg-gray-200" />
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 whitespace-nowrap">
          <TrendingUp size={13} className="text-green-500" />
          <span className="text-gray-500">Live Market Data</span>
        </div>
        <div className="flex-1" />
        <div className="text-[11px] text-gray-400 whitespace-nowrap">
          Showing <span className="font-semibold text-gray-700">{loaded}</span> per page
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function TradingFloor() {
  const [listings, setListings] = useState<WatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('All');
  const [region, setRegion] = useState('All');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(2392784);
  const pageSize = 12;
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
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

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setPage(1); fetchListings(); }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query, condition, fetchListings]);

  useEffect(() => {
    fetchListings();
  }, [page, fetchListings]);

  return (
    <div className="min-h-screen bg-gray-50">
      <DealerNavbar />

      {/* Header */}
      <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white py-6 px-4 overflow-hidden">
        {/* Subtle pattern */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="max-w-7xl mx-auto relative">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 bg-[#D4AF37] rounded-full" />
            <h1 className="text-xl md:text-2xl font-light tracking-wide">Welcome to the Trading Floor</h1>
          </div>
          <p className="text-gray-400 text-sm ml-3">29,512+ Global Dealers. Search by reference to get the most accurate results</p>
        </div>
      </div>

      {/* Stats Bar */}
      <StatsBar total={total} loaded={listings.length} />

      {/* Search & Filters */}
      <div className="bg-white border-b border-gray-200 sticky top-[56px] z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by reference, brand, or keywords..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent bg-gray-50/50 transition-all"
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={condition} 
              onChange={e => { setCondition(e.target.value); setPage(1); }} 
              className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] bg-white"
            >
              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select 
              value={region} 
              onChange={e => setRegion(e.target.value)} 
              className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] bg-white"
            >
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button 
              onClick={() => { setQuery(''); setCondition('All'); setRegion('All'); setPage(1); }}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center gap-1.5"
            >
              <Filter size={14} /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Loading skeleton */}
        {loading && listings.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
                <div className="aspect-square bg-gray-200" />
                <div className="p-4 space-y-3">
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-8 bg-gray-200 rounded w-full mt-2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {listings.length === 0 && !loading && (
          <div className="text-center py-24 text-gray-400 bg-white rounded-xl border border-gray-100">
            <div className="text-6xl mb-4 opacity-30">⌚</div>
            <p className="text-lg font-medium text-gray-500">No listings found</p>
            <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
          </div>
        )}

        {/* Grid */}
        {listings.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {listings.map((listing, idx) => (
                <WatchCard key={listing.id} listing={listing} />
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-4 mt-10">
              <button 
                onClick={() => setPage(Math.max(1, page - 1))} 
                disabled={page === 1}
                className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all bg-white"
              >
                Previous
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Page</span>
                <span className="text-sm font-bold text-gray-900 px-3 py-1 bg-white border border-gray-200 rounded-md">{page}</span>
              </div>
              <button 
                onClick={() => setPage(page + 1)} 
                disabled={listings.length < pageSize}
                className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all bg-white"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
