// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle, XCircle, AlertTriangle, RefreshCw,
  ChevronLeft, ChevronRight, Edit3, Save, X, Eye, Sparkles,
  Copy, Calendar, Search, Tag, Keyboard
} from 'lucide-react';
import { AISuggestionPanel } from '@/components/AISuggestionPanel';
import { resolveWatchImage } from '@/lib/imageResolver';
import WatchImage from '@/components/WatchImage';

// ─── Direct Supabase connection ──────────────────────────────────────
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

type Verdict = 'APPROVED' | 'REVIEW' | 'HUMAN' | 'RECYCLE';

const VERDICT_CONFIG: Record<Verdict, { label: string; color: string; bg: string }> = {
  APPROVED: { label: 'APPROVED', color: '#22C55E', bg: 'bg-green-400/10' },
  REVIEW:   { label: 'REVIEW',   color: '#3B82F6', bg: 'bg-blue-400/10' },
  HUMAN:    { label: 'HUMAN',    color: '#F59E0B', bg: 'bg-yellow-400/10' },
  RECYCLE:  { label: 'RECYCLE',  color: '#EF4444', bg: 'bg-red-400/10' },
};

const TABS: { key: Verdict | 'ALL' | 'WTB'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'HUMAN', label: 'HUMAN Review' },
  { key: 'WTB', label: 'WTB / NTQ' },
  { key: 'RECYCLE', label: 'RECYCLE' },
  { key: 'REVIEW', label: 'REVIEW' },
  { key: 'APPROVED', label: 'APPROVED' },
];

// ─── Year detection from raw message ─────────────────────────────────
function detectYear(raw: string | null): number | null {
  if (!raw) return null;
  const patterns = [
    /(\d{4})\s*y/i,        // "2019 y" or "2019y"
    /\b(19\d{2}|20\d{2})\b/, // standalone 4-digit year
    /year\s*:?\s*(\d{4})/i,  // "year: 2019"
    /y\s*:?\s*(\d{4})/i,     // "y: 2019"
    /\((\d{4})\)/,            // "(2019)"
    /'(\d{2})\b/,             // "'19"
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) {
      let year = parseInt(m[1]);
      if (year < 100) year += 2000; // '19 → 2019
      if (year >= 1900 && year <= 2030) return year;
    }
  }
  return null;
}

// ─── Enhanced WTB detection (Phase 5) ────────────────────────────────
function detectWTB(raw: string | null): boolean {
  if (!raw || raw.length < 3) return false;
  const lower = raw.toLowerCase();

  // 25+ WTB indicator terms
  const wtbTerms = [
    'wtb', 'want to buy', 'wanting to buy',
    'looking for', 'lookin for', 'lookin 4',
    'iso ', 'in search of',
    'ntq', 'need to buy', 'need to find',
    'buying', 'searching for', 'search for',
    'lf ', 'l.f.', 'l f ',
    'wanted', 'wtbuy',
    'help me find', 'trying to find',
    'anyone selling', 'anyone has',
    'where can i buy', 'where to buy',
  ];
  // Selling indicators (negative signal)
  const sellTerms = [
    'wts', 'want to sell', 'selling', 'for sale',
    'fs:', 'f/s', 'price is', 'asking', 'obo',
    'trade', 'trading', 'up for grabs',
  ];

  const hasWTB = wtbTerms.some(t => lower.includes(t));
  const hasSell = sellTerms.some(t => lower.includes(t));

  // Has WTB terms and no selling terms → WTB
  if (hasWTB && !hasSell) return true;

  // Secondary: no price + has reference + brand-like word = likely WTB
  if (!hasSell && !/\$\d/.test(raw) && !/\b\d{3,}[^\d]*(?:usd|eur|gbp|chf)/i.test(raw)) {
    if (/\b\d{5,6}\b/.test(raw) && /\b(rolex|patek|ap|audemars|omega|cartier)/i.test(raw)) {
      return true;
    }
  }
  return false;
}

