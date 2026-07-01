/**
 * UnifiedReports — Single page showing ALL listings with colored verdict badges.
 *
 * Tabs: All | Approved | Review | Human | Recycle | Trash | WTB
 * Features:
 *   - Color-coded verdict badges per row (green/blue/orange/red/gold)
 *   - Duplicate detection (same brand+reference grouped)
 *   - Bulk actions (approve, recycle, export selected)
 *   - Real-time search + filter
 *   - Confidence tier badge per row
 *   - Sortable columns
 *   - Pagination (50 per page)
 */
// @ts-nocheck
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Download, Loader2, ChevronLeft, ChevronRight,
  CheckSquare, Square, Trash2, RefreshCw, Database, Eye,
  ArrowUpDown, X, Filter, Copy, CheckCircle, XCircle,
  AlertTriangle, Clock, FileSpreadsheet, Layers,
} from 'lucide-react';
import { ConfidenceTierBadge } from '@/components/ui/ConfidenceTierBadge';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';


type Verdict = 'APPROVED' | 'REVIEW' | 'HUMAN' | 'RECYCLE' | 'TRASH' | 'WTB';

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
  APPROVED: { label: 'Approved', color: '#22C55E', bg: 'bg-green-500/10', border: 'border-green-500/30', icon: CheckCircle },
  REVIEW:   { label: 'Review',   color: '#3B82F6', bg: 'bg-blue-500/10',  border: 'border-blue-500/30',  icon: AlertTriangle },
  HUMAN:    { label: 'Human',    color: '#F59E0B', bg: 'bg-amber-500/10',  border: 'border-amber-500/30', icon: Clock },
  RECYCLE:  { label: 'Recycle',  color: '#EF4444', bg: 'bg-red-500/10',    border: 'border-red-500/30',   icon: XCircle },
  TRASH:    { label: 'Trash',    color: '#6B7280', bg: 'bg-gray-500/10',   border: 'border-gray-500/30',  icon: Trash2 },
  WTB:      { label: 'WTB',      color: '#D4AF37', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: Layers },
};

const TABS: { key: string; label: string; color: string }[] = [
  { key: 'ALL',      label: 'All Listings',  color: '#D4AF37' },
  { key: 'APPROVED', label: 'Approved',     color: '#22C55E' },
  { key: 'REVIEW',   label: 'Review',       color: '#3B82F6' },
  { key: 'HUMAN',    label: 'Human Review',  color: '#F59E0B' },
  { key: 'RECYCLE',  label: 'Recycle',       color: '#EF4444' },
  { key: 'TRASH',    label: 'Trash',        color: '#6B7280' },
  { key: 'WTB',      label: 'WTB / NTQ',    color: '#D4AF37' },
];

const PAGE_SIZE = 50;

interface DBRecord {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_usd: number | null;
  confidence: number;
  verdict: string;
  source: string;
  created_at: string;
  raw_message: string;
}

