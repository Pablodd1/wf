/**
 * Trading Floor — watchfacts.com/buy/all replica
 * Main dealer experience: search, filters, watch cards with real data
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Filter, ChevronDown, Globe, Calendar, ArrowUpDown, Tag, Watch } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';

interface WatchListing {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_usd: number;
  currency: string | null;
  price_raw: string | null;
  raw_message: string;
  verdict: string;
  confidence: number;
  source: string;
  created_at: string;
  year: number | null;
}

// Supabase config — using service role for read access to watch_records
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

const CONDITIONS = ['All', 'New', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'Used', 'Pre-owned'];
const REGIONS = ['All', 'North America', 'Europe', 'Asia', 'Middle East'];
const SORT_OPTIONS = [
  { label: 'Newest to Oldest', value: 'newest' },
  { label: 'Oldest to Newest', value: 'oldest' },
  { label: 'Price: Low to High', value: 'price_asc' },
  { label: 'Price: High to Low', value: 'price_desc' },
];

function WatchCard({ listing, index }: { listing: WatchListing; index: number }) {
  const navigate = useNavigate();

  // Parse raw message for description
  const description = listing.raw_message
    ?.replace(/[📢🎅✨🍂🇭🇰\n]/g, ' ')
    ?.replace(/\s+/g, ' ')
    ?.trim()
    ?.slice(0, 120) || '';

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatPrice = (price: number) => {
    if (price >= 1000000) return `$${(price / 1000000).toFixed(1)}M`;
    if (price >= 1000) return `$${(price / 1000).toFixed(price >= 10000 ? 0 : 1)}k`;
    return `$${price}`;
  };

  // Get brand silhouette placeholder
  const brandSlug = (listing.brand || 'unknown').toLowerCase().replace(/\s+/g, '-');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.5) }}
      onClick={() => navigate(`/flash-sales/${listing.id}`)}
      className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer group"
    >
      {/* Image Placeholder */}
      <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-t-lg flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <div className="text-4xl mb-2 opacity-20">
            {brandSlug.includes('rolex') ? '⌚' : brandSlug.includes('patek') ? '◆' : brandSlug.includes('ap') ? '◈' : brandSlug.includes('rm') ? '◇' : '⌚'}
          </div>
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">{listing.brand}</span>
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Price */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-bold text-gray-900">
            {listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Price on request'}
          </span>
          {listing.price_usd > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">+ label</span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-[13px] font-medium text-gray-800 leading-tight mb-1 line-clamp-2">
          {listing.brand} {listing.reference}
          {listing.dial_color ? ` - ${listing.dial_color} Dial` : ''}
        </h3>

        {/* Description */}
        {description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 mb-2">{description}</p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
          <span className="bg-gray-50 px-1.5 py-0.5 rounded">NO RATING</span>
          <span>{listing.condition || 'N/A'}</span>
        </div>

        {/* Price + Region */}
        <div className="text-[11px] text-gray-600 mb-1.5">
          {listing.price_usd > 0 ? `$${listing.price_usd.toLocaleString()}` : 'Contact'}{listing.currency ? ` ${listing.currency}` : ''} {' '}
          <span className="text-gray-400">North America</span>
        </div>

        {/* Dealer */}
        <div className="text-[11px] text-gray-500 mb-1">
          {listing.source || 'Unknown Dealer'}
        </div>

        {/* Posted date */}
        <div className="text-[10px] text-gray-400">
          Posted: {formatDate(listing.created_at)}
        </div>

        {/* CTA */}
        <button className="mt-2 w-full py-1.5 text-[11px] font-medium text-[#3B5BFE] border border-[#3B5BFE] rounded hover:bg-[#3B5BFE] hover:text-white transition-colors">
          Check availability
        </button>
      </div>
    </motion.div>
  );
}

function TradingFooter() {
  return (
    <footer className="bg-white border-t border-gray-200 pt-10 pb-6 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-sm mb-10">
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Features</h4>
          <ul className="space-y-2">
            <li><span className="text-gray-600">Trading Floor</span></li>
            <li><span className="text-gray-600">ChronoMatch</span></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Tools</h4>
          <ul className="space-y-2">
            <li><span className="text-gray-600">Glossary</span></li>
            <li><span className="text-gray-600">Currency Converter</span></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider mb-4">Dealers</h4>
          <ul className="space-y-2">
            <li><span className="text-gray-600">Dealer Directory</span></li>
            <li><span className="text-gray-600">Do Not Trade List</span></li>
          </ul>
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

export default function TradingFloor() {
  const [listings, setListings] = useState<WatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('All');
  const [region, setRegion] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 24;

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use Supabase REST API directly (works from browser)
      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));

      // Build filters
      const filters: string[] = [];
      if (query) {
        filters.push(`or=(reference.ilike.*${query}*,brand.ilike.*${query}*,raw_message.ilike.*${query}*)`);
      }
      if (condition !== 'All') {
        filters.push(`condition=eq.${encodeURIComponent(condition)}`);
      }

      // Sort
      let orderBy = 'created_at';
      let orderDir = 'desc';
      if (sortBy === 'oldest') orderDir = 'asc';
      if (sortBy === 'price_asc') { orderBy = 'price_usd'; orderDir = 'asc'; }
      if (sortBy === 'price_desc') { orderBy = 'price_usd'; orderDir = 'desc'; }

      const url = `${SUPABASE_URL}/rest/v1/watch_records?${params.toString()}${filters.length > 0 ? '&' + filters.join('&') : ''}&order=${orderBy}.${orderDir}`;

      const res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Get count via head request
      const countRes = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=count`, {
        method: 'HEAD',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'count=exact',
        },
      });
      const countRange = countRes.headers.get('content-range') || '';
      const totalCount = parseInt(countRange.split('/')[1] || '0') || data.length;

      setListings(data || []);
      setTotal(totalCount);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, condition, sortBy, page]);

  useEffect(() => {
    const timer = setTimeout(() => fetchListings(), 300);
    return () => clearTimeout(timer);
  }, [fetchListings]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-white">
      <DealerNavbar />

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-6 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-light mb-1">Welcome to the Trading Floor</h1>
          <p className="text-blue-100 text-sm">29,512+ Global Dealers. Search by reference to get the most accurate results</p>
        </div>
      </div>

      {/* Search + Filters Bar */}
      <div className="border-b border-gray-200 bg-white sticky top-[56px] z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          {/* Search */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                placeholder="Search by reference, brand, or keywords..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-2 border rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${showFilters ? 'border-[#3B5BFE] text-[#3B5BFE] bg-blue-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <Filter size={14} /> Filters
            </button>
          </div>

          {/* Filter Pills */}
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex flex-wrap gap-2 pb-3"
            >
              {/* Listing Type */}
              <div className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1">
                <Tag size={12} className="text-gray-400" />
                <select
                  value={condition}
                  onChange={(e) => { setCondition(e.target.value); setPage(1); }}
                  className="bg-transparent text-[12px] text-gray-700 focus:outline-none"
                >
                  {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Region */}
              <div className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1">
                <Globe size={12} className="text-gray-400" />
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="bg-transparent text-[12px] text-gray-700 focus:outline-none"
                >
                  {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Sort */}
              <div className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1">
                <ArrowUpDown size={12} className="text-gray-400" />
                <select
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                  className="bg-transparent text-[12px] text-gray-700 focus:outline-none"
                >
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {/* Date Range */}
              <div className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1">
                <Calendar size={12} className="text-gray-400" />
                <select className="bg-transparent text-[12px] text-gray-700 focus:outline-none">
                  <option>1M</option>
                  <option>3M</option>
                  <option>6M</option>
                  <option>1Y</option>
                  <option>All</option>
                </select>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Stats bar */}
        <div className="flex items-center justify-between mb-4 text-sm">
          <span className="text-gray-500">
            {loading ? 'Loading...' : (
              <>
                Showing <span className="font-semibold text-gray-900">{listings.length}</span> of{' '}
                <span className="font-semibold text-gray-900">{total.toLocaleString()}</span> listings
              </>
            )}
          </span>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-4">
            Error: {error}
          </div>
        )}

        {/* Watch Grid */}
        {listings.length === 0 && !loading ? (
          <div className="text-center py-20">
            <Watch size={48} className="mx-auto text-gray-200 mb-4" />
            <p className="text-gray-400 text-lg">No listings found</p>
            <p className="text-gray-400 text-sm mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {listings.map((listing, i) => (
              <WatchCard key={listing.id} listing={listing} index={i} />
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && listings.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-gray-50 rounded-lg border border-gray-100 animate-pulse">
                <div className="aspect-square bg-gray-200 rounded-t-lg" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 rounded w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8 mb-4">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 font-mono">
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <TradingFooter />
    </div>
  );
}
