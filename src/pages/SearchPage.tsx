import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, ChevronLeft, ChevronRight, Loader2, AlertCircle, X } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { formatPrice, confidenceColor } from '@/lib/utils';
import { WatchCard } from '@/components/WatchCard';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const BRANDS = ['All', 'Patek Philippe', 'Rolex', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin'];
const CONDITIONS = ['All', 'New', 'Used', 'Like New', 'Naked'];
const CURRENCIES = ['All', 'USD', 'EUR', 'GBP', 'CHF', 'HKD', 'SGD'];

const demoRecords: WatchRecord[] = [
  { id: '1', reference: '5711/1A', brand: 'Patek Philippe', family: 'Nautilus', price: 185000, originalPrice: 185000, originalCurrency: 'USD', condition: 'New', year: 2023, dialColor: 'Blue', confidence: 96, demandForecast: 'HIGH', buyerCount: 12, sellerCount: 3, buyerSellerRatio: 4.0, liquidityScore: 92, mlPredictedPrice: 178000, hasBox: true, hasPapers: true, sellerRating: 5, status: 'active' },
  { id: '2', reference: '126610LN', brand: 'Rolex', family: 'Submariner', price: 14200, originalPrice: 14200, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'Black', confidence: 94, demandForecast: 'STABLE', buyerCount: 8, sellerCount: 5, buyerSellerRatio: 1.6, liquidityScore: 85, mlPredictedPrice: 13800, hasBox: true, hasPapers: true, sellerRating: 4, status: 'active' },
  { id: '3', reference: '15202ST', brand: 'Audemars Piguet', family: 'Royal Oak', price: 98700, originalPrice: 98700, originalCurrency: 'USD', condition: 'Used', year: 2022, dialColor: 'Blue', confidence: 91, demandForecast: 'HIGH', buyerCount: 7, sellerCount: 2, buyerSellerRatio: 3.5, liquidityScore: 88, mlPredictedPrice: 95000, hasBox: true, hasPapers: true, sellerRating: 5, status: 'active' },
  { id: '4', reference: 'RM11-03', brand: 'Richard Mille', family: 'RM', price: 385000, originalPrice: 385000, originalCurrency: 'USD', condition: 'New', year: 2023, dialColor: 'Black', confidence: 88, demandForecast: 'RISING', buyerCount: 4, sellerCount: 1, buyerSellerRatio: 4.0, liquidityScore: 78, mlPredictedPrice: 400000, hasBox: true, hasPapers: true, sellerRating: 5, status: 'active' },
  { id: '5', reference: '116500LN', brand: 'Rolex', family: 'Daytona', price: 28500, originalPrice: 28500, originalCurrency: 'USD', condition: 'New', year: 2024, dialColor: 'White', confidence: 93, demandForecast: 'STABLE', buyerCount: 9, sellerCount: 4, buyerSellerRatio: 2.25, liquidityScore: 90, mlPredictedPrice: 27200, hasBox: true, hasPapers: true, sellerRating: 4, status: 'active' },
  { id: '6', reference: '4500V', brand: 'Vacheron Constantin', family: 'Overseas', price: 28900, originalPrice: 28900, originalCurrency: 'USD', condition: 'Like New', year: 2023, dialColor: 'Blue', confidence: 89, demandForecast: 'STABLE', buyerCount: 5, sellerCount: 3, buyerSellerRatio: 1.67, liquidityScore: 82, mlPredictedPrice: 28500, hasBox: true, hasPapers: false, sellerRating: 4, status: 'active' },
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('All');
  const [conditionFilter, setConditionFilter] = useState('All');
  const [currencyFilter, setCurrencyFilter] = useState('All');
  const [confMin, setConfMin] = useState(0);
  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<WatchRecord | null>(null);
  const pageSize = 50;

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use our API endpoint (handles Supabase internally)
      const params = new URLSearchParams();
      params.set('page', String(page + 1));
      params.set('limit', String(pageSize));
      if (query) {
        params.set('search', query);
      }
      if (brandFilter !== 'All') params.set('brand', brandFilter);
      if (conditionFilter !== 'All') params.set('condition', conditionFilter);

      const res = await fetch(`/api/listings?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      // Map API response to WatchRecord format
      const mapped = (data.rows || []).map((r: any) => ({
        id: r.id,
        reference: r.reference || '',
        brand: r.brand || '',
        family: '',
        price: r.price_usd || 0,
        originalPrice: r.price_usd || 0,
        originalCurrency: r.currency || 'USD',
        condition: r.condition || '',
        year: r.year || 0,
        dialColor: r.dial_color || '',
        confidence: r.confidence || 0,
        demandForecast: '',
        buyerCount: 0,
        sellerCount: 0,
        buyerSellerRatio: 0,
        liquidityScore: 0,
        mlPredictedPrice: 0,
        hasBox: false,
        hasPapers: false,
        sellerRating: 0,
        status: 'active',
      }));
      
      setRecords(mapped);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch records');
      setRecords(demoRecords);
      setTotal(demoRecords.length);
    } finally {
      setLoading(false);
    }
  }, [query, brandFilter, conditionFilter, confMin, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRecords();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, brandFilter, conditionFilter, currencyFilter, confMin, page, fetchRecords]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (<>
      <div className="p-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Search Database</h1>
          <p className="text-sm text-gray-400 mt-1">Search and filter watch records by reference, brand, or keywords</p>
        </div>

        {/* Search Bar */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search reference, brand, or keywords..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-amber-400/50 transition-colors"
            />
            {query && (
              <button onClick={() => { setQuery(''); setPage(0); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 border ${showFilters ? 'bg-amber-500 text-black border-amber-500' : 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'}`}
          >
            <Filter size={16} /> Filters
          </button>
        </div>

        {/* Filter Row */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">Brand</label>
              <select value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-400/50">
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">Condition</label>
              <select value={conditionFilter} onChange={(e) => { setConditionFilter(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-400/50">
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">Currency</label>
              <select value={currencyFilter} onChange={(e) => { setCurrencyFilter(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-400/50">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
                Min Confidence: {confMin}%
              </label>
              <input
                type="range" min={0} max={100} value={confMin}
                onChange={(e) => { setConfMin(Number(e.target.value)); setPage(0); }}
                className="w-full accent-amber-400"
              />
            </div>
          </motion.div>
        )}

        {/* Stats Bar */}
        <div className="flex items-center justify-between mb-4 text-sm">
          <span className="text-gray-400">
            Showing <span className="text-white font-mono">{records.length}</span> of <span className="text-white font-mono">{total}</span> results
          </span>
          {loading && <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-400/10 border border-red-400/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Results Grid */}
        {records.length === 0 && !loading ? (
          <div className="text-center py-20 text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-4 text-gray-600" />
            <p className="text-lg">No records found</p>
            <p className="text-sm mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="card-grid mb-6">
            {records.map((record, i) => (
              <WatchCard key={record.id || i} record={record} index={i} onSelect={setSelectedRecord} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-30 hover:bg-gray-700 transition-colors flex items-center gap-1 text-sm"
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <span className="text-sm text-gray-400 font-mono">
              Page {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-30 hover:bg-gray-700 transition-colors flex items-center gap-1 text-sm"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Record Detail Modal */}
        {selectedRecord && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelectedRecord(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold font-mono text-white">{selectedRecord.reference}</h2>
                <button onClick={() => setSelectedRecord(null)} className="text-gray-500 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Brand</span><span className="text-white">{selectedRecord.brand}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Family</span><span className="text-white">{selectedRecord.family}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Price</span><span className="text-amber-400 font-mono">{formatPrice(selectedRecord.price)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Condition</span><span className="text-white">{selectedRecord.condition}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Year</span><span className="text-white">{selectedRecord.year}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Dial</span><span className="text-white">{selectedRecord.dialColor}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Confidence</span><span className="font-mono" style={{ color: confidenceColor(selectedRecord.confidence ?? 0) }}>{selectedRecord.confidence}%</span></div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </>);
}
