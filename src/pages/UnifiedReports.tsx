/**
 * UnifiedReports — Single page showing ALL listings with colored verdict badges.
 * v2.0: Full CRUD — inline editing of every field (brand, ref, price, confidence, verdict, etc.)
 *
 * Tabs: All | Approved | Review | Human | Recycle | Trash | WTB
 * Features:
 *   - Color-coded verdict badges per row
 *   - Duplicate detection
 *   - Bulk actions
 *   - Inline row editing (click any row to edit)
 *   - CSV export
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
  Edit3, Save, Undo, Sparkles, ExternalLink, ChevronDown, ChevronUp,
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
  human_edited?: boolean;
}

/* ─── AI Review Assist Modal (for Human Review tab) ─── */
function AIReviewModal({ record, onClose }: { record: DBRecord | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!record) return;
    setLoading(true);
    setResult(null);
    setError('');
    fetch('/api/ai-review-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: record.brand,
        reference: record.reference,
        dial_color: record.dial_color,
        condition: record.condition,
        price_usd: record.price_usd,
        raw_message: record.raw_message,
      }),
    })
      .then(r => r.json())
      .then(data => setResult(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [record]);

  if (!record) return null;

  const searchQuery = encodeURIComponent(`${record.brand || ''} ${record.reference || ''} watch price`.trim());
  const googleUrl = `https://www.google.com/search?q=${searchQuery}`;
  const chrono24Url = `https://www.chrono24.com/search/index.htm?query=${searchQuery}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#111118] border border-gray-800 rounded-xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-gold-primary" /> AI Review Assist
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        {/* Raw data — always shown, this is the human's primary reading material */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Raw Listing Data</div>
          <pre className="bg-black/40 border border-gray-800 rounded p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
            {record.raw_message || '(no raw message stored for this record)'}
          </pre>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          <div><span className="text-gray-500">Parsed Brand:</span> <span className="text-gray-200 font-medium">{record.brand || '—'}</span></div>
          <div><span className="text-gray-500">Parsed Reference:</span> <span className="text-gray-200 font-mono">{record.reference || '—'}</span></div>
          <div><span className="text-gray-500">Dial:</span> <span className="text-gray-200">{record.dial_color || '—'}</span></div>
          <div><span className="text-gray-500">Price:</span> <span className="text-gray-200">{record.price_usd != null ? `$${record.price_usd.toLocaleString()}` : '—'}</span></div>
        </div>

        {/* AI analysis */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">AI Analysis</div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-3">
              <Loader2 size={14} className="animate-spin" /> Analyzing raw listing...
            </div>
          )}
          {!loading && error && (
            <div className="text-xs text-red-400 py-2">Request failed: {error}</div>
          )}
          {!loading && result && result.configured === false && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-xs text-amber-300">
              <div className="font-semibold mb-1">AI assist not configured</div>
              {result.message}
            </div>
          )}
          {!loading && result && result.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-300">
              {result.message}
            </div>
          )}
          {!loading && result && result.analysis && (
            <div className="bg-black/40 border border-gray-800 rounded p-3 text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">
              {result.analysis}
              <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-gray-500">via {result.provider}</div>
            </div>
          )}
        </div>

        {/* Web search helpers — no API key needed, always available */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Web Search — Verify Brand/Reference</div>
          <div className="flex gap-2">
            <a href={googleUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded transition-colors">
              <ExternalLink size={12} /> Google Search
            </a>
            <a href={chrono24Url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded transition-colors">
              <ExternalLink size={12} /> Chrono24
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Inline Edit Modal ─── */
function EditModal({ record, onSave, onClose }: {
  record: DBRecord | null;
  onSave: (data: Partial<DBRecord>) => void;
  onClose: () => void;
}) {
  if (!record) return null;
  const [form, setForm] = useState({
    brand: record.brand || '',
    reference: record.reference || '',
    dial_color: record.dial_color || '',
    condition: record.condition || '',
    price_usd: record.price_usd ?? 0,
    confidence: record.confidence || 0,
    verdict: record.verdict || 'REVIEW',
    human_edited: record.human_edited || false,
  });
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#111118] border border-gray-800 rounded-xl p-6 w-full max-w-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Edit Record</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Brand</label>
              <input value={form.brand} onChange={e => setForm({...form, brand: e.target.value})}
                className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 focus:border-gold-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Reference</label>
              <input value={form.reference} onChange={e => setForm({...form, reference: e.target.value})}
                className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 font-mono focus:border-gold-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Dial Color</label>
              <input value={form.dial_color} onChange={e => setForm({...form, dial_color: e.target.value})}
                className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 focus:border-gold-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Condition</label>
              <input value={form.condition} onChange={e => setForm({...form, condition: e.target.value})}
                className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 focus:border-gold-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Price USD</label>
              <input type="number" value={form.price_usd} onChange={e => setForm({...form, price_usd: Number(e.target.value)})}
                className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 font-mono focus:border-gold-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Confidence %</label>
              <input type="number" min={0} max={100} value={form.confidence} onChange={e => setForm({...form, confidence: Number(e.target.value)})}
                className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 font-mono focus:border-gold-primary/50" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase">Verdict</label>
            <select value={form.verdict} onChange={e => setForm({...form, verdict: e.target.value})}
              className="w-full mt-0.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 focus:border-gold-primary/50">
              {Object.keys(VERDICT_CONFIG).filter(k => k !== 'TRASH' && k !== 'WTB').map(v => (
                <option key={v} value={v}>{VERDICT_CONFIG[v].label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="human_edited" checked={form.human_edited}
              onChange={e => setForm({...form, human_edited: e.target.checked})}
              className="w-3.5 h-3.5" />
            <label htmlFor="human_edited" className="text-[10px] text-gray-500 uppercase">Human Edited</label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-800">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
          <button
            onClick={async () => {
              setSaving(true);
              await onSave(form);
              setSaving(false);
            }}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium bg-gold-primary text-black rounded hover:bg-gold-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save Changes
          </button>
        </div>
      </motion.div>
    </div>
  );
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
  const [editingRecord, setEditingRecord] = useState<DBRecord | null>(null);
  const [aiReviewRecord, setAiReviewRecord] = useState<DBRecord | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const oneYearAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString();
  }, []);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      let query = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,raw_message,human_edited`;
      query += `&created_at=gte.${encodeURIComponent(oneYearAgo)}`;
      if (activeTab !== 'ALL') query += `&verdict=eq.${activeTab}`;
      if (search.trim()) {
        const s = encodeURIComponent(search.trim());
        query += `&or=(brand.ilike.*${s}*,reference.ilike.*${s}*,raw_message.ilike.*${s}*)`;
      }
      query += `&order=${sortBy}.${sortDir}`;
      const from = page * PAGE_SIZE;
      query += `&limit=${PAGE_SIZE}&offset=${from}`;

      // IMPORTANT: do NOT use count=exact (REQ_HEAD) here — on the full 2.39M
      // table with created_at/verdict filters it triggers Supabase's statement
      // timeout (57014) and silently returns an error object instead of rows.
      // Use REQ_HEADERS (no count) for the data fetch, and get the total
      // separately from the fast precomputed stats endpoint.
      const res = await fetch(query, { headers: REQ_HEADERS });
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);

      // Total count: use fast stats API instead of expensive count=exact
      try {
        const statsRes = await fetch('/api/confidence-stats');
        const stats = await statsRes.json();
        if (activeTab !== 'ALL' && stats.verdictCounts?.[activeTab] != null) {
          setTotal(stats.verdictCounts[activeTab]);
        } else if (activeTab === 'ALL') {
          setTotal(stats.total || stats.totalRecords || 0);
        }
      } catch {
        // Total stays at previous value if stats fetch fails
      }
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, page, sortBy, sortDir, oneYearAgo]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [activeTab, search]);

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
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => setSelected(selected.size === records.length ? new Set() : new Set(records.map(r => r.id)));

  const bulkAction = async (verdict: string) => {
    if (selected.size === 0) return;
    await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=in.(${[...selected].join(',')})`, {
      method: 'PATCH',
      headers: { ...REQ_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict }),
    });
    setSelected(new Set());
    fetchRecords();
  };

  const saveEdit = async (form: Partial<DBRecord>) => {
    if (!editingRecord) return;
    await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=eq.${editingRecord.id}`, {
      method: 'PATCH',
      headers: { ...REQ_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, human_edited: true, edit_source: 'admin_ui' }),
    });
    setEditingRecord(null);
    fetchRecords();
  };

  const exportSelected = () => {
    const sel = records.filter(r => selected.has(r.id));
    const csv = [
      ['ID','Brand','Reference','Dial','Condition','Price','Confidence','Verdict','Source','Date','Human Edited'],
      ...sel.map(r => [r.id, r.brand, r.reference, r.dial_color, r.condition, r.price_usd ?? '', r.confidence, r.verdict, r.source, new Date(r.created_at).toISOString().split('T')[0], r.human_edited ? 'Yes' : 'No']),
    ].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `watchfacts-export-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-gray-100">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Database size={20} className="text-gold-primary" />
            <h1 className="text-lg font-semibold">All Listings Report</h1>
            <span className="text-xs text-gray-500 font-mono">{total.toLocaleString()} records</span>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <span className="text-xs text-gold-primary font-mono">{selected.size} selected</span>
                <button onClick={() => bulkAction('APPROVED')} className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30">Approve</button>
                <button onClick={() => bulkAction('REVIEW')} className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30">Review</button>
                <button onClick={() => bulkAction('RECYCLE')} className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">Recycle</button>
                <button onClick={exportSelected} className="px-2 py-1 text-xs bg-gold-primary/20 text-gold-primary rounded hover:bg-gold-primary/30 flex items-center gap-1"><Download size={10} /> CSV</button>
              </>
            )}
            <button onClick={fetchRecords} className="p-1.5 text-gray-400 hover:text-white"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-t transition-all whitespace-nowrap border-b-2 ${activeTab === tab.key ? 'text-white border-current' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
              style={activeTab === tab.key ? { color: tab.color, borderColor: tab.color } : {}}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-6 py-3 flex items-center gap-3 border-b border-gray-800">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search brand, reference, message..." className="w-full pl-9 pr-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 placeholder-gray-600 focus:border-gold-primary/50 focus:outline-none" />
        </div>
        <button onClick={() => setShowDuplicates(!showDuplicates)}
          className={`px-3 py-1.5 text-[11px] rounded border transition-all flex items-center gap-1.5 ${showDuplicates ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-gray-900 text-gray-500 border-gray-800 hover:text-gray-300'}`}>
          <Copy size={12} /> Duplicates {duplicates.length > 0 && `(${duplicates.length})`}
        </button>
      </div>

      {/* Duplicate alert */}
      {showDuplicates && duplicates.length > 0 && (
        <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-2 text-amber-400 text-[11px]">
            <AlertTriangle size={12} />
            <span className="font-medium">{duplicates.length} duplicate group(s):</span>
            {duplicates.slice(0, 3).map(([key, recs]) => (
              <span key={key} className="text-amber-300">{recs[0].brand} {recs[0].reference} ({recs.length}×)</span>
            ))}
            {duplicates.length > 3 && <span className="text-amber-500">+{duplicates.length - 3}</span>}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gold-primary" size={24} /></div>
        ) : records.length === 0 ? (
          <div className="text-center py-20 text-gray-500"><Database size={32} className="mx-auto mb-3 opacity-30" /><p className="text-sm">No records found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="py-2 px-2 text-left"><button onClick={toggleAll} className="text-gray-500 hover:text-white">{selected.size === records.length && records.length > 0 ? <CheckSquare size={12} className="text-gold-primary" /> : <Square size={12} />}</button></th>
                  <th className="py-2 px-2 text-center" title="Expand raw data"></th>
                  <th className="py-2 px-2 text-left">Verdict</th>
                  <th className="py-2 px-2 text-left">Brand</th>
                  <th className="py-2 px-2 text-left">Reference</th>
                  <th className="py-2 px-2 text-left">Dial</th>
                  <th className="py-2 px-2 text-left">Cond.</th>
                  <th className="py-2 px-2 text-right">Price</th>
                  <th className="py-2 px-2 text-center">Conf</th>
                  <th className="py-2 px-2 text-left">Source</th>
                  <th className="py-2 px-2 text-left">Date</th>
                  <th className="py-2 px-2 text-center">Edit</th>
                  <th className="py-2 px-2 text-center">AI Review</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const vcfg = VERDICT_CONFIG[r.verdict] || VERDICT_CONFIG.REVIEW;
                  const VIcon = vcfg.icon;
                  const isDup = duplicates.some(([key]) => key === `${r.brand}|${r.reference}`);
                  const isExpanded = expandedRow === r.id;
                  return (
                    <>
                    <tr key={r.id}
                      className={`border-b border-gray-900 hover:bg-gray-900/50 transition-colors ${selected.has(r.id) ? 'bg-gold-primary/5' : ''} ${isDup && showDuplicates ? 'bg-amber-500/5' : ''}`}>
                      <td className="py-2 px-2"><button onClick={() => toggleSelect(r.id)} className="text-gray-600 hover:text-white">{selected.has(r.id) ? <CheckSquare size={12} className="text-gold-primary" /> : <Square size={12} />}</button></td>
                      <td className="py-2 px-2 text-center">
                        <button onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                          className="p-1 text-gray-600 hover:text-white transition-colors rounded" title="Show raw data">
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </td>
                      <td className="py-2 px-2"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${vcfg.bg} ${vcfg.border}`} style={{ color: vcfg.color }}><VIcon size={10} />{vcfg.label}</span></td>
                      <td className="py-2 px-2 text-gray-200 font-medium">{r.brand || '—'}</td>
                      <td className="py-2 px-2 text-gray-400 font-mono">{r.reference || '—'}{isDup && showDuplicates && <Copy size={10} className="inline ml-1 text-amber-400" />}</td>
                      <td className="py-2 px-2 text-gray-400">{r.dial_color || '—'}</td>
                      <td className="py-2 px-2 text-gray-400">{r.condition || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{r.price_usd != null ? `$${r.price_usd.toLocaleString()}` : '—'}</td>
                      <td className="py-2 px-2 text-center"><ConfidenceTierBadge score={r.confidence || 0} /></td>
                      <td className="py-2 px-2 text-gray-500 text-xs">{r.source || '—'}</td>
                      <td className="py-2 px-2 text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="py-2 px-2 text-center">
                        <button onClick={() => setEditingRecord(r)}
                          className="p-1 text-gray-600 hover:text-gold-primary transition-colors rounded" title="Edit this record">
                          <Edit3 size={12} />
                        </button>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button onClick={() => setAiReviewRecord(r)}
                          className="p-1 text-gray-600 hover:text-gold-primary transition-colors rounded" title="AI Review Assist — read raw data, identify brand, web search">
                          <Sparkles size={12} />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-black/30 border-b border-gray-900">
                        <td colSpan={12} className="py-2 px-4">
                          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Raw Data</div>
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">{r.raw_message || '(no raw message stored)'}</pre>
                        </td>
                      </tr>
                    )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {aiReviewRecord && <AIReviewModal record={aiReviewRecord} onClose={() => setAiReviewRecord(null)} />}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-800">
          <span className="text-xs text-gray-500">Page {page + 1} of {totalPages} · {total.toLocaleString()} total</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-400 font-mono px-2">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {editingRecord && (
          <EditModal record={editingRecord} onSave={saveEdit} onClose={() => setEditingRecord(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
