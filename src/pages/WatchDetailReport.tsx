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
import {
  ArrowLeft, Eye, CheckCircle, XCircle, Clock, AlertTriangle,
  DollarSign, TrendingUp, TrendingDown, Activity, ShieldCheck,
  FileText, Hash, Palette, Calendar, Gauge, RefreshCw,
  Trash2, UserCheck, Bot, AlertOctagon
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

  useEffect(() => {
    if (!id) return;
    loadRecord(id);
  }, [id]);

  const loadRecord = async (recordId: string) => {
    setLoading(true);
    setError('');
    try {
      // Fetch the specific record
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${recordId}&limit=1`,
        { headers: REQ_HEADERS }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.length === 0) {
        setError('Record not found');
        setLoading(false);
        return;
      }
      const rec = data[0];
      setRecord(rec);

      // Fetch price stats for this reference to determine if outlier
      if (rec.reference && rec.brand) {
        const statsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watch_records?select=price_usd&reference=eq.${encodeURIComponent(rec.reference)}&verdict=eq.APPROVED&price_usd=gt.0&limit=1000`,
          { headers: REQ_HEADERS }
        );
        if (statsRes.ok) {
          const prices = (await statsRes.json()).map((r: any) => r.price_usd).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
          if (prices.length > 0) {
            const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
            const median = prices[Math.floor(prices.length / 2)];
            const q1 = prices[Math.floor(prices.length * 0.25)];
            const q3 = prices[Math.floor(prices.length * 0.75)];
            const iqr = q3 - q1;
            const outlierLow = q1 - 1.5 * iqr;
            const outlierHigh = q3 + 1.5 * iqr;
            const isOutlier = rec.price_usd > outlierHigh || rec.price_usd < outlierLow;
            setPriceStats({ avg, median, q1, q3, iqr, outlierLow, outlierHigh, isOutlier, totalComparisons: prices.length });
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
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

            {/* Actions */}
            <div className="bg-[#111118] border border-[#1E1E2E] rounded-xl overflow-hidden">
              <div className="p-5 space-y-2">
                <button
                  onClick={() => navigate(`/admin/browser?edit=${record.id}`)}
                  className="w-full px-4 py-2 bg-[#D4AF37] hover:bg-[#E5C158] text-black rounded-lg font-medium transition-colors text-sm"
                >
                  Edit Record
                </button>
                <button
                  onClick={() => navigate(`/price-research?brand=${encodeURIComponent(record.brand)}&ref=${encodeURIComponent(record.reference)}`)}
                  className="w-full px-4 py-2 bg-[#111118] hover:bg-[#1A1A24] text-white rounded-lg font-medium transition-colors border border-[#1E1E2E] text-sm"
                >
                  View Price Research
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
