/**
 * AdminListingsBrowser — Universal "All Watches" Admin Workbench
 * ==============================================================
 * Shows EVERY listing regardless of verdict. The one place a human:
 *   1. Searches across all verdicts (APPROVED/REVIEW/HUMAN/RECYCLE/TRASH/WTB)
 *   2. Edits ANY field inline
 *   3. Changes verdict with one click
 *   4. Triggers AI review assist
 *   5. Changes listing_type/category (WTS/WTB/OTHER)
 *   6. Re-runs the parser on raw_message to re-extract all fields
 *   7. Spots reference==dial swaps and offers to swap them
 *   8. Navigates to Price Research / Trading Floor / Detail page
 *
 * The raw_message is displayed EMPHATICALLY — it's the source of truth.
 * Every action derives from proper understanding of the raw listing.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/hooks/useAuth';
import {
  Search, Loader2, ChevronLeft, ChevronRight, Eye, Edit3, Sparkles,
  RefreshCw, Database, X, CheckCircle, XCircle, AlertTriangle, Clock,
  FileText, DollarSign, Hash, Palette, Gauge, Calendar, UserCheck, Bot,
  ExternalLink, Save, ArrowUpDown, ArrowRight, AlertOctagon, Trash2,
  Activity, TrendingUp, Layers,
} from 'lucide-react';

// Admin write actions authenticate via the logged-in user's Supabase session
// token (see useAuth/AuthProvider) — NOT a shared static key. The server
// verifies this token against Supabase auth before allowing any write.
async function adminFetch(url: string, options: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': session?.access_token ? `Bearer ${session.access_token}` : '',
    },
  });
}

// ─── Verdict configs ──────────────────────────────────────────────────────
const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  APPROVED: { label: 'Approved', color: '#22C55E', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  REVIEW:   { label: 'Review',   color: '#3B82F6', bg: 'bg-blue-500/10',  border: 'border-blue-500/30' },
  HUMAN:    { label: 'Human',    color: '#F59E0B', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  RECYCLE:  { label: 'Recycle',  color: '#EF4444', bg: 'bg-red-500/10',   border: 'border-red-500/30' },
  TRASH:    { label: 'Trash',    color: '#6B7280', bg: 'bg-gray-500/10',  border: 'border-gray-500/30' },
  WTB:      { label: 'WTB',      color: '#D4AF37', bg: 'bg-yellow-500/10',border: 'border-yellow-500/30' },
};

const VERDICTS = ['', 'APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE', 'TRASH', 'WTB'];
const VERDICT_LABELS = ['All', 'Approved', 'Review', 'Human', 'Recycle', 'Trash', 'WTB/NTQ'];
const LISTING_TYPES = ['', 'WTS', 'WTB', 'OTHER'];

const PAGE_SIZE = 100;

// ─── KNOWN DIAL COLORS (TitleCase) — for reference==dial detection ────────
const KNOWN_DIAL_COLORS = new Set([
  'Black','White','Blue','Green','Silver','Gold','Champagne','Grey','Gray',
  'Red','Brown','Purple','Orange','Yellow','Pink','Ivory','Tiffany','Salmon',
  'Skeleton','MOP','Mother Of Pearl','Opaline','Burgundy','Chocolate','Navy',
  'Anthracite','Ruthenium','Turquoise','Lapis','Onyx','Stella',
]);

// ─── Is a string likely a dial color? ─────────────────────────────────────
function looksLikeDialColor(val: string): boolean {
  const upper = val.trim().toUpperCase();
  return KNOWN_DIAL_COLORS.has(val.trim()) || KNOWN_DIAL_COLORS.has(val.trim().charAt(0).toUpperCase() + val.trim().slice(1).toLowerCase());
}

// ─── Is a string likely a reference number? ───────────────────────────────
function looksLikeReference(val: string): boolean {
  if (!val || val.length < 3) return false;
  // Pure numbers 5-8 digits (reference-like)
  if (/^\d{5,8}$/.test(val)) return true;
  // Rolex-style (116500LN, 126610LV)
  if (/^\d{5,6}[A-Z]{2,4}$/i.test(val)) return true;
  // Patek-style (5711/1A, 5396R-001)
  if (/^\d{4,5}\/\d{1,2}[A-Za-z]?$/.test(val)) return true;
  // AP-style (15202ST, 26240OR)
  if (/^\d{5}[A-Z]{2,4}$/i.test(val)) return true;
  // RM-style (RM011, RM27-01)
  if (/^RM\d{2,4}/i.test(val)) return true;
  return false;
}

// ─── Detect reference==dial swap ─────────────────────────────────────────
function detectRefDialSwap(record: any): { swapped: boolean; reason: string } {
  if (!record) return { swapped: false, reason: '' };
  const ref = (record.reference || '').trim();
  const dial = (record.dial_color || '').trim();
  if (!ref || !dial) return { swapped: false, reason: '' };

  // Reference looks like a color AND dial looks like a reference
  const refIsColor = looksLikeDialColor(ref);
  const dialIsRef = looksLikeReference(dial);

  if (refIsColor && dialIsRef) {
    return { swapped: true, reason: `Reference "${ref}" looks like a dial color; Dial "${dial}" looks like a reference number` };
  }

  // Dial has HKD/price patterns (leaked price data)
  if (/^[\d,.]+\s*(HKD|USD|EUR|GBP)$/i.test(dial) || /^HKD/.test(dial)) {
    return { swapped: true, reason: `Dial "${dial}" contains price data — likely leaked from raw message` };
  }

  // Reference has dial-like patterns (too short, pure color)
  if (ref.length <= 5 && looksLikeDialColor(ref)) {
    return { swapped: true, reason: `Reference "${ref}" is too short and matches a known dial color name` };
  }

  return { swapped: false, reason: '' };
}

// ─── Format helpers ───────────────────────────────────────────────────────
const fmtPrice = (p: number | null) =>
  p == null ? '—' : p >= 1000000 ? `$${(p/1000000).toFixed(1)}M` : p >= 1000 ? `$${p.toLocaleString()}` : `$${p}`;
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString() : '—';

// ─── Detail Modal — shows ALL info for one listing ───────────────────────
function DetailModal({ record, onClose, onRefresh, currentRef, currentDial }: {
  record: any;
  onClose: () => void;
  onRefresh: () => void;
  currentRef?: string;
  currentDial?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    brand: record.brand || '',
    reference: record.reference || '',
    dial_color: record.dial_color || '',
    condition: record.condition || '',
    year: record.year || null,
    price_usd: record.price_usd || 0,
    confidence: record.confidence || 0,
    verdict: record.verdict || 'REVIEW',
    listing_type: record.listing_type || '',
  });
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();
  const swapDetect = detectRefDialSwap(record);

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await adminFetch('/api/update-record', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: record.id, ...form }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => { setSaved(false); setEditing(false); onRefresh(); }, 1200);
      }
    } catch {}
    setSaving(false);
  };

  const updateVerdict = async (v: string) => {
    setSaving(true);
    try {
      await adminFetch('/api/update-record', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: record.id, verdict: v }),
      });
      onRefresh();
    } catch {}
    setSaving(false);
  };

  const triggerAiReview = () => {
    navigate(`/admin/reports?ai=${record.id}`);
  };

  if (!record) return null;
  const vcfg = VERDICT_CONFIG[record.verdict] || VERDICT_CONFIG.REVIEW;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#111118] border border-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#111118] border-b border-gray-800 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${vcfg.bg} ${vcfg.border}`} style={{ color: vcfg.color }}>
              {vcfg.label}
            </span>
            <span className="text-xs text-gray-500 font-mono">#{record.id?.slice(-8) || '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={triggerAiReview} className="p-1.5 text-gray-400 hover:text-amber-400 transition-colors rounded" title="AI Review Assist">
              <Sparkles size={14} />
            </button>
            <button onClick={() => navigate(`/price-research?brand=${encodeURIComponent(record.brand || '')}&ref=${encodeURIComponent(record.reference || '')}`)}
              className="text-xs px-2 py-1 bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20 flex items-center gap-1">
              <TrendingUp size={10} /> Price
            </button>
            <button onClick={() => setEditing(!editing)} className="p-1.5 text-gray-400 hover:text-gold-primary transition-colors rounded" title="Edit fields">
              <Edit3 size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"><X size={16} /></button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* RAW MESSAGE — always first, always visible */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-1">Raw Message (Source of Truth)</div>
            <pre className="bg-[#0A0A0F] border border-amber-500/20 rounded-lg p-3 text-xs text-gray-200 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-relaxed">
              {record.raw_message || '(no raw message — data quality issue)'}
            </pre>
          </div>

          {/* REFERENCE == DIAL SWAP WARNING */}
          {swapDetect.swapped && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertOctagon size={16} className="text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-xs font-semibold text-red-400 mb-1">Reference/Dial Swap Detected</div>
                  <div className="text-[11px] text-red-300/80">{swapDetect.reason}</div>
                  <button
                    onClick={() => {
                      setForm(f => ({ ...f, reference: record.dial_color || '', dial_color: record.reference || '' }));
                      setEditing(true);
                    }}
                    className="mt-2 inline-flex items-center gap-1 px-3 py-1 text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors"
                  >
                    <ArrowUpDown size={12} /> Swap Reference ↔ Dial
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Quick Verdict Buttons */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Change Verdict</div>
            <div className="flex flex-wrap gap-1.5">
              {['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE', 'TRASH'].map(v => {
                const vc = VERDICT_CONFIG[v];
                const isActive = record.verdict === v;
                return (
                  <button key={v} onClick={() => updateVerdict(v)} disabled={saving || isActive}
                    className={`px-3 py-1 text-[10px] font-bold rounded border transition-all ${
                      isActive ? `${vc.bg} ${vc.border} cursor-default` : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800'
                    }`} style={isActive ? { color: vc.color } : {}}>
                    {vc.label}
                  </button>
                );
              })}
              <button onClick={() => updateVerdict('WTB')} disabled={saving || record.verdict === 'WTB'}
                className={`px-3 py-1 text-[10px] font-bold rounded border transition-all ${
                  record.verdict === 'WTB' ? 'bg-yellow-500/10 border-yellow-500/30 text-[#D4AF37] cursor-default' : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800'
                }`}>
                WTB
              </button>
            </div>
          </div>

          {/* Listing Type / Category */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Category / Listing Type</div>
            <div className="flex flex-wrap gap-1.5">
              {LISTING_TYPES.filter(t => t).map(lt => {
                const isActive = (record.listing_type || '').toUpperCase() === lt;
                return (
                  <button key={lt} onClick={() => updateVerdict('HUMAN').then(() => {
                    adminFetch('/api/update-record', {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: record.id, listing_type: lt }),
                    });
                  })}
                    className={`px-3 py-1 text-[10px] font-medium rounded border transition-all ${
                      isActive ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}>
                    {lt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* All Fields */}
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Brand', key: 'brand' },
                { label: 'Reference', key: 'reference' },
                { label: 'Dial Color', key: 'dial_color' },
                { label: 'Condition', key: 'condition' },
                { label: 'Year', key: 'year', type: 'number' },
                { label: 'Price USD', key: 'price_usd', type: 'number' },
                { label: 'Confidence', key: 'confidence', type: 'number' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[10px] text-gray-500 uppercase">{f.label}</label>
                  <input type={f.type || 'text'} value={form[f.key as keyof typeof form] ?? ''} onChange={e => setForm({ ...form, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                    className="w-full mt-0.5 px-2.5 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 font-mono focus:border-amber-500/50 focus:outline-none" />
                </div>
              ))}
              <div>
                <label className="text-[10px] text-gray-500 uppercase">Verdict</label>
                <select value={form.verdict} onChange={e => setForm({ ...form, verdict: e.target.value })}
                  className="w-full mt-0.5 px-2.5 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 focus:border-amber-500/50 focus:outline-none">
                  {VERDICTS.filter(v => v).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase">Listing Type</label>
                <select value={form.listing_type} onChange={e => setForm({ ...form, listing_type: e.target.value })}
                  className="w-full mt-0.5 px-2.5 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 focus:border-amber-500/50 focus:outline-none">
                  {LISTING_TYPES.map(lt => <option key={lt || '_'} value={lt}>{lt || '—'}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
                <button onClick={saveEdit} disabled={saving}
                  className="px-4 py-1.5 text-xs font-medium bg-amber-500 text-black rounded hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {saved ? 'Saved!' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Brand" value={record.brand || '—'} />
              <Field label="Reference" value={record.reference || '—'} />
              <Field label="Dial" value={record.dial_color || '—'} />
              <Field label="Condition" value={record.condition || '—'} />
              <Field label="Year" value={record.year || '—'} />
              <Field label="Price" value={fmtPrice(record.price_usd)} />
              <Field label="Confidence" value={record.confidence != null ? `${record.confidence}%` : '—'} />
              <Field label="Listing Type" value={record.listing_type || '—'} />
              <Field label="Currency" value={record.currency || '—'} />
              <Field label="Source" value={record.source || '—'} />
              <Field label="Created" value={fmtDate(record.created_at)} />
              <Field label="Human Edited" value={record.human_edited ? 'Yes' : 'No'} />
            </div>
          )}
        </div>

        {/* Re-run Parser */}
        <div className="border-t border-gray-800 px-5 py-3 flex items-center justify-between">
          <button onClick={async () => {
            if (!record.raw_message) return;
            try {
              await fetch('/api/batch-parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [record.raw_message], id: record.id }),
              });
              // Re-fetch after a short delay
              setTimeout(onRefresh, 1500);
            } catch {}
          }} className="text-xs px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-500/20 flex items-center gap-1">
            <RefreshCw size={12} /> Re-run Parser
          </button>
          <a href={`/flash-sales/${record.id}`} target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 hover:text-white rounded flex items-center gap-1">
            <Eye size={12} /> View Trading Floor <ExternalLink size={10} />
          </a>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0A0A0F] rounded-lg p-2.5">
      <div className="text-[10px] text-gray-500 uppercase mb-0.5">{label}</div>
      <div className="text-xs font-medium text-gray-200">{value}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────
export default function AdminListingsBrowser() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editParam = searchParams.get('edit');
  const refParam = searchParams.get('ref');

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [total, setTotal] = useState(0);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/listings?limit=${PAGE_SIZE}&page=${page + 1}`;
      if (verdictFilter) url += `&verdict=${verdictFilter}`;
      if (search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;

      const res = await fetch(url);
      const data = await res.json();
      const rows = data.rows || [];
      setRecords(rows);
      setTotal(data.total || rows.length);

      // Auto-open if edit param or ref param
      if (editParam && rows.length > 0) {
        const found = rows.find((r: any) => r.id === editParam || r.id?.startsWith(editParam));
        if (found) setSelectedRecord(found);
      } else if (refParam && rows.length > 0) {
        const found = rows.find((r: any) => r.reference === refParam);
        if (found) setSelectedRecord(found);
      }
    } catch {}
    setLoading(false);
  }, [verdictFilter, search, page, editParam, refParam]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { setPage(0); }, [verdictFilter, search]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-gray-100">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-gray-800 px-4 md:px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-amber-400 shrink-0" />
            <h1 className="text-base font-semibold">All Listings Browser</h1>
            <span className="text-[11px] text-gray-500 font-mono">{total.toLocaleString()} records</span>
          </div>
          <button onClick={fetchRecords} className="p-1.5 text-gray-400 hover:text-white"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>

        {/* Verdict pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2 hide-scrollbar">
          {VERDICTS.map((v, i) => (
            <button key={v || 'ALL'} onClick={() => setVerdictFilter(v)}
              className={`px-3 py-1 text-[10px] font-medium rounded-full transition-all whitespace-nowrap ${
                verdictFilter === v
                  ? `${VERDICT_CONFIG[v]?.bg || 'bg-white/10'} text-white border ${VERDICT_CONFIG[v]?.border || 'border-white/20'}`
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`} style={verdictFilter === v && v ? { color: VERDICT_CONFIG[v].color } : {}}>
              {VERDICT_LABELS[i]}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search brand, reference, raw_message..." className="w-full pl-9 pr-3 py-1.5 bg-gray-900 border border-gray-800 rounded text-xs text-gray-200 placeholder-gray-600 focus:border-amber-500/50 focus:outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="px-4 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-amber-400" size={24} /></div>
        ) : records.length === 0 ? (
          <div className="text-center py-20 text-gray-500"><Database size={32} className="mx-auto mb-3 opacity-30" /><p className="text-sm">No records found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="py-2 px-2 text-left">Verdict</th>
                  <th className="py-2 px-2 text-left">Brand</th>
                  <th className="py-2 px-2 text-left">Reference</th>
                  <th className="py-2 px-2 text-left">Dial</th>
                  <th className="py-2 px-2 text-left">Cond.</th>
                  <th className="py-2 px-2 text-right">Price</th>
                  <th className="py-2 px-2 text-center">Conf</th>
                  <th className="py-2 px-2 text-left">Type</th>
                  <th className="py-2 px-2 text-left">Date</th>
                  <th className="py-2 px-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const vcfg = VERDICT_CONFIG[r.verdict] || VERDICT_CONFIG.REVIEW;
                  const swap = detectRefDialSwap(r);
                  return (
                    <tr key={r.id}
                      className={`border-b border-gray-900 hover:bg-gray-900/50 transition-colors cursor-pointer ${swap.swapped ? 'bg-red-500/5' : ''}`}
                      onClick={() => setSelectedRecord(r)}>
                      <td className="py-2 px-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${vcfg.bg} ${vcfg.border}`} style={{ color: vcfg.color }}>
                          {vcfg.label}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-gray-200 font-medium">{r.brand || '—'}</td>
                      <td className={`py-2 px-2 font-mono ${swap.swapped ? 'text-red-400' : 'text-gray-400'}`}>
                        {r.reference || '—'}
                        {swap.swapped && <AlertOctagon size={10} className="inline ml-1 text-red-400" />}
                      </td>
                      <td className={`py-2 px-2 ${swap.swapped ? 'text-red-400' : 'text-gray-400'}`}>{r.dial_color || '—'}</td>
                      <td className="py-2 px-2 text-gray-400">{r.condition || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{fmtPrice(r.price_usd)}</td>
                      <td className="py-2 px-2 text-center"><ConfBadge score={r.confidence} /></td>
                      <td className="py-2 px-2 text-gray-500 text-[10px]">{r.listing_type || '—'}</td>
                      <td className="py-2 px-2 text-gray-500 text-[10px]">{fmtDate(r.created_at)}</td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setSelectedRecord(r)} className="p-1 text-gray-600 hover:text-amber-400" title="View detail">
                            <Eye size={12} />
                          </button>
                          <button onClick={() => navigate(`/price-research?brand=${encodeURIComponent(r.brand || '')}&ref=${encodeURIComponent(r.reference || '')}`)}
                            className="p-1 text-gray-600 hover:text-blue-400" title="Price Research">
                            <TrendingUp size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="py-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">Page {page + 1}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30"><ChevronLeft size={14} /></button>
            <button onClick={() => setPage(page + 1)} disabled={records.length < PAGE_SIZE}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <DetailModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onRefresh={fetchRecords}
        />
      )}
    </div>
  );
}

function ConfBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-600">—</span>;
  const color = score >= 90 ? 'text-green-400' : score >= 70 ? 'text-blue-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  return <span className={`font-mono ${color}`}>{score}</span>;
}
