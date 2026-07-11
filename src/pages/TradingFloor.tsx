/**
 * Trading Floor — Live watch marketplace with search, pagination, category tabs.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, Loader2, DollarSign, Watch, Database,
  Sparkles, AlertTriangle, ChevronLeft, ChevronRight,
  X, Zap, RefreshCw,
} from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';
import { LuxuryPriceCard } from '@/components/ui/LuxuryPriceCard';
import { LuxuryStatsBar } from '@/components/ui/LuxuryStatsBar';
import { computeDealRating, type DealRating, type PriceAverageData } from '@/lib/dealRating';

interface WatchListing {
  id: string; brand: string; reference: string;
  dial_color: string | null; condition: string | null;
  price_usd: number; currency: string | null;
  raw_message: string | null; verdict: string;
  confidence: number; source: string | null;
  created_at: string; year: number | null;
}

const PAGE_SIZES = [12, 20, 50];
const CONDITIONS = ['All', 'New', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9'];

const SOURCE_NAMES: Record<string, string> = {
  'mysql_auction_watches': 'Auction House',
  'production_db': 'Verified Dealer',
  'whatsapp': 'WhatsApp Dealer',
};

function extractDealerName(raw: string | null, source: string | null): string {
  if (!raw) return SOURCE_NAMES[source || ''] || source || 'Private Seller';
  const m = raw.match(/(?:USD|USDT|HKD|GBP|EUR)\s*[\d,.]+[KkMm]?\s*(?:[\u2705\u2714\u2713])?\s*[-\u2014]\s*([A-Z][a-zA-Z\s]{2,25})(?:\s*$|\s*\n)/);
  if (m) return m[1].trim();
  return SOURCE_NAMES[source || ''] || source || 'Verified Dealer';
}

function extractTitle(raw: string | null): { line1: string; line2: string } {
  if (!raw) return { line1: '', line2: '' };
  const cleaned = raw.replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  const mid = Math.min(Math.ceil(words.length / 2) + 2, 12);
  return { line1: words.slice(0, mid).join(' '), line2: words.slice(mid).join(' ') || '' };
}

function getDealRatingForListing(listing: WatchListing, averages: Record<string, PriceAverageData>) {
  const result = computeDealRating(listing.price_usd, averages[`${listing.brand}|${listing.reference}`]);
  return {
    hasRating: result.rating !== 'NO_RATING',
    score: result.rating === 'GOOD_DEAL' ? 90 : result.rating === 'FAIR_DEAL' ? 75 : 50,
    label: result.label,
    dealRating: result.rating,
  };
}

const formatPrice = (p: number) => p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` : p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;

export default function TradingFloor() {
  const [listings, setListings] = useState<WatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [condition, setCondition] = useState('All');
  const [category, setCategory] = useState<'all' | 'forsale' | 'multi' | 'wtb'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [priceAverages, setPriceAverages] = useState<Record<string, PriceAverageData>>({});
  const [selectedListing, setSelectedListing] = useState<WatchListing | null>(null);
  const [showConverter, setShowConverter] = useState(false);
  const searchTimeout = useRef<any>(null);
  const isFetching = useRef(false);

  // Fetch total
  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(d => {
      if (d.totalRecords) setTotal(d.totalRecords);
    }).catch(() => {});
  }, []);

  // Fetch price averages
  useEffect(() => {
    fetch('/api/price-averages').then(r => r.json()).then(d => {
      if (d.averages) setPriceAverages(d.averages);
    }).catch(() => {});
  }, []);

  const fetchListings = useCallback(async (p?: number) => {
    if (isFetching.current) return;
    isFetching.current = true;
    setLoading(true);
    setError('');

    try {
      const pg = p ?? page;
      let url = `/api/listings?limit=${pageSize}&page=${pg}&category=${category}&sort=created_at&order=desc`;
      if (query) url += `&search=${encodeURIComponent(query)}`;
      if (condition !== 'All') url += `&condition=${encodeURIComponent(condition)}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to load');

      setListings(data.rows || []);
      if (data.total > 0) setTotal(data.total);
      setTotalPages(data.totalPages || 0);
      setPage(pg);

      // Preload catalog images
      try {
        const res2 = await fetch('/watchfacts-catalog-images.json');
        if (res2.ok) setImageMap(await res2.json());
      } catch {}
    } catch (e: any) {
      setError(e.message);
      setListings([]);
    }
    setLoading(false);
    isFetching.current = false;
  }, [pageSize, category, query, condition]);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setQuery(searchInput);
      setPage(1);
    }, 400);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [searchInput]);

  // Fetch on dependency change
  useEffect(() => { fetchListings(1); }, [fetchListings]);

  // Category change
  const changeCategory = (c: typeof category) => {
    setCategory(c);
    setPage(1);
  };

  // Pagination
  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    fetchListings(p);
    window.scrollTo({ top: 400, behavior: 'smooth' });
  };

  // Page size
  const changePageSize = (s: number) => {
    setPageSize(s);
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <DealerNavbar />

      {/* Hero */}
      <div className="relative h-[30vh] overflow-hidden">
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
          <source src="/hero-watches.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0F]/60 to-[#0A0A0F]" />
        <div className="relative z-10 flex items-center justify-center h-full">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-full bg-white/5 border border-[#C9A96E]/20">
              <Sparkles size={14} className="text-[#C9A96E]" />
              <span className="text-xs text-[#C9A96E] font-semibold uppercase tracking-[0.15em]">Trading Floor</span>
            </div>
            <h1 className="text-4xl font-light text-white mb-2">
              {total.toLocaleString()} Watches Listed
            </h1>
            <p className="text-white/40 text-sm">29 brands • 600+ dealers • Live pricing</p>
          </div>
        </div>
      </div>

      <LuxuryStatsBar total={total} loaded={listings.length} hasMore={false} loadAllMode={false} onLoadAll={()=>{}} onBackToPaginated={()=>{}} />

      {/* Controls */}
      <div className="sticky top-[60px] z-40 bg-[#0A0A0F]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3">
          {/* Search + Condition */}
          <div className="flex gap-3 mb-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#C9A96E]/50" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search by brand or reference (e.g. Rolex 126610)..."
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A96E]/30"
              />
            </div>
            <select
              value={condition}
              onChange={e => { setCondition(e.target.value); setPage(1); }}
              className="bg-white/5 border border-white/10 rounded-lg text-sm text-white px-3 py-2.5"
            >
              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Category tabs + Page size */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1.5">
              {[
                { id: 'all' as const, label: 'ALL WATCHES', icon: Watch },
                { id: 'forsale' as const, label: 'FOR SALE', icon: DollarSign },
                { id: 'multi' as const, label: 'MULTI-LISTINGS', icon: Database },
                { id: 'wtb' as const, label: 'WTB', icon: Search },
              ].map(tab => {
                const Icon = tab.icon;
                const active = category === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => changeCategory(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.04em] transition-all ${
                      active
                        ? 'bg-[#C9A96E] text-black'
                        : 'bg-white/5 text-white/50 hover:text-white/80 border border-white/10'
                    }`}
                  >
                    <Icon size={11} /> {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Page size selector */}
            <div className="flex items-center gap-1.5 text-[11px] text-white/40">
              <span>Show:</span>
              {PAGE_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => changePageSize(s)}
                  className={`px-2 py-0.5 rounded ${pageSize === s ? 'bg-[#C9A96E]/20 text-[#C9A96E]' : 'hover:text-white'}`}
                >{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-[#C9A96E]" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="text-center py-20">
            <AlertTriangle size={40} className="mx-auto mb-4 text-red-400" />
            <p className="text-red-400 text-sm mb-4">{error}</p>
            <button onClick={() => fetchListings(page)} className="px-4 py-2 bg-[#C9A96E] text-black rounded-lg text-sm font-semibold">
              <RefreshCw size={14} className="inline mr-1" /> Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && listings.length === 0 && (
          <div className="text-center py-20">
            <Watch size={40} className="mx-auto mb-4 text-white/20" />
            <p className="text-white/40">
              {query ? 'No watches found for your search.' : 'No watches available in this category.'}
            </p>
            {query && (
              <button onClick={() => { setSearchInput(''); setQuery(''); }} className="mt-4 text-[#C9A96E] text-sm underline">
                Clear search
              </button>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && listings.length > 0 && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            >
              {listings.map((l, i) => (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <LuxuryPriceCard
                    listing={l}
                    imageUrl={imageMap[l.reference || ''] || resolveWatchImage(l.reference || '', l.brand || '')}
                    brandGradient={getBrandGradient(l.brand || '')}
                    dealerName={extractDealerName(l.raw_message, l.source)}
                    region={l.source?.toLowerCase().includes('asia') ? 'ASIA' : 'NORTH AMERICA'}
                    isNew={new Date(l.created_at).getTime() > Date.now() - 86400000}
                    rating={getDealRatingForListing(l, priceAverages)}
                    title={extractTitle(l.raw_message)}
                    onClick={() => setSelectedListing(l)}
                  />
                </motion.div>
              ))}
            </motion.div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8 pb-8">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="p-2 rounded-lg border border-white/10 text-white/60 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-white/60">
                  Page {page} of {totalPages} ({total.toLocaleString()} total)
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="p-2 rounded-lg border border-white/10 text-white/60 hover:text-white disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
