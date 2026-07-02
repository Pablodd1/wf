/**
 * Trading Floor — Luxury Glassmorphism Design
 * Enhanced UI: glassmorphism cards, gold accents, refined stats bar, polished filters
 * INFINITE SCROLL: loads 100 at a time, auto-loads more on scroll
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, Info, Loader2,
  TrendingUp, DollarSign, Watch, Gem, X, Zap,
  Sparkles
} from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';
import { LuxuryPriceCard } from '@/components/ui/LuxuryPriceCard';
import { LuxuryStatsBar } from '@/components/ui/LuxuryStatsBar';
import { LuxurySkeletonCard } from '@/components/ui/LuxurySkeletonCard';

// ─── Types ──────────────────────────────────────────────────────────────────
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

// ─── Source-to-display-name mapping ────────────────────────────────────────────
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'mysql_auction_watches': 'Auction House',
  'production_db': 'Verified Dealer',
  'whatsapp': 'WhatsApp Dealer',
};

// ─── Extract dealer name from raw message ──────────────────────────────────────────
function extractDealerName(raw: string | null, source: string | null): string {
  if (!raw) return SOURCE_DISPLAY_NAMES[source || ''] || source || 'Private Seller';

  const nameAfterPrice = raw.match(
    /(?:USD|USDT|HKD|GBP|EUR)\s*[\d,.]+[KkMm]?\s*(?:[\u2705\u2714\u2713])?\s*[-\u2014]\s*([A-Z][a-zA-Z\s]{2,25})(?:\s*$|\s*\n)/
  );
  if (nameAfterPrice) return nameAfterPrice[1].trim();

  const contactName = raw.match(
    /(?:contact|dm|message|from)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i
  );
  if (contactName) return contactName[1].trim();

  const forwardName = raw.match(
    /\[?\d{1,2}:\d{2}\s*(?:AM|PM)?\s*,?\s*\d{1,2}\/\d{1,2}\/\d{4}\]?\s*\+?[\d\s:]+\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/
  );
  if (forwardName) return forwardName[1].trim();

  const nameAtEnd = raw.match(/[-\u2014]\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*$/m);
  if (nameAtEnd) return nameAtEnd[1].trim();

  return SOURCE_DISPLAY_NAMES[source || ''] || source || 'Verified Dealer';
}

// ─── Currency converter ─────────────────────────────────────────────────────────
function CurrencyConverter({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [fromCurr, setFromCurr] = useState('USD');
  const [toCurr, setToCurr] = useState('EUR');
  const rates: Record<string, number> = { USD: 1, EUR: 0.85, GBP: 0.79, CHF: 0.88, JPY: 110, HKD: 7.8, SGD: 1.35, AUD: 1.5, CAD: 1.25 };
  const converted = amount ? ((parseFloat(amount) || 0) * (rates[toCurr] / rates[fromCurr])).toFixed(2) : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      className="absolute right-0 top-full mt-3 w-80 glass-modal p-5 z-50"
    >
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Sparkles size={14} className="text-[#D4AF37]" />
          Currency Converter
        </h4>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] text-[#D4AF37] uppercase tracking-[0.12em] font-semibold mb-1.5 block">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="glass-input w-full"
            placeholder="10000"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[#D4AF37] uppercase tracking-[0.12em] font-semibold mb-1.5 block">From</label>
            <select value={fromCurr} onChange={e => setFromCurr(e.target.value)} className="luxury-select w-full">
              {Object.keys(rates).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#D4AF37] uppercase tracking-[0.12em] font-semibold mb-1.5 block">To</label>
            <select value={toCurr} onChange={e => setToCurr(e.target.value)} className="luxury-select w-full">
              {Object.keys(rates).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {converted && (
          <div className="glass-card p-4 text-center border-[#D4AF37]/20">
            <div className="text-xl font-bold text-[#D4AF37] price-mono">{toCurr} {converted}</div>
            <div className="text-[11px] text-white/40 mt-1">{fromCurr} {amount} at estimated rate</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Extract clean title from raw_message ──────────────────────────────────────────
function extractTitle(raw: string | null): { line1: string; line2: string } {
  if (!raw) return { line1: '', line2: '' };
  const cleaned = raw
    .replace(/[\u{1F4E2}\u{2728}\u{1F342}\u{1F1ED}\u{1F1F0}\u{1F339}\u{1F48B}\u{1F388}\u{1F381}\u{1F49E}\u{1F344}\u{1F535}\u{1F534}\u{1F7E2}\u{1F385}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ');
  const mid = Math.min(Math.ceil(words.length / 2) + 2, 12);
  return {
    line1: words.slice(0, mid).join(' '),
    line2: words.slice(mid).join(' ') || '',
  };
}

// ─── Compute rating from data quality ────────────────────────────────────────────
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

// ─── Check if listing is new (within 24h) ──────────────────────────────────────────
function isNewListing(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  return diffHours <= 24;
}

// ─── Format helpers ────────────────────────────────────────────────────────────────
const formatPrice = (p: number) => p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` : p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;
const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─── Staggered container & item variants ──────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] } }
};

// ─── Watch Card ──────────────────────────────────────────────────────────────────
function WatchCard({ listing, imageUrl }: { listing: WatchListing; imageUrl?: string }) {
  const navigate = useNavigate();
  const fallbackImg = resolveWatchImage(listing.reference || '', listing.brand || '');
  const displayImg = imageUrl || fallbackImg;
  const title = extractTitle(listing.raw_message);
  const rating = computeRating(listing);
  const dealerName = extractDealerName(listing.raw_message, listing.source);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' :
                 listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';
  const isNew = isNewListing(listing.created_at);

  return (
    <LuxuryPriceCard
      listing={listing}
      imageUrl={displayImg}
      brandGradient={getBrandGradient(listing.brand || '')}
      dealerName={dealerName}
      region={region}
      isNew={isNew}
      rating={rating}
      title={title}
      onClick={() => navigate(`/flash-sales/${listing.id}`)}
    />
  );
}

// ─── Shimmer Skeleton Card ──────────────────────────────────────────────────────
function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="glass-card overflow-hidden"
    >
      <div className="aspect-square shimmer-dark" />
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <div className="h-3 shimmer-dark rounded w-1/4" />
          <div className="h-3 shimmer-dark rounded w-1/5" />
        </div>
        <div className="h-4 shimmer-dark rounded w-3/4" />
        <div className="h-3 shimmer-dark rounded w-1/2" />
        <div className="flex items-center gap-1.5">
          <div className="h-3 shimmer-dark rounded w-4 rounded-full" />
          <div className="h-3 shimmer-dark rounded w-1/3" />
        </div>
        <div className="flex items-center justify-between">
          <div className="h-5 shimmer-dark rounded w-1/3" />
          <div className="h-3 shimmer-dark rounded w-1/4" />
        </div>
        <div className="h-8 shimmer-dark rounded w-full mt-2 rounded-full" />
      </div>
    </motion.div>
  );
}


// ─── Throttle helper ──────────────────────────────────────────────────────────────────
function throttle<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let lastTime = 0;
  return ((...args: unknown[]) => {
    const now = Date.now();
    if (now - lastTime >= wait) { lastTime = now; fn(...args); }
  }) as T;
}

// ─── Main Component ──────────────────────────────────────────────────────────────────
export default function TradingFloor() {
  const [listings, setListings] = useState<WatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('All');
  const [listingType, setListingType] = useState<'all' | 'forsale' | 'wtb' | 'watches' | 'other'>('forsale');
  const [showConverter, setShowConverter] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(2392784);
  const [pageSize, setPageSize] = useState(200);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [loadAllMode, setLoadAllMode] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFetchingRef = useRef(false);

  // Fetch real-time total count from API
  useEffect(() => {
    fetch(`/api/listings?verdict=APPROVED&limit=1`)
    .then(r => r.json())
    .then(data => {
      const rows = data.rows || [];
      // Estimate total from content-range or just use the total field
      const total = data.total || (Array.isArray(data) ? data.length : 0);
      if (total > 0) setTotal(total * 100); // rough estimate
    })
    .catch(() => {});
  }, []);

  const fetchListings = useCallback(async (append = false, customPageSize?: number) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (append) setLoadingMore(true); else setLoading(true);

    try {
      const currentPageSize = customPageSize || pageSize;
      const currentPage = append ? page : 1;
      // Use the API endpoint instead of direct Supabase
      let url = `/api/listings?verdict=APPROVED&limit=${currentPageSize}&page=${currentPage}`;

      if (query) url += `&search=${encodeURIComponent(query)}`;
      if (condition !== 'All') url += `&condition=${encodeURIComponent(condition)}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = data.rows || data || [];
      let processedData = rows;

      if (listingType === 'forsale') {
        const wtbTerms = ['wtb','want to buy','looking for','iso ','in search of','ntq','need to buy','buying'];
        processedData = processedData.filter((l: WatchListing) => {
          if (!l.raw_message) return true;
          const lower = l.raw_message.toLowerCase();
          return !wtbTerms.some(t => lower.includes(t));
        });
      }

      // Preload images using catalog (instant, no network)
      const refs: string[] = processedData.map((l: WatchListing) => l.reference || '').filter(Boolean);
      const uniqueRefs: string[] = [...new Set(refs)].slice(0, 100);
      let newImageMap: Record<string, string> = {};
      
      if (uniqueRefs.length > 0) {
        // Use catalog image map directly
        try {
          const res = await fetch('/watchfacts-catalog-images.json');
          if (res.ok) {
            const catalogImages: Record<string, string> = await res.json();
            for (const ref of uniqueRefs) {
              const url = catalogImages[ref];
              if (url) newImageMap[ref] = url;
            }
          }
        } catch {
          // silent fail
        }
      }
      setImageMap(prev => ({ ...prev, ...newImageMap }));

      if (append) {
        setListings(prev => [...prev, ...processedData]);
        setHasMore(processedData.length === currentPageSize && !loadAllMode);
      } else {
        setListings(processedData);
        setHasMore(processedData.length === currentPageSize && !loadAllMode);
        setPage(1);
      }
    } catch {
      // Keep existing listings on error
    }
    isFetchingRef.current = false;
    setLoading(false);
    setLoadingMore(false);
  }, [query, condition, listingType, page, pageSize, loadAllMode]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { fetchListings(false); }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query, condition, listingType, fetchListings]);

  useEffect(() => {
    const handleScroll = throttle(() => {
      if (isFetchingRef.current || !hasMore || loading || loadAllMode) return;
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
        setPage(p => p + 1);
      }
    }, 200);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasMore, loading, loadAllMode]);

  useEffect(() => { if (page > 1) fetchListings(true); }, [page]); // eslint-disable-line

  const handleLoadAll = useCallback(() => {
    setLoadAllMode(true);
    setPageSize(10000);
    setPage(1);
    fetchListings(false, 10000);
  }, [fetchListings]);

  const resetToPaginated = useCallback(() => {
    setLoadAllMode(false);
    setPageSize(100);
    setPage(1);
    setHasMore(true);
    fetchListings(false, 100);
  }, [fetchListings]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] relative">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#0A0A0F] via-[#0D0D14] to-[#0A0A0F] pointer-events-none" />
      <div className="fixed inset-0 opacity-[0.015]" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #D4AF37 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />

      <DealerNavbar />

      {/* Header */}
      <div className="relative py-10 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/5 via-transparent to-[#D4AF37]/3" />
        <div className="max-w-7xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-3 mb-4 px-4 py-2 rounded-full glass-card border-[#D4AF37]/20">
              <Sparkles size={14} className="text-[#D4AF37]" />
              <span className="text-[11px] text-[#D4AF37] font-semibold uppercase tracking-[0.12em]">Premium Trading Floor</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-light tracking-wide text-white mb-3">
              Welcome to the <span className="text-gold-gradient font-medium">Trading Floor</span>
            </h1>
            <p className="text-white/40 text-sm max-w-xl mx-auto">
              29,512+ Global Dealers. Search by reference to get the most accurate results.
            </p>
          </motion.div>
        </div>
      </div>

      <LuxuryStatsBar
        total={total}
        loaded={listings.length}
        hasMore={hasMore}
        loadAllMode={loadAllMode}
        onLoadAll={handleLoadAll}
        onBackToPaginated={resetToPaginated}
      />

      {/* Category Filter Pills + Search */}
      <div className="sticky top-[60px] z-40 glass-nav border-b border-[#D4AF37]/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#D4AF37]/50" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by reference, brand, or keywords..."
                className="glass-input w-full pl-11 pr-4 py-3 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={condition}
                onChange={e => { setCondition(e.target.value); setPage(1); }}
                className="luxury-select text-sm py-3"
              >
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => { setQuery(''); setCondition('All'); setListingType('forsale'); setPage(1); }}
                className="px-4 py-3 border border-white/10 rounded-xl text-sm text-white/40 hover:bg-white/5 hover:text-white/70 flex items-center gap-1.5 transition-all"
              >
                <Filter size={14} /> Reset
              </motion.button>
            </div>
          </div>

          {loadAllMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-3 px-4 py-2.5 glass-card border-[#D4AF37]/20 flex items-center gap-2"
            >
              <Zap size={14} className="text-[#D4AF37]" />
              <span className="text-[11px] font-semibold text-[#D4AF37]/80">
                Load All Mode — {listings.length.toLocaleString()} of {total.toLocaleString()} listings loaded. Search and filters work client-side.
              </span>
            </motion.div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { id: 'forsale' as const, label: 'FOR SALE', icon: DollarSign },
                { id: 'wtb' as const, label: 'NTQ/WTB', icon: Search },
                { id: 'watches' as const, label: 'WATCHES', icon: Watch },
                { id: 'other' as const, label: 'OTHER', icon: Gem },
              ].map(item => {
                const Icon = item.icon;
                const isActive = listingType === item.id;
                return (
                  <motion.button
                    key={item.id}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => { setListingType(isActive ? 'all' : item.id); setPage(1); }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.06em] transition-all duration-300 ${
                      isActive
                        ? 'bg-gradient-to-r from-[#D4AF37] to-[#E5C158] text-[#0A0A0F] shadow-lg shadow-[#D4AF37]/20'
                        : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/70'
                    }`}
                  >
                    <Icon size={12} /> {item.label}
                  </motion.button>
                );
              })}
            </div>

            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setShowConverter(!showConverter)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.06em] transition-all ${
                  showConverter
                    ? 'bg-gradient-to-r from-[#D4AF37] to-[#E5C158] text-[#0A0A0F]'
                    : 'bg-white/5 text-[#D4AF37] border border-[#D4AF37]/30 hover:bg-[#D4AF37]/10'
                }`}
              >
                <DollarSign size={12} /> CONVERTER
              </motion.button>
              <AnimatePresence>
                {showConverter && (
                  <CurrencyConverter onClose={() => setShowConverter(false)} />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="relative max-w-7xl mx-auto px-4 py-8">
        {loading && listings.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        )}

        {listings.length === 0 && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-24 glass-card empty-state-pattern"
          >
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              className="text-6xl mb-4 opacity-20 inline-block"
            >
              &#x231A;
            </motion.div>
            <p className="text-lg font-medium text-white/50">No listings found</p>
            <p className="text-sm text-white/30 mt-1 mb-6">Try adjusting your search or filters</p>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => { setQuery(''); setCondition('All'); setListingType('forsale'); setPage(1); }}
              className="btn-luxury"
            >
              Clear All Filters
            </motion.button>
          </motion.div>
        )}

        {listings.length > 0 && (
          <>
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
            >
              {listings.map((listing) => (
                <WatchCard
                  key={listing.id}
                  listing={listing}
                  imageUrl={imageMap[listing.reference || '']}
                />
              ))}
            </motion.div>
            {loadingMore && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-center gap-2 mt-12 text-sm text-white/30"
              >
                <Loader2 size={16} className="animate-spin text-[#D4AF37]" />
                <span>Loading more listings...</span>
              </motion.div>
            )}
            {!hasMore && !loadingMore && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center mt-12 text-[11px] text-white/20"
              >
                <div className="gold-divider mb-4 max-w-xs mx-auto" />
                {loadAllMode
                  ? `Showing first ${listings.length.toLocaleString()} listings of ${total.toLocaleString()} total`
                  : `${listings.length.toLocaleString()} listings loaded`}
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
