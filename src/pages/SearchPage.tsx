import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, ChevronLeft, ChevronRight, Loader2, AlertCircle, X } from 'lucide-react';
import { resolveWatchImage, getBrandGradient, getBrandIcon } from '@/lib/imageResolver';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

const BRANDS = ['All', 'Patek Philippe', 'Rolex', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier'];
const CONDITIONS = ['All', 'New', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9'];

interface DBRecord {
  id: string;
  reference: string;
  brand: string;
  dial_color: string;
  condition: string;
  price_usd: number;
  confidence: number;
  verdict: string;
  raw_message: string;
  source: string;
  created_at: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('All');
  const [conditionFilter, setConditionFilter] = useState('All');
  const [confMin, setConfMin] = useState(0);
  const [records, setRecords] = useState<DBRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const pageSize = 50;

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = page * pageSize;
      let url = `${SUPABASE_URL}/rest/v1/watch_records?select=*&limit=${pageSize}&offset=${offset}`;
      if (query) url += `&or=(reference.ilike.*${encodeURIComponent(query)}*,brand.ilike.*${encodeURIComponent(query)}*)`;
      if (brandFilter !== 'All') url += `&brand=eq.${encodeURIComponent(brandFilter)}`;
      if (conditionFilter !== 'All') url += `&condition=eq.${encodeURIComponent(conditionFilter)}`;
      if (confMin > 0) url += `&confidence=gte.${confMin}`;

      const res = await fetch(url, { headers: REQ_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecords(data || []);
      setTotal(2392784); // Known total
    } catch (err: any) {
      setError(err.message);
      setRecords([]);
    }
    setLoading(false);
  }, [query, brandFilter, conditionFilter, confMin, page]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Search</h1>
          <p className="text-xs text-gray-400 mt-1">
            {loading ? 'Loading...' : `${total.toLocaleString()} listings`}
            {records.length > 0 && ` • Showing ${records.length}`}
          </p>
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 px-3 py-2 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg text-xs text-gray-300 hover:border-[#D4AF37]/30 transition-colors">
          <Filter size={14} /> Filters
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input type="text" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Search reference, brand..." className="w-full pl-10 pr-4 py-2.5 bg-[#16161F] border border-[#1E1E2E] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#D4AF37]/50" />
      </div>

      {/* Filters */}
      {showFilters && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg">
          <div>
            <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">Brand</label>
            <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(0); }} className="w-full px-3 py-2 bg-[#16161F] border border-[#1E1E2E] rounded text-sm text-white">
              {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">Condition</label>
            <select value={conditionFilter} onChange={e => { setConditionFilter(e.target.value); setPage(0); }} className="w-full px-3 py-2 bg-[#16161F] border border-[#1E1E2E] rounded text-sm text-white">
              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 block">Min Confidence</label>
            <input type="range" min="0" max="100" value={confMin} onChange={e => { setConfMin(Number(e.target.value)); setPage(0); }} className="w-full accent-[#D4AF37]" />
            <span className="text-xs text-gray-400">{confMin}%</span>
          </div>
        </motion.div>
      )}

      {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}

      {/* Results Grid */}
      {records.length === 0 && !loading ? (
        <div className="text-center py-16 text-gray-500">No records found</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {records.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }} className="bg-[#1A1A24] border border-[#1E1E2E] rounded-lg overflow-hidden hover:border-[#2A2A3E] transition-colors">
              <div className={`aspect-video bg-gradient-to-br ${getBrandGradient(r.brand)} flex items-center justify-center`}>
                {(() => { const img = resolveWatchImage(r.reference, r.brand); return img ? <img src={img} alt={r.reference} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <span className="text-3xl opacity-30">{getBrandIcon(r.brand)}</span>; })()}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white">{r.brand}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.verdict === 'APPROVED' ? 'bg-green-500/20 text-green-400' : r.verdict === 'HUMAN' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>{r.verdict}</span>
                </div>
                <div className="text-sm font-semibold text-[#D4AF37]">{r.reference}</div>
                <div className="text-xs text-gray-400 mt-1">{r.dial_color} • {r.condition}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-mono text-white">${r.price_usd?.toLocaleString() || 'N/A'}</span>
                  <span className="text-[10px] text-gray-500">{r.confidence}%</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {loading && records.length === 0 && <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-[#D4AF37]" /></div>}

      {/* Pagination */}
      <div className="flex items-center justify-between pt-4">
        <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="flex items-center gap-1 px-3 py-2 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg text-xs text-gray-300 disabled:opacity-30 hover:border-[#D4AF37]/30 transition-colors">
          <ChevronLeft size={14} /> Previous
        </button>
        <span className="text-xs text-gray-400">Page {page + 1}</span>
        <button onClick={() => setPage(page + 1)} className="flex items-center gap-1 px-3 py-2 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg text-xs text-gray-300 hover:border-[#D4AF37]/30 transition-colors">
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