export default function UnifiedReports() {
  const [records, setRecords] = useState<DBRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [sortBy, setSortBy] = useState<'created_at' | 'brand' | 'price_usd' | 'confidence'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // 1-year date filter — only show records from last 365 days
  const oneYearAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString();
  }, []);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      let query = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,raw_message`;
      
      // 1-year date filter
      query += `&created_at=gte.${encodeURIComponent(oneYearAgo)}`;
      
      // Verdict filter
      if (activeTab !== 'ALL') {
        query += `&verdict=eq.${activeTab}`;
      }
      
      // Search filter
      if (search.trim()) {
        const s = encodeURIComponent(search.trim());
        query += `&or=(brand.ilike.*${s}*,reference.ilike.*${s}*,raw_message.ilike.*${s}*)`;
      }
      
      // Sort
      query += `&order=${sortBy}.${sortDir}`;
      
      // Pagination
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query += `&range=${from}-${to}`;

      const res = await fetch(query, { headers: REQ_HEAD });
      const data = await res.json();
      
      // Get total count
      const range = res.headers.get('content-range') || '';
      const count = parseInt(range.split('/')[1] || '0');
      setTotal(count);
      setRecords(data || []);
    } catch (err) {
      console.error('Fetch error:', err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, page, sortBy, sortDir, oneYearAgo]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Reset page when tab/search changes
  useEffect(() => { setPage(0); setSelected(new Set()); }, [activeTab, search]);

  // Duplicate detection — group by brand+reference
  const duplicates = useMemo(() => {
    const groups: Record<string, DBRecord[]> = {};
    for (const r of records) {
      const key = `${r.brand}|${r.reference}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups).filter(([, recs]) => recs.length > 1);
  }, [records]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map(r => r.id)));
    }
  };

  const bulkAction = async (action: string) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { ...REQ_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: action }),
    });
    if (res.ok) {
      setSelected(new Set());
      fetchRecords();
    }
  };

  const exportSelected = () => {
    const selectedRecords = records.filter(r => selected.has(r.id));
    const csv = [
      ['ID', 'Brand', 'Reference', 'Dial', 'Condition', 'Price', 'Confidence', 'Verdict', 'Source', 'Date'],
      ...selectedRecords.map(r => [
        r.id, r.brand, r.reference, r.dial_color, r.condition,
        r.price_usd || '', r.confidence, r.verdict, r.source,
        new Date(r.created_at).toISOString().split('T')[0],
      ]),
    ].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasDuplicates = duplicates.length > 0;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-gray-100">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Database size={20} className="text-gold-primary" />
            <h1 className="text-lg font-semibold">All Listings Report</h1>
            <span className="text-xs text-gray-500 font-mono">
              {total.toLocaleString()} records
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <span className="text-xs text-gold-primary font-mono">{selected.size} selected</span>
                <button onClick={() => bulkAction('APPROVED')} className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors">Approve</button>
                <button onClick={() => bulkAction('REVIEW')} className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-colors">Review</button>
                <button onClick={() => bulkAction('RECYCLE')} className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors">Recycle</button>
                <button onClick={exportSelected} className="px-2 py-1 text-xs bg-gold-primary/20 text-gold-primary rounded hover:bg-gold-primary/30 transition-colors flex items-center gap-1">
                  <Download size={10} /> CSV
                </button>
              </>
            )}
            <button onClick={fetchRecords} className="p-1.5 text-gray-400 hover:text-white transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-t transition-all whitespace-nowrap border-b-2 ${
                activeTab === tab.key
                  ? 'text-white border-current'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
              style={activeTab === tab.key ? { color: tab.color, borderColor: tab.color } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="px-6 py-3 flex items-center gap-3 border-b border-gray-800">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brand, reference, message..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 placeholder-gray-600 focus:border-gold-primary/50 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setShowDuplicates(!showDuplicates)}
          className={`px-3 py-1.5 text-[11px] rounded border transition-all flex items-center gap-1.5 ${
            showDuplicates
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : 'bg-gray-900 text-gray-500 border-gray-800 hover:text-gray-300'
          }`}
        >
          <Copy size={12} /> Duplicates {hasDuplicates && `(${duplicates.length})`}
        </button>
        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          Sort:
          <button
            onClick={() => { setSortBy('created_at'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}
            className={`px-2 py-0.5 rounded ${sortBy === 'created_at' ? 'text-gold-primary' : ''}`}
          >
            Date {sortBy === 'created_at' && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
          <button
            onClick={() => { setSortBy('brand'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}
            className={`px-2 py-0.5 rounded ${sortBy === 'brand' ? 'text-gold-primary' : ''}`}
          >
            Brand {sortBy === 'brand' && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
          <button
            onClick={() => { setSortBy('price_usd'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}
            className={`px-2 py-0.5 rounded ${sortBy === 'price_usd' ? 'text-gold-primary' : ''}`}
          >
            Price {sortBy === 'price_usd' && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
          <button
            onClick={() => { setSortBy('confidence'); setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }}
            className={`px-2 py-0.5 rounded ${sortBy === 'confidence' ? 'text-gold-primary' : ''}`}
          >
            Confidence {sortBy === 'confidence' && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
        </div>
      </div>

      {/* Duplicate Alert */}
      {showDuplicates && hasDuplicates && (
        <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-2 text-amber-400 text-[11px]">
            <AlertTriangle size={12} />
            <span className="font-medium">{duplicates.length} duplicate group(s) on this page:</span>
            {duplicates.slice(0, 3).map(([key, recs]) => (
              <span key={key} className="text-amber-300">
                {recs[0].brand} {recs[0].reference} ({recs.length}×)
              </span>
            ))}
            {duplicates.length > 3 && <span className="text-amber-500">+{duplicates.length - 3} more</span>}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gold-primary" size={24} />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Database size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="py-2 px-2 text-left">
                    <button onClick={toggleAll} className="text-gray-500 hover:text-white">
                      {selected.size === records.length && records.length > 0
                        ? <CheckSquare size={12} className="text-gold-primary" />
                        : <Square size={12} />}
                    </button>
                  </th>
                  <th className="py-2 px-2 text-left">Verdict</th>
                  <th className="py-2 px-2 text-left">Brand</th>
                  <th className="py-2 px-2 text-left">Reference</th>
                  <th className="py-2 px-2 text-left">Dial</th>
                  <th className="py-2 px-2 text-left">Cond.</th>
                  <th className="py-2 px-2 text-right">Price</th>
                  <th className="py-2 px-2 text-center">Confidence</th>
                  <th className="py-2 px-2 text-left">Source</th>
                  <th className="py-2 px-2 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const vcfg = VERDICT_CONFIG[r.verdict] || VERDICT_CONFIG.REVIEW;
                  const VIcon = vcfg.icon;
                  const isDup = duplicates.some(([key]) => key === `${r.brand}|${r.reference}`);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-gray-900 hover:bg-gray-900/50 transition-colors ${selected.has(r.id) ? 'bg-gold-primary/5' : ''} ${isDup && showDuplicates ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="py-2 px-2">
                        <button onClick={() => toggleSelect(r.id)} className="text-gray-600 hover:text-white">
                          {selected.has(r.id)
                            ? <CheckSquare size={12} className="text-gold-primary" />
                            : <Square size={12} />}
                        </button>
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${vcfg.bg} ${vcfg.border}`}
                          style={{ color: vcfg.color }}
                        >
                          <VIcon size={10} />
                          {vcfg.label}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-gray-200 font-medium">{r.brand || '—'}</td>
                      <td className="py-2 px-2 text-gray-400 font-mono">
                        {r.reference || '—'}
                        {isDup && showDuplicates && <Copy size={10} className="inline ml-1 text-amber-400" />}
                      </td>
                      <td className="py-2 px-2 text-gray-400">{r.dial_color || '—'}</td>
                      <td className="py-2 px-2 text-gray-400">{r.condition || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">
                        {r.price_usd ? `$${r.price_usd.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <ConfidenceTierBadge score={r.confidence || 0} />
                      </td>
                      <td className="py-2 px-2 text-gray-500 text-xs">{r.source || '—'}</td>
                      <td className="py-2 px-2 text-gray-500 text-xs">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-800">
          <span className="text-xs text-gray-500">
            Page {page + 1} of {totalPages} · {total.toLocaleString()} total
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-400 font-mono px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}