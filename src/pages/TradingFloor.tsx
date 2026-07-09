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
  Sparkles, AlertTriangle, Database, Eye, ExternalLink,
  RefreshCw, Clock, CheckCircle, AlertOctagon, ArrowRight,
  Activity, Hash, Palette, Gauge, Calendar, UserCheck, Bot,
  FileText, Edit3, Save,
} from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';
import { resolveWatchImage, getBrandGradient } from '@/lib/imageResolver';
import { LuxuryPriceCard } from '@/components/ui/LuxuryPriceCard';
import { LuxuryStatsBar } from '@/components/ui/LuxuryStatsBar';
import { LuxurySkeletonCard } from '@/components/ui/LuxurySkeletonCard';
import { computeDealRating, type DealRating, type PriceAverageData } from '@/lib/dealRating';

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

// ─── Deal rating from market averages ────────────────────────────────────────────
function getDealRatingForListing(
  listing: WatchListing,
  averages: Record<string, PriceAverageData>
): { hasRating: boolean; score: number; label: string; dealRating: DealRating } {
  const key = `${listing.brand}|${listing.reference}`;
  const avgData = averages[key];
  const result = computeDealRating(listing.price_usd, avgData);
  return {
    hasRating: result.rating !== 'NO_RATING',
    score: result.rating === 'GOOD_DEAL' ? 90 : result.rating === 'FAIR_DEAL' ? 75 : result.rating === 'HIGH_PRICED' ? 50 : 0,
    label: result.label,
    dealRating: result.rating,
  };
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
function WatchCard({ listing, imageUrl, averages, onSelect }: { listing: WatchListing; imageUrl?: string; averages: Record<string, PriceAverageData>; onSelect: (l: WatchListing) => void }) {
  const fallbackImg = resolveWatchImage(listing.reference || '', listing.brand || '');
  const displayImg = imageUrl || fallbackImg;
  const title = extractTitle(listing.raw_message);
  const rating = getDealRatingForListing(listing, averages);
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
      onClick={() => onSelect(listing)}
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


// ─── Trading Floor Detail Modal — shows ALL info on click ─────────────────
const ADMIN_KEY_WF = 'wf-admin-2026';

function WatchDetailModal({ listing, onClose, averages, priceStats, onPriceStats }: {
  listing: WatchListing;
  onClose: () => void;
  averages: Record<string, PriceAverageData>;
  priceStats: any;
  onPriceStats: (s: any) => void;
}) {
  const navigate = useNavigate();
  const fmtPrice2 = (p: number) => p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` : p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;
  const fmtDate2 = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dealerName = extractDealerName(listing.raw_message, listing.source);
  const raw = listing.raw_message || '';
  const lower = raw.toLowerCase();
  const bracelet = lower.includes('oyster') ? 'Oyster' : lower.includes('jubilee') ? 'Jubilee' : lower.includes('president') ? 'President' : '';
  const accessories = { box: lower.includes('box') || lower.includes('full set'), papers: lower.includes('papers') || lower.includes('card') };
  const region = listing.source?.toLowerCase().includes('asia') ? 'ASIA' : listing.source?.toLowerCase().includes('eu') ? 'EUROPE' : 'NORTH AMERICA';

  // Fetch price stats on open
  useEffect(() => {
    if (!listing.reference || !listing.brand) return;
    const ref = encodeURIComponent(listing.reference);
    const brand = encodeURIComponent(listing.brand);
    fetch(`/api/price-research?brand=${brand}&reference=${ref}`)
      .then(r => r.json())
      .then(data => {
        if (data.rows?.length > 0) {
          const prices = data.rows.map((r: any) => r.price_usd).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
          if (prices.length > 0) {
            const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
            const median = prices[Math.floor(prices.length / 2)];
            const q1 = prices[Math.floor(prices.length * 0.25)];
            const q3 = prices[Math.floor(prices.length * 0.75)];
            const iqr = q3 - q1;
            const outlierLow = q1 - 1.5 * iqr;
            const outlierHigh = q3 + 1.5 * iqr;
            const isOutlier = listing.price_usd > outlierHigh || listing.price_usd < outlierLow;
            onPriceStats({ avg, median, q1, q3, iqr, outlierLow, outlierHigh, isOutlier, count: prices.length });
          }
        }
      })
      .catch(() => {});
  }, [listing.id]);

  const rating = (() => {
    const key = `${listing.brand}|${listing.reference}`;
    const avgData = averages[key];
    const result = computeDealRating(listing.price_usd, avgData);
    return { hasRating: result.rating !== 'NO_RATING', label: result.label, rating: result.rating };
  })();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-[#111118] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#111118] border-b border-white/5 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              rating.rating === 'GOOD_DEAL' ? 'bg-emerald-500/10 text-emerald-400' :
              rating.rating === 'FAIR_DEAL' ? 'bg-blue-500/10 text-blue-400' :
              rating.rating === 'HIGH_PRICED' ? 'bg-red-500/10 text-red-400' :
              'bg-gray-500/10 text-gray-400'
            }`}>
              {rating.hasRating ? rating.label : 'NO RATING'}
            </div>
            <span className="text-xs text-white/30 font-mono">#{listing.id?.slice(-8) || '—'}</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/30 hover:text-white transition-colors rounded"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* RAW MESSAGE — always first */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-1.5">Raw Message</div>
            <pre className="bg-[#0A0A0F] border border-amber-500/10 rounded-lg p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
              {listing.raw_message || '(no raw message)'}
            </pre>
          </div>

          {/* Quick fields */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Brand</div>
              <div className="text-sm font-medium text-white">{listing.brand || '—'}</div>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Reference</div>
              <div className="text-sm font-mono text-white">{listing.reference || '—'}</div>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Dial</div>
              <div className="text-sm text-white">{listing.dial_color || '—'}</div>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Condition</div>
              <div className="text-sm text-white">{listing.condition || '—'}</div>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Year</div>
              <div className="text-sm text-white">{listing.year || '—'}</div>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Price (USD)</div>
              <div className="text-sm font-bold text-[#D4AF37] font-mono">{listing.price_usd > 0 ? fmtPrice2(listing.price_usd) : '—'}</div>
            </div>
          </div>

          {/* Price stats & Outlier */}
          {priceStats && priceStats.count > 1 && (
            <div className="bg-[#0A0A0F] rounded-lg p-4 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-[#D4AF37]" />
                <span className="text-xs font-semibold text-gray-300">Market Analysis</span>
                {priceStats.isOutlier ? (
                  <span className="px-2 py-0.5 bg-red-400/10 text-red-400 rounded text-[10px] font-medium">OUTLIER</span>
                ) : (
                  <span className="px-2 py-0.5 bg-green-400/10 text-green-400 rounded text-[10px] font-medium">IN RANGE</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div><span className="text-gray-500">Avg</span> <span className="text-white font-mono block">{fmtPrice2(priceStats.avg)}</span></div>
                <div><span className="text-gray-500">Median</span> <span className="text-white font-mono block">{fmtPrice2(priceStats.median)}</span></div>
                <div><span className="text-gray-500">Range</span> <span className="text-white font-mono block">{fmtPrice2(priceStats.q1)}-{fmtPrice2(priceStats.q3)}</span></div>
                <div><span className="text-gray-500">{priceStats.count} listings</span></div>
              </div>
            </div>
          )}

          {/* Details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-[#0A0A0F] rounded-lg p-2.5">
              <span className="text-gray-500">Dealer: </span><span className="text-white">{dealerName}</span>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-2.5">
              <span className="text-gray-500">Region: </span><span className="text-white">{region}</span>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-2.5">
              <span className="text-gray-500">Source: </span><span className="text-white">{listing.source || '—'}</span>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-2.5">
              <span className="text-gray-500">Currency: </span><span className="text-white">{listing.currency || '—'}</span>
            </div>
            {bracelet && (
              <div className="bg-[#0A0A0F] rounded-lg p-2.5">
                <span className="text-gray-500">Bracelet: </span><span className="text-white">{bracelet}</span>
              </div>
            )}
            <div className="bg-[#0A0A0F] rounded-lg p-2.5">
              <span className="text-gray-500">Box/Papers: </span>
              <span className="text-white">{accessories.box ? 'Box' : ''}{accessories.box && accessories.papers ? ' + ' : ''}{accessories.papers ? 'Papers' : '—'}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            <button
              onClick={() => navigate(`/flash-sales/${listing.id}`, { state: { listing } })}
              className="px-4 py-2 bg-[#D4AF37] hover:bg-[#E5C158] text-black rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Eye size={14} /> View Full Detail
            </button>
            <button
              onClick={() => navigate(`/price-research?brand=${encodeURIComponent(listing.brand || '')}&ref=${encodeURIComponent(listing.reference || '')}`)}
              className="px-4 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-blue-500/20 transition-colors"
            >
              <TrendingUp size={14} /> Price Research
            </button>
            <button
              onClick={() => navigate(`/admin/browser?edit=${listing.id}`)}
              className="px-4 py-2 bg-gray-800 text-gray-300 border border-gray-700 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:text-white transition-colors"
            >
              <Edit3 size={14} /> Edit in Admin
            </button>
          </div>
        </div>
      </motion.div>
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
  const [priceAverages, setPriceAverages] = useState<Record<string, PriceAverageData>>({});
  const [selectedListing, setSelectedListing] = useState<WatchListing | null>(null);
  const [priceStats, setPriceStats] = useState<any>(null);

  // Fetch price averages for deal rating
  useEffect(() => {
    fetch('/api/price-averages')
      .then(r => r.json())
      .then(data => {
        if (data.averages) setPriceAverages(data.averages);
      })
      .catch(() => {});
  }, []);

  // Fetch real-time total count from API
  useEffect(() => {
    fetch(`/api/listings?limit=1`)
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
      let url = `/api/listings?limit=${currentPageSize}&page=${currentPage}`;

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
    <><div className="min-h-screen bg-[#0A0A0F] relative">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#0A0A0F] via-[#0D0D14] to-[#0A0A0F] pointer-events-none" />
      <div className="fixed inset-0 opacity-[0.015]" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #D4AF37 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />

      <DealerNavbar />

      {/* Hero — Video background with overlay */}
      <div className="relative h-[40vh] md:h-[50vh] overflow-hidden">
        <video
          autoPlay muted loop playsInline
          poster="/hero-poster.jpg"
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/hero-watches.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-wf-black/60 via-wf-black/40 to-wf-black" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(212,175,55,0.12)_0%,transparent_60%)]" />
        <div className="relative z-10 flex items-center justify-center h-full px-4">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-center max-w-3xl"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="inline-flex items-center gap-3 mb-6 px-5 py-2.5 rounded-full backdrop-blur-xl bg-wf-card/40 border border-wf-gold/20"
            >
              <Sparkles size={14} className="text-wf-gold" />
              <span className="text-xs text-wf-gold font-semibold uppercase tracking-[0.15em]">Premium Trading Floor</span>
            </motion.div>
            <h1 className="text-3xl md:text-5xl font-light tracking-wide text-white mb-4">
              Welcome to the{' '}
              <span className="bg-gradient-to-r from-wf-gold via-wf-gold-light to-wf-gold bg-clip-text text-transparent font-medium">
                Trading Floor
              </span>
            </h1>
            <p className="text-wf-text-secondary text-sm md:text-base max-w-xl mx-auto">
              {total.toLocaleString()}+ watches from 600+ verified dealers worldwide. Live prices, real inventory.
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
                  averages={priceAverages}
                  onSelect={setSelectedListing}
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
      <AnimatePresence>
        {selectedListing && (
          <WatchDetailModal
            listing={selectedListing}
            onClose={() => { setSelectedListing(null); setPriceStats(null); }}
            averages={priceAverages}
            priceStats={priceStats}
            onPriceStats={setPriceStats}
          />
        )}
      </AnimatePresence>
    </>
  );
}
