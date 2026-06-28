// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle, XCircle, AlertTriangle, RefreshCw,
  ChevronLeft, ChevronRight, Edit3, Save, X, Eye
} from 'lucide-react';
import WatchImage from '@/components/WatchImage';

type Verdict = 'APPROVED' | 'REVIEW' | 'HUMAN' | 'RECYCLE';

const VERDICT_CONFIG: Record<Verdict, { label: string; color: string; bg: string }> = {
  APPROVED: { label: 'APPROVED', color: '#22C55E', bg: 'bg-green-400/10' },
  REVIEW:   { label: 'REVIEW',   color: '#3B82F6', bg: 'bg-blue-400/10' },
  HUMAN:    { label: 'HUMAN',    color: '#F59E0B', bg: 'bg-yellow-400/10' },
  RECYCLE:  { label: 'RECYCLE',  color: '#EF4444', bg: 'bg-red-400/10' },
};

const TABS: { key: Verdict | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'HUMAN', label: 'HUMAN Review' },
  { key: 'RECYCLE', label: 'RECYCLE' },
  { key: 'REVIEW', label: 'REVIEW' },
  { key: 'APPROVED', label: 'APPROVED' },
];

export default function ReviewPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Verdict | 'ALL'>('HUMAN');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const verdictParam = activeTab === 'ALL' ? '' : `&verdict=${activeTab}`;
      const res = await fetch(`/api/listings?page=${page}&limit=20${verdictParam}`);
      const data = await res.json();
      setRecords(data.rows || []);
      setTotal(data.total || 0);
    } catch {
      // Demo data
      setRecords([
        { id: '1', brand: 'Rolex', reference: '126610LN', dialColor: 'Black', condition: 'New', year: 2024, price_usd: 14200, confidence: 55, verdict: 'HUMAN', raw_message: 'Rolex 126610LN black $14,200 N5 2024', source: 'whatsapp_group_1' },
        { id: '2', brand: 'Patek Philippe', reference: '5711/1A', dialColor: null, condition: null, year: null, price_usd: 185000, confidence: 45, verdict: 'HUMAN', raw_message: 'PP 5711 blue $185k', source: 'whatsapp_group_2' },
        { id: '3', brand: 'Audemars Piguet', reference: '15500ST', dialColor: 'Blue', condition: 'Used', year: 2022, price_usd: 32000, confidence: 58, verdict: 'HUMAN', raw_message: 'AP 15500ST blue used 2022 $32k', source: 'whatsapp_group_3' },
        { id: '4', brand: 'Richard Mille', reference: 'RM11-03', dialColor: null, condition: 'New', year: 2024, price_usd: 385000, confidence: 40, verdict: 'RECYCLE', raw_message: 'WTB RM11-03 cheap', source: 'whatsapp_group_4' },
        { id: '5', brand: 'Omega', reference: '310.30.42.50.01.001', dialColor: 'Black', condition: 'New', year: 2024, price_usd: 7800, confidence: 35, verdict: 'RECYCLE', raw_message: 'omega speedmaster new $7800', source: 'whatsapp_group_5' },
      ]);
      setTotal(5);
    }
    setLoading(false);
  }, [activeTab, page]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const startEdit = (record: any) => {
    setEditingId(record.id);
    setEditForm({ ...record });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    try {
      const res = await fetch('/api/update-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...editForm }),
      });
      const result = await res.json();
      if (result.success) {
        setActionLog(prev => [`Updated ${editForm.brand} ${editForm.reference} — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
        setEditingId(null);
        fetchRecords();
      }
    } catch {
      // Local update for demo
      setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...editForm } : r));
      setActionLog(prev => [`Updated ${editForm.brand} ${editForm.reference} — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
      setEditingId(null);
    }
  };

  const changeVerdict = async (id: string, newVerdict: Verdict) => {
    try {
      await fetch('/api/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], action: newVerdict.toLowerCase() }),
      });
    } catch {}
    setRecords(prev => prev.map(r => r.id === id ? { ...r, verdict: newVerdict } : r));
    setActionLog(prev => [`Changed verdict to ${newVerdict} — ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 20));
  };

  const confidenceColor = (c: number) => {
    if (c >= 85) return '#22C55E';
    if (c >= 70) return '#F59E0B';
    if (c >= 50) return '#F97316';
    return '#EF4444';
  };

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
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{record.brand}</span>
                          <span className="text-xs font-mono text-[#D4AF37]">{record.reference}</span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: cfg.color, backgroundColor: cfg.color + '15' }}
                          >
                            {cfg.label}
                          </span>
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
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
                              value={editForm.dialColor || ''}
                              onChange={e => setEditForm({ ...editForm, dialColor: e.target.value })}
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
                              <option value="Used">Used</option>
                              <option value="Like New">Like New</option>
                              <option value="Pre-owned">Pre-owned</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Year</label>
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
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="text-[10px] text-gray-500 font-mono truncate max-w-md">
                            RAW: {editForm.raw_message}
                          </div>
                          <button
                            onClick={saveEdit}
                            className="px-4 py-1.5 bg-[#D4AF37] hover:bg-[#E5C158] text-black text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5"
                          >
                            <Save size={12} /> Save Changes
                          </button>
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
      </div>
    </div>
  );
}
