/**
 * Trading Floor — watchfacts.com/buy/all replica
 * Enhanced UI: gold accents, better cards, stats bar, improved filters
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Filter, Info, User, CheckCircle, Globe, Loader2, TrendingUp, Shield, Award, DollarSign, Watch, Gem, X, FileText, ClipboardList, AlertTriangle, ChevronRight, Upload } from 'lucide-react';
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

interface ParsedListing {
  raw: string;
  brand: string | null;
  reference: string | null;
  dial: string | null;
  year: number | null;
  condition: string | null;
  price: number | null;
  price_usd: number | null;
  currency: string | null;
  confidence: number;
  verdict: string;
  error?: boolean;
  errorMsg?: string;
}

const CONDITIONS = ['All', 'New', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9'];
const REGIONS = ['All', 'North America', 'Europe', 'Asia', 'Middle East'];

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

// ─── Detect listing intent from raw message ──────────────────────────
function detectIntent(raw: string | null, price: number): 'sale' | 'wtb' | 'watch' | 'other' {
  if (!raw) return price > 0 ? 'sale' : 'wtb';
  const lower = raw.toLowerCase();

  // WTB keywords
  const wtbKeywords = ['wtb', 'want to buy', 'looking for', 'iso', 'in search of', 'ntq', 'need to buy', 'buying'];
  if (wtbKeywords.some(k => lower.includes(k))) return 'wtb';

  // Other / accessories
  const otherKeywords = ['strap', 'bracelet', 'box', 'papers', 'tool', 'parts', 'service', 'repair', 'battery', 'charger', 'winders'];
  if (otherKeywords.some(k => lower.includes(k))) return 'other';

  // WTS / For sale keywords
  const saleKeywords = ['wts', 'for sale', 'selling', 'fs:', 'fs '];
  if (saleKeywords.some(k => lower.includes(k))) return 'sale';

  // Default by price
  if (price > 0) return 'sale';
  return 'wtb';
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

// ─── Compute rating from data quality ────────────────────────────────────────
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
  const [listingType, setListingType] = useState<'all' | 'forsale' | 'wtb' | 'watches' | 'other'>('forsale');
  const [showConverter, setShowConverter] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(2392784);
  const pageSize = 24;
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Bulk Import State ──────────────────────────────────────────────
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<ParsedListing[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, errors: 0 });
  const [bulkResults, setBulkResults] = useState<{ success: number; errors: number } | null>(null);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      let url = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,currency,raw_message,verdict,confidence,source,created_at,year&limit=${pageSize}&offset=${offset}`;
      if (query) url += `&or=(reference.ilike.*${encodeURIComponent(query)}*,brand.ilike.*${encodeURIComponent(query)}*)`;
      if (condition !== 'All') url += `&condition=eq.${encodeURIComponent(condition)}`;
      // Price filter based on listing type
      if (listingType === 'forsale') url += `&price_usd=gt.0`;
      // WTB: search raw_message for WTB/NTQ keywords (these listings still have prices!)
      if (listingType === 'wtb') {
        const wtbTerms = ['wtb','want to buy','looking for','iso ','in search of','ntq','need to buy','buying'];
        url += `&or=(${wtbTerms.map(t => `raw_message.ilike.*${encodeURIComponent(t)}*`).join(',')})`;
      }

      const res = await fetch(url, { headers: REQ });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let processedData = data || [];

      // Client-side WTB filtering for FOR SALE tab — WTB listings sometimes have prices too
      if (listingType === 'forsale') {
        const wtbTerms = ['wtb','want to buy','looking for','iso ','in search of','ntq','need to buy','buying'];
        processedData = processedData.filter((l: WatchListing) => {
          if (!l.raw_message) return true; // keep if no raw message
          const lower = l.raw_message.toLowerCase();
          return !wtbTerms.some(t => lower.includes(t));
        });
      }

      setListings(processedData);
      setTotal(2392784);
    } catch {
      // Keep existing listings on error
    }
    setLoading(false);
  }, [query, condition, listingType, page]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setPage(1); fetchListings(); }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query, condition, listingType, fetchListings]);

  useEffect(() => {
    fetchListings();
  }, [page, fetchListings]);

  // ─── Bulk Import Functions ──────────────────────────────────────────
  async function parseBulkText(text: string): Promise<ParsedListing[]> {
    const lines = text.split('\n').filter(l => l.trim().length > 4);
    // Filter out section headers (🚩ROLEX🚩, 🏆PP Ready, ⌚🇭🇰HK Ready, timestamp lines)
    const sectionHeaders = /^(\s*[🚩🏆⏳⌚🔥💎⭐🌟🎯🚨⚡]+\s*\w+|\s*\[?\d{1,2}:\d{2}\s*(AM|PM)\]?.*|\s*--+.*|\s*==+.*|\s*\*+.*)$/i;
    const cleanLines = lines.filter(l => !sectionHeaders.test(l.trim()));
    if (cleanLines.length === 0) return [];

    try {
      const res = await fetch('/api/batch-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: cleanLines }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.results || []) as ParsedListing[];
    } catch (err) {
      console.error('[bulk-parse] error:', err);
      return cleanLines.map(line => ({
        raw: line,
        brand: null, reference: null, dial: null, year: null,
        condition: null, price: null, price_usd: null, currency: null,
        confidence: 0, verdict: 'RECYCLE',
        error: true, errorMsg: String(err),
      }));
    }
  }

  async function submitBulk(parsed: ParsedListing[]) {
    setBulkSubmitting(true);
    setBulkResults(null);
    setBulkProgress({ current: 0, total: parsed.length, errors: 0 });

    const batchSize = 50;
    let success = 0, errors = 0;

    for (let i = 0; i < parsed.length; i += batchSize) {
      const batch = parsed.slice(i, i + batchSize);
      const records = batch.map(p => ({
        brand: p.brand || 'Unknown',
        reference: p.reference || 'Unknown',
        dial_color: p.dial,
        condition: p.condition,
        year: p.year,
        price: p.price,
        price_usd: p.price_usd,
        currency: p.currency || 'USD',
        raw_message: p.raw,
        source: 'bulk_import',
        confidence: p.confidence,
        verdict: p.confidence > 85 ? 'APPROVED' : p.confidence > 70 ? 'REVIEW' : 'HUMAN',
      }));

      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
          method: 'POST',
          headers: { ...REQ, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(records),
        });
        if (res.ok) {
          success += batch.length;
        } else {
          errors += batch.length;
        }
      } catch {
        errors += batch.length;
      }

      setBulkProgress({
        current: Math.min(i + batchSize, parsed.length),
        total: parsed.length,
        errors,
      });

      // Small delay to prevent rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    setBulkSubmitting(false);
    setBulkResults({ success, errors });
  }

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

      {/* Category Filter Pills + Search */}
      <div className="bg-white border-b border-gray-200 sticky top-[56px] z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
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
              <button 
                onClick={() => { setQuery(''); setCondition('All'); setRegion('All'); setListingType('forsale'); setPage(1); }}
                className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center gap-1.5"
              >
                <Filter size={14} /> Reset
              </button>
            </div>
          </div>

          {/* Category Pills — matching screenshot */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { id: 'forsale' as const, label: 'FOR SALE', icon: DollarSign, desc: 'Listings with price' },
                { id: 'wtb' as const, label: 'NTQ/WTB', icon: Search, desc: 'Want to buy' },
                { id: 'watches' as const, label: 'WATCHES', icon: Watch, desc: 'Known brands' },
                { id: 'other' as const, label: 'OTHER', icon: Gem, desc: 'Accessories & parts' },
              ].map(item => {
                const Icon = item.icon;
                const isActive = listingType === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setListingType(isActive ? 'all' : item.id); setPage(1); }}
                    title={item.desc}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all ${
                      isActive
                        ? 'bg-[#3B5BFE] text-white shadow-md'
                        : 'bg-white text-[#3B5BFE] border border-[#3B5BFE] hover:bg-blue-50'
                    }`}
                  >
                    <Icon size={13} /> {item.label}
                  </button>
                );
              })}
            </div>

            {/* Bulk Import Toggle */}
            <div className="relative">
              <button
                onClick={() => { setBulkMode(!bulkMode); setBulkResults(null); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all ${
                  bulkMode
                    ? 'bg-[#D4AF37] text-slate-900 shadow-md'
                    : 'bg-white text-slate-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                <FileText size={13} /> {bulkMode ? 'Close Import' : 'Bulk Import'}
              </button>
            </div>

            {/* Currency Converter */}
            <div className="relative">
              <button
                onClick={() => setShowConverter(!showConverter)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all ${
                  showConverter ? 'bg-[#3B5BFE] text-white' : 'bg-[#3B5BFE] text-white hover:bg-[#2a4ad9] shadow-md'
                }`}
              >
                <DollarSign size={13} /> CONVERTER
              </button>
              {showConverter && <CurrencyConverter onClose={() => setShowConverter(false)} />}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bulk Import Panel ─────────────────────────────────────────── */}
      {bulkMode && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-7xl mx-auto px-4 py-6"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl p-6 mb-6 text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-1 h-6 bg-[#D4AF37] rounded-full" />
              <h2 className="text-lg font-semibold tracking-wide">Bulk Import</h2>
              <ClipboardList size={18} className="text-[#D4AF37]" />
            </div>
            <p className="text-sm text-gray-400 ml-4">
              Paste dealer messages below (one per line). The parser will extract brand, reference, dial, year, condition, and price automatically.
            </p>
          </div>

          {/* Text Area */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
              Dealer Messages
            </label>
            <textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              rows={20}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent bg-gray-50/50 resize-vertical transition-all"
              placeholder={"Paste dealer messages here, one per line...\nExample:\n🇭🇰26240OR 2022 Full Set Used Green gold 50th HKD 865K\n🌟4910/1200A Green 5/2026 HKD 118K\n126234 Ombre Green 6/2026 hkd 120000\nRolex 126334 Datejust Blue Dial 2023 Box Papers $14500"}
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-gray-400">
                {bulkText.split('\n').filter(l => l.trim().length > 4).length} lines detected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setBulkText('')}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={async () => {
                    const parsed = await parseBulkText(bulkText);
                    setBulkPreview(parsed);
                    setBulkResults(null);
                  }}
                  disabled={!bulkText.trim() || bulkSubmitting}
                  className="px-5 py-2 bg-[#D4AF37] text-slate-900 rounded-lg text-xs font-semibold uppercase tracking-wider hover:bg-[#c4a030] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Search size={12} /> Parse Preview
                </button>
              </div>
            </div>
          </div>

          {/* Preview Table */}
          {bulkPreview.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6"
            >
              {/* Preview Header */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList size={14} className="text-[#D4AF37]" />
                  <span className="text-sm font-semibold text-gray-800">
                    Preview: {bulkPreview.length} listings parsed
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    ({bulkPreview.filter(p => (p.confidence || 0) > 70).length} high confidence)
                  </span>
                </div>
                <div className="flex gap-2">
                  {!bulkSubmitting && !bulkResults && (
                    <button
                      onClick={() => submitBulk(bulkPreview)}
                      disabled={bulkPreview.length === 0}
                      className="px-5 py-2 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-lg text-xs font-semibold uppercase tracking-wider hover:from-slate-800 hover:to-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <Upload size={12} /> Submit All to Database
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {bulkSubmitting && (
                <div className="px-5 py-4 bg-amber-50/50 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      Processing {bulkProgress.current}/{bulkProgress.total}...
                    </span>
                    <span className="text-xs text-gray-500">
                      {bulkProgress.errors > 0 && (
                        <span className="text-amber-600 font-medium">{bulkProgress.errors} errors</span>
                      )}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#D4AF37] to-amber-500 rounded-full transition-all duration-300"
                      style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Results Summary */}
              {bulkResults && (
                <div className="px-5 py-4 bg-green-50 border-b border-green-200">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
                      <CheckCircle size={15} className="text-green-500" />
                      <span>{bulkResults.success} inserted</span>
                    </div>
                    {bulkResults.errors > 0 && (
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                        <AlertTriangle size={15} className="text-amber-500" />
                        <span>{bulkResults.errors} failed</span>
                      </div>
                    )}
                    <button
                      onClick={() => { setBulkResults(null); setBulkPreview([]); setBulkText(''); }}
                      className="ml-auto px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Import More
                    </button>
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">#</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Brand</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Dial</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Year</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Condition</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Currency</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Confidence</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bulkPreview.map((item, idx) => (
                      <tr
                        key={idx}
                        className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${item.error ? 'bg-red-50/50' : ''} hover:bg-amber-50/30 transition-colors`}
                      >
                        <td className="px-4 py-2.5 text-[11px] text-gray-400 font-mono">{idx + 1}</td>
                        <td className="px-4 py-2.5 text-[11px] font-semibold text-[#D4AF37]">{item.brand || '—'}</td>
                        <td className="px-4 py-2.5 text-[11px] font-medium text-gray-700 font-mono">{item.reference || '—'}</td>
                        <td className="px-4 py-2.5 text-[11px] text-gray-600">{item.dial || '—'}</td>
                        <td className="px-4 py-2.5 text-[11px] text-gray-600">{item.year || '—'}</td>
                        <td className="px-4 py-2.5 text-[11px] text-gray-600">{item.condition || '—'}</td>
                        <td className="px-4 py-2.5 text-[11px] font-medium text-gray-900">
                          {item.price ? item.price.toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-gray-500">{item.currency || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  (item.confidence || 0) > 85 ? 'bg-green-500' : (item.confidence || 0) > 70 ? 'bg-amber-500' : 'bg-red-400'
                                }`}
                                style={{ width: `${Math.min(item.confidence || 0, 100)}%` }}
                              />
                            </div>
                            <span className={`text-[10px] font-semibold ${
                              (item.confidence || 0) > 85 ? 'text-green-600' : (item.confidence || 0) > 70 ? 'text-amber-600' : 'text-red-500'
                            }`}>
                              {item.confidence || 0}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {item.error ? (
                            <span className="text-[10px] font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full">ERROR</span>
                          ) : (
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                              (item.confidence || 0) > 85
                                ? 'text-green-700 bg-green-50'
                                : (item.confidence || 0) > 70
                                  ? 'text-amber-700 bg-amber-50'
                                  : 'text-gray-600 bg-gray-100'
                            }`}>
                              {(item.confidence || 0) > 85 ? 'APPROVED' : (item.confidence || 0) > 70 ? 'REVIEW' : 'HUMAN'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* Empty state for bulk mode */}
          {bulkPreview.length === 0 && !bulkSubmitting && !bulkResults && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="text-5xl mb-4 opacity-30">📋</div>
              <p className="text-sm font-medium text-gray-500 mb-1">Paste dealer messages above and click &quot;Parse Preview&quot;</p>
              <p className="text-xs text-gray-400">
                Supports all major formats: Rolex, Patek Philippe, AP, Richard Mille, and more.
              </p>
            </div>
          )}
        </motion.div>
      )}

      {/* Results — with client-side filtering for watches/other */}
      {!bulkMode && (
      <div className="max-w-7xl mx-auto px-4 py-6">
        {(() => {
          // Apply client-side brand filtering
          if (listingType === 'watches') {
            const filtered = listings.filter(l => KNOWN_WATCH_BRANDS.some(b => l.brand?.toLowerCase().includes(b.toLowerCase())));
            if (filtered.length !== listings.length && listings.length > 0) {
              // Update silently
              setTimeout(() => setListings(filtered), 0);
            }
          }
          if (listingType === 'other') {
            const filtered = listings.filter(l => !KNOWN_WATCH_BRANDS.some(b => l.brand?.toLowerCase().includes(b.toLowerCase())));
            if (filtered.length !== listings.length && listings.length > 0) {
              setTimeout(() => setListings(filtered), 0);
            }
          }
          return null;
        })()}

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
      )}
    </div>
  );
}
