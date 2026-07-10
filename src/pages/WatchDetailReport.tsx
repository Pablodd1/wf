/**
 * WatchDetailReport — Individual Watch Record Report
 * ===================================================
 * Shows complete details for a single watch record:
 * - Raw description (original message)
 * - Parsed/normalized data (brand, reference, dial, condition, year)
 * - Price data (original currency + USD conversion)
 * - Verdict & confidence score
 * - Human review status
 * - Outlier detection
 * - Data quality flags
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/hooks/useAuth';
import {
  ArrowLeft, Eye, CheckCircle, XCircle, Clock, AlertTriangle,
  DollarSign, TrendingUp, TrendingDown, Activity, ShieldCheck,
  FileText, Hash, Palette, Calendar, Gauge, RefreshCw,
  Trash2, UserCheck, Bot, AlertOctagon, Save, Loader2,
  Edit3, ExternalLink, Sparkles, ArrowUpDown,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { SUPABASE_URL, REQ_HEADERS } from '@/lib/supabaseConfig';

interface WatchRecord {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  year: number | null;
  price_raw: string;
  price_usd: number;
  currency: string;
  confidence: number;
  verdict: string;
  source: string;
  raw_message: string;
  flags: Record<string, any>;
  human_edited: boolean;
  reprocessed_at: string | null;
  created_at: string;
}

function fmtPrice(n: number): string {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(d: string | null): string {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString();
}

function getVerdictConfig(verdict: string) {
  const configs: Record<string, { color: string; bg: string; icon: any; label: string }> = {
    APPROVED: { color: 'text-green-400', bg: 'bg-green-400/10', icon: CheckCircle, label: 'Approved' },
    REVIEW: { color: 'text-blue-400', bg: 'bg-blue-400/10', icon: Clock, label: 'In Review' },
    HUMAN: { color: 'text-amber-400', bg: 'bg-amber-400/10', icon: UserCheck, label: 'Human Review' },
    RECYCLE: { color: 'text-red-400', bg: 'bg-red-400/10', icon: Trash2, label: 'Recycled' },
  };
  return configs[verdict] || { color: 'text-gray-400', bg: 'bg-gray-400/10', icon: AlertOctagon, label: verdict };
}

function getConfidenceColor(score: number): string {
  if (score >= 90) return 'text-green-400';
  if (score >= 70) return 'text-blue-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function getConfidenceLabel(score: number): string {
  if (score >= 90) return 'High Confidence';
  if (score >= 70) return 'Good Confidence';
  if (score >= 50) return 'Moderate Confidence';
  return 'Low Confidence - Review Needed';
}

export default function WatchDetailReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<WatchRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [priceStats, setPriceStats] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [editForm, setEditForm] = useState({
    brand: '',
    reference: '',
    dial_color: '',
    condition: '',
    year: null as number | null,
    price_usd: 0,
    verdict: 'REVIEW',
    confidence: 0,
  });

  // Initialize editForm when record loads
  useEffect(() => {
    if (record) {
      setEditForm({
        brand: record.brand || '',
        reference: record.reference || '',
        dial_color: record.dial_color || '',
        condition: record.condition || '',
        year: record.year,
        price_usd: record.price_usd || 0,
        verdict: record.verdict || 'REVIEW',
        confidence: record.confidence || 0,
      });
    }
  }, [record?.id]);

  useEffect(() => {
    if (!id) return;
    loadRecord(id);
  }, [id]);

  const loadRecord = async (recordId: string) => {
    setLoading(true);
    setError('');
    try {
      // Fetch record and price stats via API proxy
      const res = await fetch(`/api/watch-detail-report?recordId=${recordId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (!data.record) {
        setError('Record not found');
        setLoading(false);
        return;
      }
      
      setRecord(data.record);
      
      if (data.priceStats) {
        setPriceStats(data.priceStats);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  // ─── Reference/Dial swap detection helpers ─────────────────────────────
  const KNOWN_COLORS = new Set([
    'Black','White','Blue','Green','Silver','Gold','Champagne','Grey','Gray',
    'Red','Brown','Purple','Orange','Yellow','Pink','Ivory','Tiffany','Salmon',
    'Skeleton','MOP','Mother Of Pearl','Opaline','Burgundy','Chocolate','Navy',
  ]);

  function looksLikeColor(val: string): boolean {
    if (!val) return false;
    return KNOWN_COLORS.has(val) || KNOWN_COLORS.has(val.charAt(0).toUpperCase() + val.slice(1).toLowerCase());
  }

  function looksLikeRef(val: string): boolean {
    if (!val || val.length < 4) return false;
    return /^\d{5,8}$/.test(val) || /^\d{5,6}[A-Z]{2,4}$/i.test(val)
      || /^\d{4,5}\/\d{1,2}[A-Za-z]?$/.test(val) || /^\d{5}[A-Z]{2,4}$/i.test(val)
      || /^RM\d{2,4}/i.test(val);
  }

  function handleSwapRefDial() {
    const newDial = record?.reference || editForm.reference;
    const newRef = record?.dial_color || editForm.dial_color;
    setEditForm(f => ({ ...f, reference: newRef, dial_color: newDial }));
  }

  // ─── Save edited fields ────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!record) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/update-record', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session?.access_token ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ id: record.id, ...editForm }),
      });
      setEditing(false);
      loadRecord(record.id);
    } catch {}
    setSaving(false);
  };

  // ─── Re-run parser ─────────────────────────────────────────────────────
  const reparseRecord = async () => {
    if (!record?.raw_message) return;
    setReparsing(true);
    try {
      const res = await fetch('/api/batch-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [record.raw_message], id: record.id }),
      });
      if (res.ok) {
        setTimeout(() => { if (record) loadRecord(record.id); }, 1500);
      }
    } catch {}
    setTimeout(() => setReparsing(false), 2000);
  };

  // ─── AI review assist modal ────────────────────────────────────────────
  const triggerAiReview = () => {
    if (record) navigate(`/admin/reports?ai=${record.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={32} className="text-[#D4AF37] animate-spin" />
          <p className="text-gray-400 text-sm">Loading watch record...</p>
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" />
          <p className="text-white text-lg">{error || 'Record not found'}</p>
          <button
            onClick={() => navigate('/admin/reports')}
            className="mt-4 px-4 py-2 bg-[#D4AF37] text-black rounded-lg text-sm font-medium"
          >
            Back to Reports
          </button>
        </div>
      </div>
    );
  }

  const verdictConfig = getVerdictConfig(record.verdict);
  const VerdictIcon = verdictConfig.icon;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <div className="border-b border-[#1E1E2E] bg-[#111118]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/admin/reports')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft size={16} /> Back to Reports
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">ID: {record.id.slice(0, 8)}...</span>
            <span className={`px-2 py-1 rounded text-xs font-medium ${verdictConfig.bg} ${verdictConfig.color}`}>
              <VerdictIcon size={12} className="inline mr-1" />
              {verdictConfig.label}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Watch Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-white mb-2">
            {record.brand} {record.reference}
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-1">
              <Calendar size={14} /> {fmtDate(record.created_at)}
            </span>
            <span className="flex items-center gap-1">
              <Hash size={14} /> {record.source}
            </span>
            {record.human_edited && (
              <span className="flex items-center gap-1 text-amber-400">
                <UserCheck size={14} /> Human Edited
              </span>
            )}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Parsed Data */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2 space-y-6"
          >
            {/* Raw Description Card */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1E1E2E] flex items-center gap-2">
                <FileText size={16} className="text-[#D4AF37]" />
                <h3 className="text-sm font-semibold text-gray-300">Raw Description</h3>
              </div>
              <div className="p-5">
                <div className="bg-[#0A0A0F] rounded-lg p-4 font-mono text-sm text-gray-300 whitespace-pre-wrap break-words">
                  {record.raw_message || 'No raw message available'}
                </div>
              </div>
            </div>

            {/* Parsed Data Card */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1E1E2E] flex items-center gap-2">
                <Bot size={16} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-gray-300">Normalized Data</h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <DataField label="Brand" value={record.brand} icon={Hash} />
                  <DataField label="Reference" value={record.reference} icon={Hash} />
                  <DataField label="Dial Color" value={record.dial_color} icon={Palette} />
                  <DataField label="Condition" value={record.condition} icon={Gauge} />
                  <DataField label="Year" value={record.year?.toString() || 'N/A'} icon={Calendar} />
                  <DataField label="Currency" value={record.currency || 'N/A'} icon={DollarSign} />
                </div>
              </div>
            </div>

            {/* Price Analysis Card */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1E1E2E] flex items-center gap-2">
                <DollarSign size={16} className="text-green-400" />
                <h3 className="text-sm font-semibold text-gray-300">Price Analysis</h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <PriceCard label="Original Price" value={record.price_raw || 'N/A'} color="text-gray-300" />
                  <PriceCard label="Price (USD)" value={fmtPrice(record.price_usd)} color="text-green-400" />
                  <PriceCard label="Market Average" value={priceStats ? fmtPrice(priceStats.avg) : 'N/A'} color="text-blue-400" />
                  <PriceCard label="Market Median" value={priceStats ? fmtPrice(priceStats.median) : 'N/A'} color="text-[#D4AF37]" />
                </div>

                {priceStats && (
                  <div className="bg-[#0A0A0F] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity size={14} className="text-[#D4AF37]" />
                      <span className="text-sm font-medium text-gray-300">Outlier Detection</span>
                      {priceStats.isOutlier ? (
                        <span className="px-2 py-0.5 bg-red-400/10 text-red-400 rounded text-xs font-medium flex items-center gap-1">
                          <AlertTriangle size={10} /> OUTLIER DETECTED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-green-400/10 text-green-400 rounded text-xs font-medium flex items-center gap-1">
                          <CheckCircle size={10} /> Within Normal Range
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Q1 (25th %)</div>
                        <div className="font-mono text-gray-300">{fmtPrice(priceStats.q1)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Q3 (75th %)</div>
                        <div className="font-mono text-gray-300">{fmtPrice(priceStats.q3)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">IQR</div>
                        <div className="font-mono text-gray-300">{fmtPrice(priceStats.iqr)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Comparisons</div>
                        <div className="font-mono text-gray-300">{priceStats.totalComparisons} records</div>
                      </div>
                    </div>
                    {priceStats.isOutlier && (
                      <div className="mt-3 p-3 bg-red-400/5 border border-red-400/20 rounded-lg">
                        <p className="text-sm text-red-400">
                          <AlertTriangle size={14} className="inline mr-1" />
                          This listing's price of {fmtPrice(record.price_usd)} is outside the normal range 
                          ({fmtPrice(priceStats.outlierLow)} - {fmtPrice(priceStats.outlierHigh)}). 
                          It may be an error, a special edition, or a market anomaly.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Right Column: Quality & Verdict */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            {/* Verdict Card */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1E1E2E]">
                <h3 className="text-sm font-semibold text-gray-300">Verdict Status</h3>
              </div>
              <div className="p-5">
                <div className={`p-4 rounded-lg ${verdictConfig.bg} mb-4`}>
                  <div className="flex items-center gap-3">
                    <VerdictIcon size={24} className={verdictConfig.color} />
                    <div>
                      <div className={`text-lg font-bold ${verdictConfig.color}`}>{verdictConfig.label}</div>
                      <div className="text-xs text-gray-400">Current Status</div>
                    </div>
                  </div>
                </div>

                {/* Confidence Score */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">Confidence Score</span>
                    <span className={`text-sm font-bold ${getConfidenceColor(record.confidence)}`}>
                      {record.confidence}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${record.confidence}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className={`h-full rounded-full ${
                        record.confidence >= 90 ? 'bg-green-400' :
                        record.confidence >= 70 ? 'bg-blue-400' :
                        record.confidence >= 50 ? 'bg-amber-400' : 'bg-red-400'
                      }`}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{getConfidenceLabel(record.confidence)}</p>
                </div>

                {/* Human Review Status */}
                <div className="flex items-center gap-2 p-3 bg-[#0A0A0F] rounded-lg">
                  {record.human_edited ? (
                    <>
                      <UserCheck size={16} className="text-amber-400" />
                      <span className="text-sm text-amber-400">Human Reviewed & Edited</span>
                    </>
                  ) : (
                    <>
                      <Bot size={16} className="text-blue-400" />
                      <span className="text-sm text-blue-400">AI Parsed Only</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Data Quality Flags */}
            {record.flags && Object.keys(record.flags).length > 0 && (
              <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1E1E2E]">
                  <h3 className="text-sm font-semibold text-gray-300">Data Quality Flags</h3>
                </div>
                <div className="p-5">
                  <div className="space-y-2">
                    {Object.entries(record.flags).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between p-2 bg-[#0A0A0F] rounded-lg">
                        <span className="text-sm text-gray-400">{key}</span>
                        <span className="text-sm text-gray-300 font-mono">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Processing History */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1E1E2E]">
                <h3 className="text-sm font-semibold text-gray-300">Processing History</h3>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Created</span>
                  <span className="text-sm text-gray-300">{fmtDate(record.created_at)}</span>
                </div>
                {record.reprocessed_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Last Reprocessed</span>
                    <span className="text-sm text-gray-300">{fmtDate(record.reprocessed_at)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Source</span>
                  <span className="text-sm text-gray-300">{record.source}</span>
                </div>
              </div>
            </div>

            {/* Reference/Dial Swap Detection */}
            {(record.dial_color && looksLikeRef(record.dial_color)) ||
             (record.reference && looksLikeColor(record.reference)) ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertOctagon size={16} className="text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-red-400 mb-1">Reference/Dial Data Swap Suspected</div>
                    <div className="text-[11px] text-red-300/80 mb-2">
                      {record.reference && looksLikeColor(record.reference)
                        ? `Reference "${record.reference}" looks like a dial color name`
                        : `Dial "${record.dial_color}" looks like a reference number`}
                    </div>
                    <button
                      onClick={() => handleSwapRefDial()}
                      className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors"
                    >
                      <ArrowUpDown size={12} /> Swap Reference ↔ Dial
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Actions */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="p-5 space-y-2">
                <button
                  onClick={() => setEditing(true)}
                  className="w-full px-4 py-2 bg-[#D4AF37] hover:bg-[#E5C158] text-black rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <Edit3 size={14} /> {editing ? 'Editing...' : 'Edit Record'}
                </button>
                {editing && (
                  <div className="space-y-2 pt-2 border-t border-[#1E1E2E]">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Brand</label>
                        <input value={editForm.brand} onChange={e => setEditForm(f => ({...f, brand: e.target.value}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Reference</label>
                        <input value={editForm.reference} onChange={e => setEditForm(f => ({...f, reference: e.target.value}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200 font-mono" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Dial</label>
                        <input value={editForm.dial_color} onChange={e => setEditForm(f => ({...f, dial_color: e.target.value}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Condition</label>
                        <input value={editForm.condition} onChange={e => setEditForm(f => ({...f, condition: e.target.value}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Year</label>
                        <input type="number" value={editForm.year || ''} onChange={e => setEditForm(f => ({...f, year: parseInt(e.target.value) || null}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200 font-mono" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Price USD</label>
                        <input type="number" value={editForm.price_usd || ''} onChange={e => setEditForm(f => ({...f, price_usd: parseFloat(e.target.value) || 0}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200 font-mono" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Verdict</label>
                        <select value={editForm.verdict} onChange={e => setEditForm(f => ({...f, verdict: e.target.value}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200">
                          {['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 uppercase">Confidence</label>
                        <input type="number" min="0" max="100" value={editForm.confidence} onChange={e => setEditForm(f => ({...f, confidence: parseInt(e.target.value) || 0}))}
                          className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-200 font-mono" />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setEditing(false)}
                        className="flex-1 px-2 py-1.5 text-xs text-gray-400 border border-gray-800 rounded hover:text-white">Cancel</button>
                      <button onClick={saveEdit} disabled={saving}
                        className="flex-1 px-2 py-1.5 text-xs font-medium bg-green-500 text-black rounded hover:bg-green-400 disabled:opacity-50 flex items-center justify-center gap-1">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save
                      </button>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => navigate(`/price-research?brand=${encodeURIComponent(record.brand)}&ref=${encodeURIComponent(record.reference)}`)}
                  className="w-full px-4 py-2 bg-[#111118] hover:bg-[#1A1A24] text-white rounded-lg font-medium transition-colors border border-[#1E1E2E] text-sm flex items-center justify-center gap-2"
                >
                  <TrendingUp size={14} /> Price Research
                </button>
                <button
                  onClick={() => navigate(`/admin/browser?edit=${record.id}`)}
                  className="w-full px-4 py-2 bg-[#111118] hover:bg-[#1A1A24] text-white rounded-lg font-medium transition-colors border border-[#1E1E2E] text-sm flex items-center justify-center gap-2"
                >
                  <Eye size={14} /> Open in Admin Browser
                </button>
                <button
                  onClick={reparseRecord}
                  disabled={reparsing}
                  className="w-full px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg font-medium transition-colors border border-blue-500/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={reparsing ? 'animate-spin' : ''} />
                  {reparsing ? 'Re-parsing...' : 'Re-run Parser'}
                </button>
                <button
                  onClick={triggerAiReview}
                  className="w-full px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg font-medium transition-colors border border-amber-500/20 text-sm flex items-center justify-center gap-2"
                >
                  <Sparkles size={14} /> AI Review Assist
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function DataField({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="bg-[#0A0A0F] rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="text-gray-500" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function PriceCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0A0A0F] rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