// ─── Enhanced bundle detection (Phase 5) ─────────────────────────────
function detectBundle(raw: string | null): { isBundle: boolean; count: number; refs: string[] } {
  if (!raw) return { isBundle: false, count: 0, refs: [] };
  const refMatches = raw.match(/\b\d{5,6}\b/g);
  if (!refMatches) return { isBundle: false, count: 0, refs: [] };
  const uniqueRefs = [...new Set(refMatches)];
  return { isBundle: uniqueRefs.length > 1, count: uniqueRefs.length, refs: uniqueRefs };
}

export default function ReviewPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Verdict | 'ALL' | 'WTB'>('HUMAN');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [showCopied, setShowCopied] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Fetch from Supabase directly ──────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * 20;
      let url = `${SUPABASE_URL}/rest/v1/watch_records?select=*&limit=20&offset=${offset}`;

      if (activeTab === 'WTB') {
        const wtbTerms = ['wtb','want to buy','looking for','iso ','in search of','ntq'];
        url += `&or=(${wtbTerms.map(t => `raw_message.ilike.*${encodeURIComponent(t)}*`).join(',')})`;
      } else if (activeTab !== 'ALL') {
        url += `&verdict=eq.${activeTab}`;
      }

      const res = await fetch(url, { headers: REQ_HEADERS });
      const data = await res.json();
      setRecords(data || []);
      setTotal(data?.length || 0);
    } catch {
      setRecords([]);
      setTotal(0);
    }
    setLoading(false);
  }, [activeTab, page]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // ─── Auto-detect year when opening edit ────────────────────────────
  const startEdit = (record: any) => {
    const detectedYear = detectYear(record.raw_message);
    setEditingId(record.id);
    setEditForm({
      ...record,
      year: record.year || detectedYear || '',
    });
    if (detectedYear && !record.year) {
      setActionLog(prev => [`Auto-detected year ${detectedYear} from message — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // ─── Save edit ─────────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const updateData: any = {
        brand: editForm.brand || null,
        reference: editForm.reference || null,
        dial_color: editForm.dial_color || editForm.dialColor || null,
        condition: editForm.condition || null,
        year: editForm.year || null,
        price_usd: editForm.price_usd || null,
        confidence: editForm.confidence || 0,
        verdict: editForm.verdict || 'HUMAN',
        human_edited: true,
        edit_source: 'review_inline_edit',
      };

      await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${editingId}`,
        {
          method: 'PATCH',
          headers: REQ_HEADERS,
          body: JSON.stringify(updateData),
        }
      );
      setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...updateData } : r));
      setActionLog(prev => [`Saved changes to ${editForm.reference || 'record'} — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
    } catch {
      setActionLog(prev => [`Save failed — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
    }
    setEditingId(null);
    setEditForm({});
  };

  // ─── Change verdict ────────────────────────────────────────────────
  const changeVerdict = async (id: string, newVerdict: Verdict) => {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${id}`,
        {
          method: 'PATCH',
          headers: REQ_HEADERS,
          body: JSON.stringify({ verdict: newVerdict, human_edited: true, edit_source: 'review_verdict_change' }),
        }
      );
    } catch {}
    setRecords(prev => prev.map(r => r.id === id ? { ...r, verdict: newVerdict } : r));
    setActionLog(prev => [`Changed verdict to ${newVerdict} — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
  };

  // ─── Copy/Split listing ────────────────────────────────────────────
  const copyListing = async (record: any) => {
    try {
      const newRecord = {
        ...record,
        id: undefined, // Let Supabase generate new ID
        raw_message: record.raw_message + ' [copy]',
        human_edited: true,
        edit_source: 'review_copy_split',
        created_at: new Date().toISOString(),
      };
      delete newRecord.id;

      const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
        method: 'POST',
        headers: REQ_HEADERS,
        body: JSON.stringify(newRecord),
      });
      if (res.ok) {
        setActionLog(prev => [`Created copy of ${record.reference} — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
        setShowCopied(record.id);
        setTimeout(() => setShowCopied(null), 2000);
        fetchRecords();
      }
    } catch {
      setActionLog(prev => [`Copy failed — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
    }
  };

  const confidenceColor = (c: number) => {
    if (c >= 85) return '#22C55E';
    if (c >= 70) return '#F59E0B';
    if (c >= 50) return '#F97316';
    return '#EF4444';
  };

  // ─── Toast notification ────────────────────────────────────────────
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, key: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), 1500);
  }, []);

  // ─── Keyboard shortcuts ────────────────────────────────────────────
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // Only allow Escape and Enter when in an input field
      if (editingId && (event.key === 'Escape' || event.key === 'Enter')) {
        event.preventDefault();
        if (event.key === 'Escape') {
          cancelEdit();
          showToast('Edit cancelled');
        } else {
          saveEdit();
          showToast('Changes saved');
        }
      }
      return;
    }

    const currentRecord = records[0];
    if (!currentRecord && !editingId) return;

    switch (event.key.toUpperCase()) {
      case 'A':
        if (editingId) return;
        if (!currentRecord) return;
        event.preventDefault();
        changeVerdict(currentRecord.id, 'APPROVED');
        showToast(`Approved ${currentRecord.reference || 'record'}`);
        break;
      case 'R':
        if (editingId) return;
        if (!currentRecord) return;
        event.preventDefault();
        changeVerdict(currentRecord.id, 'RECYCLE');
        showToast(`Recycled ${currentRecord.reference || 'record'}`);
        break;
      case 'E':
        event.preventDefault();
        if (editingId) {
          cancelEdit();
          showToast('Edit cancelled');
        } else if (currentRecord) {
          startEdit(currentRecord);
          showToast(`Editing ${currentRecord.reference || 'record'}`);
        }
        break;
      case 'N':
      case 'S':
        if (editingId) return;
        event.preventDefault();
        setPage(p => p + 1);
        showToast('Skipped to next record');
        break;
      default:
        if (event.key === 'Escape' && editingId) {
          event.preventDefault();
          cancelEdit();
          showToast('Edit cancelled');
        }
        break;
    }
  }, [editingId, records, showToast, startEdit, cancelEdit, saveEdit, changeVerdict]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="min-h-[calc(100dvh-104px)] bg-[#0A0A0F] p-4">
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Review Queue</h1>
          <div className="text-xs text-gray-500">{total.toLocaleString()} listings</div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 overflow-x-auto">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setPage(1); }}
              className={`px-3 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeTab === key
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                  : 'text-gray-400 hover:text-white hover:bg-[#1A1A24] border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Action Log */}
        {actionLog.length > 0 && (
          <div className="mb-4 bg-[#111118] border border-[#1E1E2E] rounded-lg p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Recent Actions</h3>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {actionLog.map((log, i) => (
                <div key={i} className="text-[10px] text-gray-400 font-mono">{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Records Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : (
          <>
            <div className="space-y-2">
              {records.map((record) => {
                const isEditing = editingId === record.id;
                const cfg = VERDICT_CONFIG[record.verdict as Verdict] || VERDICT_CONFIG.HUMAN;
                const isWTB = detectWTB(record.raw_message);
                const detectedYear = detectYear(record.raw_message);
                const bundle = detectBundle(record.raw_message);

                return (
                  <motion.div
                    key={record.id}
                    layout
                    className="bg-[#111118] border border-[#1E1E2E] rounded-lg overflow-hidden"
                  >
                    {/* Main Row */}
                    <div className="flex items-center gap-3 p-3">
                      {/* Image */}
                      <div className="w-12 h-12 flex-shrink-0">
                        <WatchImage
                          brand={record.brand}
                          reference={record.reference}
                          className="w-12 h-12"
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white">{record.brand}</span>
                          <span className="text-xs font-mono text-[#D4AF37]">{record.reference}</span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: cfg.color, backgroundColor: cfg.color + '15' }}
                          >
                            {cfg.label}
                          </span>
                          {isWTB && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-400/10 text-purple-400">
                              WTB
                            </span>
                          )}
                          {bundle.isBundle && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-orange-400/10 text-orange-400" title={`${bundle.count} watches detected`}>
                              BUNDLE ({bundle.count})
                            </span>
                          )}
                          {detectedYear && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-400/10 text-blue-400 flex items-center gap-1">
                              <Calendar size={9} /> {detectedYear}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 truncate">
                          {record.raw_message}
                        </div>
                      </div>

                      {/* Confidence */}
                      <div className="flex-shrink-0 w-16 text-center">
                        <div className="text-xs font-bold font-mono" style={{ color: confidenceColor(record.confidence || 0) }}>
                          {record.confidence || 0}%
                        </div>
                        <div className="h-1 bg-[#1E1E2E] rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${record.confidence || 0}%`,
                              backgroundColor: confidenceColor(record.confidence || 0),
                            }}
                          />
                        </div>
                      </div>

                      {/* Price */}
                      <div className="flex-shrink-0 text-right w-20">
                        <div className="text-xs font-bold text-white font-mono">
                          ${record.price_usd?.toLocaleString() || '—'}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex-shrink-0 flex gap-1">
                        <button
                          onClick={() => copyListing(record)}
                          className="p-1.5 rounded hover:bg-blue-400/10 text-gray-400 hover:text-blue-400 transition-colors relative"
                          title="Copy/Split listing"
                        >
                          <Copy size={14} />
                          {showCopied === record.id && (
                            <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] bg-green-500 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
                              Copied!
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => isEditing ? cancelEdit() : startEdit(record)}
                          className="p-1.5 rounded hover:bg-[#1E1E2E] text-gray-400 hover:text-white transition-colors"
                          title={isEditing ? 'Cancel' : 'Edit'}
                        >
                          {isEditing ? <X size={14} /> : <Edit3 size={14} />}
                        </button>
                        {!isEditing && (
                          <>
                            <button
                              onClick={() => changeVerdict(record.id, 'APPROVED')}
                              className="p-1.5 rounded hover:bg-green-400/10 text-gray-400 hover:text-green-400 transition-colors"
                              title="Approve"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button
                              onClick={() => changeVerdict(record.id, 'RECYCLE')}
                              className="p-1.5 rounded hover:bg-red-400/10 text-gray-400 hover:text-red-400 transition-colors"
                              title="Recycle"
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Inline Edit Form */}
                    {isEditing && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="border-t border-[#1E1E2E] bg-[#0A0A0F] p-3"
                      >
                        {/* AI Suggestions for this record */}
                        <AISuggestionPanel
                          record={record}
                          onApply={(field, value) => setEditForm((prev: any) => ({ ...prev, [field]: value }))}
                        />

                        {/* Auto-detected fields banner */}
                        {(detectedYear || isWTB || bundle.isBundle) && (
                          <div className="mb-3 mt-3 flex gap-2 flex-wrap">
                            {detectedYear && (
                              <span className="text-[10px] px-2 py-1 bg-blue-400/10 text-blue-400 rounded flex items-center gap-1">
                                <Calendar size={10} /> Year detected: {detectedYear}
                              </span>
                            )}
                            {isWTB && (
                              <span className="text-[10px] px-2 py-1 bg-purple-400/10 text-purple-400 rounded flex items-center gap-1">
                                <Tag size={10} /> WTB detected
                              </span>
                            )}
                            {bundle.isBundle && (
                              <span className="text-[10px] px-2 py-1 bg-orange-400/10 text-orange-400 rounded flex items-center gap-1">
                                <Copy size={10} /> Bundle: {bundle.count} watches
                              </span>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 mt-3">
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Brand</label>
                            <input
                              value={editForm.brand || ''}
                              onChange={e => setEditForm({ ...editForm, brand: e.target.value })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white focus:border-[#D4AF37] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Reference</label>
                            <input
                              value={editForm.reference || ''}
                              onChange={e => setEditForm({ ...editForm, reference: e.target.value })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white font-mono focus:border-[#D4AF37] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Dial Color</label>
                            <input
                              value={editForm.dial_color || editForm.dialColor || ''}
                              onChange={e => setEditForm({ ...editForm, dial_color: e.target.value })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white focus:border-[#D4AF37] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Condition</label>
                            <select
                              value={editForm.condition || ''}
                              onChange={e => setEditForm({ ...editForm, condition: e.target.value })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white focus:border-[#D4AF37] outline-none"
                            >
                              <option value="">Select</option>
                              <option value="New">New</option>
                              <option value="N1">N1</option>
                              <option value="N2">N2</option>
                              <option value="N3">N3</option>
                              <option value="N4">N4</option>
                              <option value="N5">N5</option>
                              <option value="N6">N6</option>
                              <option value="N7">N7</option>
                              <option value="N8">N8</option>
                              <option value="N9">N9</option>
                              <option value="Used">Used</option>
                              <option value="Pre-owned">Pre-owned</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">
                              Year {detectedYear && !editForm.year && (
                                <button onClick={() => setEditForm({ ...editForm, year: detectedYear })}
                                  className="text-blue-400 hover:text-blue-300 ml-1">[Auto: {detectedYear}]</button>
                              )}
                            </label>
                            <input
                              type="number"
                              value={editForm.year || ''}
                              onChange={e => setEditForm({ ...editForm, year: parseInt(e.target.value) })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white font-mono focus:border-[#D4AF37] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Price USD</label>
                            <input
                              type="number"
                              value={editForm.price_usd || ''}
                              onChange={e => setEditForm({ ...editForm, price_usd: parseInt(e.target.value) })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white font-mono focus:border-[#D4AF37] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Confidence</label>
                            <input
                              type="number"
                              min="0" max="100"
                              value={editForm.confidence || ''}
                              onChange={e => setEditForm({ ...editForm, confidence: parseInt(e.target.value) })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white font-mono focus:border-[#D4AF37] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Verdict</label>
                            <select
                              value={editForm.verdict || ''}
                              onChange={e => setEditForm({ ...editForm, verdict: e.target.value })}
                              className="w-full bg-[#1A1A24] border border-[#1E1E2E] rounded px-2 py-1 text-xs text-white focus:border-[#D4AF37] outline-none"
                            >
                              <option value="APPROVED">APPROVED</option>
                              <option value="REVIEW">REVIEW</option>
                              <option value="HUMAN">HUMAN</option>
                              <option value="RECYCLE">RECYCLE</option>
                              <option value="WTB">WTB</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="text-[10px] text-gray-500 font-mono truncate max-w-md">
                            RAW: {editForm.raw_message}
                          </div>
                          <div className="flex gap-2">
                            {bundle.isBundle && (
                              <button
                                onClick={() => copyListing(record)}
                                className="px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-xs font-medium rounded flex items-center gap-1.5"
                              >
                                <Copy size={12} /> Split Copy
                              </button>
                            )}
                            <button
                              onClick={saveEdit}
                              className="px-4 py-1.5 bg-[#D4AF37] hover:bg-[#E5C158] text-black text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5"
                            >
                              <Save size={12} /> Save Changes
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 bg-[#1A1A24] border border-[#1E1E2E] rounded text-xs text-gray-400 hover:text-white disabled:opacity-30 flex items-center gap-1"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <span className="text-xs text-gray-500 font-mono">Page {page}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 bg-[#1A1A24] border border-[#1E1E2E] rounded text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </>
        )}

        {/* ─── Keyboard Shortcuts Help Panel ─────────────────────────── */}
        <div className="mt-6 border-t border-[#1E1E2E] pt-3">
          <button
            onClick={() => setShowShortcuts(v => !v)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-300 transition-colors text-[11px] mb-2"
          >
            <Keyboard size={13} />
            <span className="font-medium">Keyboard Shortcuts</span>
            <span className="text-gray-600 ml-1">{showShortcuts ? '▲' : '▼'}</span>
          </button>
          <AnimatePresence>
            {showShortcuts && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] text-gray-400 pb-2">
                  {[
                    { key: 'A', action: 'Approve current record' },
                    { key: 'R', action: 'Recycle current record' },
                    { key: 'E', action: 'Toggle edit mode' },
                    { key: 'N / S', action: 'Skip to next record' },
                    { key: 'Escape', action: 'Cancel edit' },
                    { key: 'Enter', action: 'Save edit' },
                  ].map(({ key, action }) => (
                    <div key={key} className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 bg-[#1A1A24] border border-[#2A2A3A] rounded text-[10px] font-mono text-gray-300 min-w-[28px] text-center">
                        {key}
                      </kbd>
                      <span>{action}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── Toast Notification ─────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            initial={{ opacity: 0, y: 20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 20, x: 20 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-4 right-4 z-50"
          >
            <div className="bg-[#1A1A24] border border-[#D4AF37]/40 text-white text-xs px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
              <Sparkles size={13} className="text-[#D4AF37]" />
              <span>{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
