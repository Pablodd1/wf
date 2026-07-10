/**
 * Data Browser — Full database table with sorting, filtering, bulk actions
 * View all 2.39M records. Built for data administration.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, Download, Loader2, ChevronLeft, ChevronRight,
  CheckSquare, Square, Trash2, RefreshCw, Database, Eye,
  ArrowUpDown, X,
} from 'lucide-react';
import { resolveWatchImage, getBrandGradient, getBrandIcon } from '@/lib/imageResolver';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';
import { useNavigate } from 'react-router-dom';


interface DBRecord {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_usd: number;
  confidence: number;
  verdict: string;
  source: string;
  created_at: string;
  raw_message: string;
}

type SortField = 'brand' | 'reference' | 'price_usd' | 'confidence' | 'verdict' | 'created_at';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;
const BRANDS = ['All', 'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier', 'Others'];
const VERDICTS = ['All', 'APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'];

const verdictColor = (v: string) => {
  if (v === 'APPROVED') return 'text-green-400 bg-green-400/10';
  if (v === 'REVIEW') return 'text-blue-400 bg-blue-400/10';
  if (v === 'HUMAN') return 'text-yellow-400 bg-yellow-400/10';
  return 'text-red-400 bg-red-400/10';
};

export default function DataBrowser() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DBRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('All');
  const [verdictFilter, setVerdictFilter] = useState('All');
  const [confMin, setConfMin] = useState(0);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ─── Fetch records ────────────────────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(PAGE_SIZE),
        sortField,
        sortDir,
      });
      if (query) params.append('search', query);
      if (brandFilter !== 'All') params.append('brand', brandFilter);
      if (verdictFilter !== 'All') params.append('verdict', verdictFilter);
      if (confMin > 0) params.append('confMin', String(confMin));

      const res = await fetch(`/api/data-browser?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      setRecords(Array.isArray(data.records) ? data.records : []);
      setTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Data browser error:', err);
    }
    setLoading(false);
  }, [page, query, brandFilter, verdictFilter, confMin, sortField, sortDir]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // ─── Sort toggle ──────────────────────────────────────────────────
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  };

  // ─── Selection ────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selected.size === records.length) setSelected(new Set());
    else setSelected(new Set(records.map(r => r.id)));
  };

  // ─── Bulk actions ─────────────────────────────────────────────────
  const bulkChangeVerdict = async (newVerdict: string) => {
    setActionLoading(`bulk-${newVerdict}`);
    const ids = Array.from(selected);
    try {
      const res = await fetch('/api/data-browser', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ids, 
          updates: { verdict: newVerdict, human_edited: true } 
        }),
      });
      if (res.ok) {
        setSelected(new Set());
        fetchRecords();
      }
    } catch (e) { /* silent */ }
    setActionLoading(null);
  };

  // ─── Export selected ──────────────────────────────────────────────
  const exportSelected = () => {
    const toExport = records.filter(r => selected.has(r.id));
    if (!toExport.length) return;
    const headers = ['id', 'brand', 'reference', 'dial_color', 'condition', 'price_usd', 'confidence', 'verdict', 'source', 'created_at'];
    const csv = [headers.join(','), ...toExport.map(r => headers.map(h => `"${String((r as any)[h] ?? '').replace(/"/g, '\\"')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-export-${selected.size}-records.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowUpDown size={10} className={sortField === field ? 'text-amber-400' : 'text-gray-600'} />
  );

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database size={22} className="text-amber-400" /> Data Browser
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {total.toLocaleString()} total records
            {selected.size > 0 && <span className="text-amber-400 ml-2">• {selected.size} selected</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <button onClick={() => bulkChangeVerdict('APPROVED')} disabled={!!actionLoading}
                className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded text-xs font-medium transition-colors disabled:opacity-50">
                {actionLoading === 'bulk-APPROVED' ? <Loader2 size={12} className="animate-spin inline" /> : 'Approve'}
              </button>
              <button onClick={() => bulkChangeVerdict('RECYCLE')} disabled={!!actionLoading}
                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-xs font-medium transition-colors disabled:opacity-50">
                {actionLoading === 'bulk-RECYCLE' ? <Loader2 size={12} className="animate-spin inline" /> : 'Recycle'}
              </button>
              <button onClick={exportSelected}
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded text-xs font-medium transition-colors">
                <Download size={12} className="inline mr-1" /> Export
              </button>
            </>
          )}
          <button onClick={() => setShowFilters(!showFilters)}
            className="px-3 py-1.5 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg text-xs text-gray-300 hover:border-amber-400/30 transition-colors flex items-center gap-1.5">
            <Filter size={12} /> Filters
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4">
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search reference, brand..."
            className="w-full pl-10 pr-4 py-2.5 bg-[#16161F] border border-[#1E1E2E] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400/50" />
        </div>

        {showFilters && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg mb-3">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Brand</label>
              <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 bg-[#16161F] border border-[#1E1E2E] rounded text-sm text-white">
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Verdict</label>
              <select value={verdictFilter} onChange={e => { setVerdictFilter(e.target.value); setPage(0); }}
                className="w-full px-3 py-2 bg-[#16161F] border border-[#1E1E2E] rounded text-sm text-white">
                {VERDICTS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Min Confidence: {confMin}%</label>
              <input type="range" min="0" max="100" value={confMin} onChange={e => { setConfMin(Number(e.target.value)); setPage(0); }}
                className="w-full accent-amber-400" />
            </div>
            <div className="flex items-end">
              <button onClick={() => { setBrandFilter('All'); setVerdictFilter('All'); setConfMin(0); setQuery(''); setPage(0); }}
                className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors flex items-center justify-center gap-1.5">
                <X size={12} /> Clear All
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Data Table */}
      {loading && records.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-amber-400" />
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No records match your filters</div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800 bg-gray-950">
                    <th className="text-left py-2 px-3 w-8">
                      <button onClick={selectAll} className="text-gray-400 hover:text-white">
                        {selected.size === records.length && records.length > 0 ? <CheckSquare size={14} className="text-amber-400" /> : <Square size={14} />}
                      </button>
                    </th>
                    <th className="text-left py-2 px-3">Image</th>
                    {([
                      ['brand', 'Brand'],
                      ['reference', 'Reference'],
                      ['price_usd', 'Price'],
                      ['confidence', 'Conf'],
                      ['verdict', 'Verdict'],
                      ['condition', 'Cond'],
                      ['created_at', 'Date'],
                    ] as [SortField, string][]).map(([field, label]) => (
                      <th key={field} className="text-left py-2 px-3 cursor-pointer hover:text-white transition-colors whitespace-nowrap"
                        onClick={() => toggleSort(field)}>
                        <div className="flex items-center gap-1">{label} <SortIcon field={field} /></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors cursor-pointer"
                      onClick={(e) => { 
                        const target = e.target as HTMLElement;
                        if (target.closest('button')) {
                          toggleSelect(r.id);
                        } else {
                          navigate(`/admin/watch/${r.id}`);
                        }
                      }}>
                      <td className="py-2 px-3">
                        <button onClick={() => toggleSelect(r.id)} className="text-gray-400 hover:text-white">
                          {selected.has(r.id) ? <CheckSquare size={14} className="text-amber-400" /> : <Square size={14} />}
                        </button>
                      </td>
                      <td className="py-2 px-3">
                        {(() => {
                          const img = resolveWatchImage(r.reference, r.brand);
                          return img ? (
                            <img src={img} alt={r.reference} className="w-10 h-10 object-cover rounded" loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <div className={`w-10 h-10 rounded bg-gradient-to-br ${getBrandGradient(r.brand)} flex items-center justify-center`}>
                              <span className="text-xs opacity-50">{getBrandIcon(r.brand)}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-2 px-3 text-white font-medium">{r.brand}</td>
                      <td className="py-2 px-3 font-mono text-amber-400">{r.reference}</td>
                      <td className="py-2 px-3 font-mono text-white">${r.price_usd?.toLocaleString() || '—'}</td>
                      <td className="py-2 px-3">
                        <span className="font-mono" style={{ color: r.confidence >= 85 ? '#22C55E' : r.confidence >= 70 ? '#3B82F6' : r.confidence >= 50 ? '#F59E0B' : '#EF4444' }}>
                          {r.confidence}%
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${verdictColor(r.verdict)}`}>{r.verdict}</span>
                      </td>
                      <td className="py-2 px-3 text-gray-400">{r.condition}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs font-mono">{r.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="flex items-center gap-1 px-3 py-2 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg text-xs text-gray-300 disabled:opacity-30 hover:border-amber-400/30 transition-colors">
              <ChevronLeft size={14} /> Previous
            </button>
            <div className="text-xs text-gray-400">
              Page <span className="text-white font-mono">{page + 1}</span> of <span className="text-white font-mono">{Math.ceil(total / PAGE_SIZE) || 1}</span>
              <span className="text-gray-600 ml-2">({(page * PAGE_SIZE + 1).toLocaleString()} - {Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()})</span>
            </div>
            <button onClick={() => setPage(page + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
              className="flex items-center gap-1 px-3 py-2 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg text-xs text-gray-300 disabled:opacity-30 hover:border-amber-400/30 transition-colors">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
