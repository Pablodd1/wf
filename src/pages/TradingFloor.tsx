/**
 * Trading Floor -- watchfacts.com/buy/all replica
 * Enhanced UI: gold accents, better cards, stats bar, improved filters
 * INFINITE SCROLL: loads 100 at a time, auto-loads more on scroll
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Filter, Info, User, CheckCircle, Globe, Loader2, TrendingUp, Shield, Award, DollarSign, Watch, Gem, X, Zap } from 'lucide-react';
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

// ─── Known watch brands for category filtering ───────────────────────
const KNOWN_WATCH_BRANDS = [
  'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin',
  'Omega', 'Cartier', 'Breitling', 'IWC', 'Jaeger-LeCoultre', 'Panerai', 'Hublot',
  'TAG Heuer', 'Zenith', 'Blancpain', 'Breguet', 'Chopard', 'Girard-Perregaux',
  'A. Lange & Sohne', 'F.P. Journe', 'De Bethune', 'MB&F', 'Urwerk', 'Gronefeld',
  'Seiko', 'Grand Seiko', 'Citizen', 'Casio', 'G-Shock', 'Tudor', 'Nomos',
  'Longines', 'Rado', 'Hamilton', 'Oris', 'Sinn', 'Damasko', 'Fortis',
  'Bulgari', 'Hermes', 'Louis Vuitton', 'Chanel', 'Dior', 'Frank Muller',
  'Parmigiani', 'Piaget', 'Ulysse Nardin', 'Voutilainen', 'Laurent Ferrier',
  'Moser', 'Romain Gauthier', 'Greubel Forsey', 'Hautlence', 'HYT',
];

// ─── Source-to-display-name mapping ──────────────────────────────────
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'mysql_auction_watches': 'Auction House',
  'production_db': 'Verified Dealer',
  'whatsapp': 'WhatsApp Dealer',
};

// ─── Extract dealer name from raw message ────────────────────────────
function extractDealerName(raw: string | null, source: string | null): string {
  if (!raw) return SOURCE_DISPLAY_NAMES[source || ''] || source || 'Private Seller';

  // Pattern: name after price followed by dash or newline
  // e.g. "...USD 25,500 -- Gianluca Rizzo" or "...HKD 180K - John Smith"
  const nameAfterPrice = raw.match(
    /(?:USD|USDT|HKD|GBP|EUR)\s*[\d,.]+[KkMm]?\s*(?:[✅✔️✓])?\s*[-—]\s*([A-Z][a-zA-Z\s]{2,25})(?:\s*$|\s*\n)/
  );
  if (nameAfterPrice) return nameAfterPrice[1].trim();

  // Pattern: "contact [Name]" or "DM [Name]"
  const contactName = raw.match(
    /(?:contact|dm|message|from)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i
  );
  if (contactName) return contactName[1].trim();

  // Pattern: WhatsApp forward header containing a name after timestamp
  const forwardName = raw.match(
    /\[?\d{1,2}:\d{2}\s*(?:AM|PM)?\s*,?\s*\d{1,2}\/\d{1,2}\/\d{4}\]?\s*\+?[\d\s:]+\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/
  );
  if (forwardName) return forwardName[1].trim();

  // Pattern: name at very end of message after "--" or "-"
  const nameAtEnd = raw.match(/[-—]\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*$/m);
  if (nameAtEnd) return nameAtEnd[1].trim();

  return SOURCE_DISPLAY_NAMES[source || ''] || source || 'Verified Dealer';
}

// ─── Currency converter ──────────────────────────────────────────────
function CurrencyConverter({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [fromCurr, setFromCurr] = useState('USD');
  const [toCurr, setToCurr] = useState('EUR');
  const rates: Record<string, number> = { USD: 1, EUR: 0.85, GBP: 0.79, CHF: 0.88, JPY: 110, HKD: 7.8, SGD: 1.35, AUD: 1.5, CAD: 1.25 };
  const converted = amount ? ((parseFloat(amount) || 0) * (rates[toCurr] / rates[fromCurr])).toFixed(2) : '';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900">Currency Converter</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Amount</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3B5BFE]" placeholder="10000" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">From</label>
            <select value={fromCurr} onChange={e => setFromCurr(e.target.value)}
              className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm">
              {Object.keys(rates).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">To</label>
            <select value={toCurr} onChange={e => setToCurr(e.target.value)}
              className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm">
              {Object.keys(rates).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {converted && (
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-[#3B5BFE]">{toCurr} {converted}</div>
            <div className="text-[10px] text-gray-500">{fromCurr} {amount} at estimated rate</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Extract clean title from raw_message ────────────────────────────
function extractTitle(raw: string | null): { line1: string; line2: string } {
  if (!raw) return { line1: '', line2: '' };
  const cleaned = raw
    .replace(/[\ud83d\udce2\u2728\ud83c\udf42\ud83c\udded\ud83c\uddf0\ud83c\udf39\ud83d\udc8b\ud83c\udf88\ud83c\udf81\ud83d\udc9e\ud83c\udf44\ud83d\udd35\ud83d\udd34\ud83d\udfe2\ud83c\udf85]/g, ' ')
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
function WatchCard({ listing, imageUrl }: { listing: WatchListing; imageUrl?: string }) {
  const navigate = useNavigate();
  const fallbackImg = resolveWatchImage(listing.reference || '', listing.brand || '');
  const displayImg = imageUrl || fallbackImg;
  const title = extractTitle(listing.raw_message);
  const rating = computeRating(listing);
  const dealerName = extractDealerName(listing.raw_message, listing.source);
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' :
                 listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';

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
        {displayImg ? (
          <img
            src={displayImg}
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
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
        {listing.condition && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-semibold text-gray-700 shadow-sm">
            {listing.condition}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider">{listing.brand}</span>
          <span className="text-[11px] text-gray-400">{listing.reference}</span>
        </div>
        {/* Dealer name */}
        <div className="flex items-center gap-1.5 mt-1 mb-1">
          <User size={11} className="text-gray-400" />
          <span className="text-[11px] text-gray-500 font-medium">{dealerName}</span>
          <span className="text-[9px] text-[#3B5BFE]">✓</span>
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
          <span className="text-base font-bold text-gray-900">{listing.price_usd > 0 ? formatPrice(listing.price_usd) : 'Contact'}</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wider">
            <Globe size={11} /> {region}
          </span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Posted: {formatDate(listing.created_at)}</p>
        <button className="mt-3 w-full py-2.5 border-2 border-[#3B5BFE] text-[#3B5BFE] text-[11px] font-semibold uppercase tracking-wider rounded-full hover:bg-[#3B5BFE] hover:text-white transition-all flex items-center justify-center gap-1.5 group/btn">
          <Info size={11} className="group-hover/btn:rotate-12 transition-transform" /> Check Availability
        </button>
      </div>
    </motion.div>
  );
}

// ─── Stats Bar ───────────────────────────────────────────────────────
function StatsBar({ total, loaded, hasMore, loadAllMode, onLoadAll, onBackToPaginated }: { total: number; loaded: number; hasMore: boolean; loadAllMode: boolean; onLoadAll: () => void; onBackToPaginated: () => void }) {
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
        <div className="flex items-center gap-3">
          {loadAllMode ? (
            <>
              <div className="text-[11px] text-[#D4AF37] font-semibold whitespace-nowrap">
                {loaded.toLocaleString()} of {total.toLocaleString()} listings loaded
              </div>
              <button
                onClick={onBackToPaginated}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                Back to Paginated
              </button>
            </>
          ) : (
            <>
              <div className="text-[11px] text-gray-400 whitespace-nowrap">
                Showing <span className="font-semibold text-gray-700">{loaded}</span> loaded
              </div>
              {hasMore && (
                <button
                  onClick={onLoadAll}
                  className="px-4 py-2 bg-[#D4AF37] hover:bg-[#C4A030] text-black text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  <Zap size={14} /> Load All Listings
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Throttle helper ─────────────────────────────────────────────────
function throttle<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let lastTime = 0;
  return ((...args: unknown[]) => {
    const now = Date.now();
    if (now - lastTime >= wait) { lastTime = now; fn(...args); }
  }) as T;
}

// ─── Main Component ──────────────────────────────────────────────────
export default function TradingFloor() {
  const [listings, setListings] = useState<WatchListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('All');
  const [listingType, setListingType] = useState<'all' | 'forsale' | 'wtb' | 'watches' | 'other'>('forsale');
  const [showConverter, setShowConverter] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(2392784);
  const [pageSize, setPageSize] = useState(100);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [loadAllMode, setLoadAllMode] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFetchingRef = useRef(false);

  // ─── Fetch real-time total count from Supabase ───────────────────────
  useEffect(() => {
    fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=count&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' }
    })
    .then(r => {
      const range = r.headers.get('content-range') || '';
      const count = parseInt(range.split('/')[1] || '0');
      if (count > 0) setTotal(count);
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
      const offset = (currentPage - 1) * currentPageSize;
      let url = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,currency,raw_message,verdict,confidence,source,created_at,year&limit=${currentPageSize}&offset=${offset}`;

      if (query) url += `&or=(reference.ilike.*${encodeURIComponent(query)}*,brand.ilike.*${encodeURIComponent(query)}*)`;
      if (condition !== 'All') url += `&condition=eq.${encodeURIComponent(condition)}`;
      if (listingType === 'forsale') url += `&price_usd=gt.0`;
      if (listingType === 'wtb') {
        const wtbTerms = ['wtb','want to buy','looking for','iso ','in search of','ntq','need to buy','buying'];
        url += `&or=(${wtbTerms.map(t => `raw_message.ilike.*${encodeURIComponent(t)}*`).join(',')})`;
      }

      const res = await fetch(url, { headers: REQ });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let processedData = data || [];

      if (listingType === 'forsale') {
        const wtbTerms = ['wtb','want to buy','looking for','iso ','in search of','ntq','need to buy','buying'];
        processedData = processedData.filter((l: WatchListing) => {
          if (!l.raw_message) return true;
          const lower = l.raw_message.toLowerCase();
          return !wtbTerms.some(t => lower.includes(t));
        });
      }

      // ─── Preload images BEFORE setting state ─────────────────────────
      const refs = processedData.map((l: WatchListing) => l.reference).filter(Boolean);
      const uniqueRefs = [...new Set(refs)].slice(0, 100);
      let newImageMap: Record<string, string> = {};

      if (uniqueRefs.length > 0) {
        try {
          const imgUrl = `${SUPABASE_URL}/rest/v1/reference_images?select=reference,image_url&reference=in.(${uniqueRefs.join(',')})&is_primary=eq.true&limit=100`;
          const imgRes = await fetch(imgUrl, { headers: REQ });
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            for (const row of imgData) {
              if (row.reference && row.image_url) newImageMap[row.reference] = row.image_url;
            }
          }
        } catch {
          // silent fail — images gracefully fall back to gradient
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
    <div className="min-h-screen bg-gray-50">
      <DealerNavbar />

      {/* Header */}
      <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white py-6 px-4 overflow-hidden">
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="max-w-7xl mx-auto relative">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 bg-[#D4AF37] rounded-full" />
            <h1 className="text-xl md:text-2xl font-light tracking-wide">Welcome to the Trading Floor</h1>
          </div>
          <p className="text-gray-400 text-sm ml-3">29,512+ Global Dealers. Search by reference to get the most accurate results</p>
        </div>
      </div>

      <StatsBar total={total} loaded={listings.length} hasMore={hasMore} loadAllMode={loadAllMode} onLoadAll={handleLoadAll} onBackToPaginated={resetToPaginated} />

      {/* Category Filter Pills + Search */}
      <div className="bg-white border-b border-gray-200 sticky top-[56px] z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search by reference, brand, or keywords..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] bg-gray-50/50" />
            </div>
            <div className="flex gap-2">
              <select value={condition} onChange={e => { setCondition(e.target.value); setPage(1); }}
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white">
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => { setQuery(''); setCondition('All'); setListingType('forsale'); setPage(1); }}
                className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 flex items-center gap-1.5">
                <Filter size={14} /> Reset
              </button>
            </div>
          </div>

          {loadAllMode && (
            <div className="mb-3 px-3 py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-lg flex items-center gap-2">
              <Zap size={14} className="text-[#D4AF37]" />
              <span className="text-xs font-semibold text-[#B8960C]">
                Load All Mode Active — {listings.length.toLocaleString()} of {total.toLocaleString()} listings loaded. Search and filters work client-side on loaded data.
              </span>
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-2">
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
                  <button key={item.id} onClick={() => { setListingType(isActive ? 'all' : item.id); setPage(1); }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all ${
                      isActive ? 'bg-[#3B5BFE] text-white shadow-md' : 'bg-white text-[#3B5BFE] border border-[#3B5BFE] hover:bg-blue-50'
                    }`}>
                    <Icon size={13} /> {item.label}
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <button onClick={() => setShowConverter(!showConverter)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all ${
                  showConverter ? 'bg-[#3B5BFE] text-white' : 'bg-[#3B5BFE] text-white hover:bg-[#2a4ad9] shadow-md'
                }`}>
                <DollarSign size={13} /> CONVERTER
              </button>
              {showConverter && <CurrencyConverter onClose={() => setShowConverter(false)} />}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 py-6">
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

        {listings.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {listings.map(listing => (
                <WatchCard
                  key={listing.id}
                  listing={listing}
                  imageUrl={imageMap[listing.reference || '']}
                />
              ))}
            </div>
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 mt-10 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin text-[#3B5BFE]" />
                <span>Loading more listings...</span>
              </div>
            )}
            {!hasMore && !loadingMore && (
              <div className="text-center mt-10 text-xs text-gray-400">
                {loadAllMode
                  ? `-- Showing first ${listings.length.toLocaleString()} listings of ${total.toLocaleString()} total --`
                  : `-- ${listings.length.toLocaleString()} listings loaded --`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
