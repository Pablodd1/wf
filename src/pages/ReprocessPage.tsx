/**
 * Reprocessing Dashboard — Admin Panel
 * Shows real-time progress of 2.39M record reprocessing with parser v3
 * Start/Stop/Pause controls. Estimated completion time.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Play, Pause, Square, Loader2, RefreshCw,
  CheckCircle, AlertTriangle, Clock, Zap, Database,
  TrendingUp, ArrowRight, FileText,
  Download, ArrowRightLeft, PieChart, Tag, Percent,
} from 'lucide-react';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const REQ = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

interface Progress {
  total_records: number;
  total_batches: number;
  batches_completed: number;
  batches_pending: number;
  batches_processing: number;
  batches_failed: number;
  records_processed: number;
  records_updated: number;
  started_at: string | null;
  completed_at: string | null;
  last_batch_at: string | null;
  parser_version: string;
}

interface QueueStatus {
  status: string;
  count: number;
}

interface BatchLog {
  batch_number: number;
  status: string;
  records_processed: number;
  records_updated: number;
  latency: number;
  completed_at: string | null;
}

interface ReportStats {
  total: number;
  v3_processed: number;
  pre_v3: number;
  percent_complete: number;
  verdicts: { pre: Record<string, number>; post: Record<string, number> };
  brands: { pre: [string, number][]; post: [string, number][] };
  references: { pre_with_ref: number; post_with_ref: number; pre_rate: number; post_rate: number };
  generated_at: string;
}

export default function ReprocessPage() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus[]>([]);
  const [batchLogs, setBatchLogs] = useState<BatchLog[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoProcess, setAutoProcess] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'logs' | 'report'>('logs');
  const [report, setReport] = useState<ReportStats | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processRef = useRef(false);

  // Fetch progress from Supabase
  const fetchProgress = useCallback(async () => {
    try {
      const [progressRes, queueRes, logsRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/reprocessing_progress?id=eq.1`, { headers: REQ }),
        fetch(`${SUPABASE_URL}/rest/v1/reprocessing_queue?select=status,count(*)&group=status`, { headers: REQ }),
        fetch(`${SUPABASE_URL}/rest/v1/reprocessing_queue?select=batch_number,status,records_processed,records_updated,completed_at&status=eq.completed&order=batch_number.desc&limit=20`, { headers: REQ }),
      ]);

      if (progressRes.ok) {
        const data = await progressRes.json();
        if (data[0]) setProgress(data[0]);
      }
      if (queueRes.ok) {
        const data = await queueRes.json();
        setQueueStatus(data || []);
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setBatchLogs(data || []);
      }
    } catch (err) {
      console.error('Fetch progress error:', err);
    }
  }, []);

  // Fetch stats report
  const fetchReport = useCallback(async () => {
    setIsLoadingReport(true);
    try {
      const res = await fetch('/api/reprocess-batch?action=stats');
      const data = await res.json();
      if (data.ok && data.stats) setReport(data.stats);
    } catch (e) { console.error('Fetch report error:', e); }
    setIsLoadingReport(false);
  }, []);

  // Process one batch
  const processOneBatch = useCallback(async () => {
    if (processRef.current) return;
    processRef.current = true;
    setIsProcessing(true);

    try {
      const res = await fetch('/api/reprocess-batch', { method: 'POST' });
      const data = await res.json();

      if (data.done) {
        setAutoProcess(false);
        setStatusMsg('All batches completed!');
      } else {
        setStatusMsg(`Batch ${data.batch}: ${data.processed} processed, ${data.updated} updated (${data.errors} errors) — ${data.remaining_batches} remaining`);
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    }

    processRef.current = false;
    setIsProcessing(false);
    await fetchProgress();
  }, [fetchProgress]);

  // Auto-process loop
  useEffect(() => {
    fetchProgress();
    const i = setInterval(fetchProgress, 5000);
    return () => clearInterval(i);
  }, [fetchProgress]);

  useEffect(() => {
    if (autoProcess) {
      processOneBatch();
      intervalRef.current = setInterval(() => {
        if (!processRef.current) processOneBatch();
      }, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoProcess, processOneBatch]);

  const pct = progress ? (progress.batches_completed / progress.total_batches) * 100 : 0;
  const eta = progress && progress.batches_completed > 0
    ? Math.ceil((progress.batches_pending / Math.max(progress.batches_completed, 1)) * 5)
    : null;

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Cpu size={24} className="text-[#D4AF37]" /> Reprocessing Engine
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Reprocess all 2,392,784 records with parser v3. Updates brand, reference, price, condition, dial, year, confidence, verdict.
          </p>
        </div>
      </div>

      {/* Progress Overview */}
      <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${progress?.completed_at ? 'bg-green-500' : isProcessing ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
            <span className="text-lg font-bold text-white">
              {progress?.completed_at ? 'COMPLETED' : isProcessing ? 'PROCESSING' : 'READY'}
            </span>
          </div>
          <span className="text-sm text-gray-500 font-mono">Parser: {progress?.parser_version || 'v3'}</span>
        </div>

        {/* Progress bar */}
        <div className="h-4 bg-[#1E1E2E] rounded-full overflow-hidden mb-3">
          <motion.div
            className="h-full bg-gradient-to-r from-[#D4AF37] to-[#B8942E]"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">{pct.toFixed(1)}% — {progress?.batches_completed || 0}/{progress?.total_batches || 2393} batches</span>
          <span className="text-gray-500 font-mono">
            {progress?.records_processed?.toLocaleString() || 0} / {progress?.total_records?.toLocaleString() || '2,392,784'} records
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-[#0A0A0F] rounded-lg p-4 border border-green-500/20">
            <div className="text-[10px] text-green-400 uppercase mb-1">Completed</div>
            <div className="text-2xl font-bold text-green-400">{progress?.batches_completed || 0}</div>
            <div className="text-[10px] text-gray-600">batches</div>
          </div>
          <div className="bg-[#0A0A0F] rounded-lg p-4 border border-yellow-500/20">
            <div className="text-[10px] text-yellow-400 uppercase mb-1">Pending</div>
            <div className="text-2xl font-bold text-yellow-400">{progress?.batches_pending || 0}</div>
            <div className="text-[10px] text-gray-600">batches</div>
          </div>
          <div className="bg-[#0A0A0F] rounded-lg p-4 border border-blue-500/20">
            <div className="text-[10px] text-blue-400 uppercase mb-1">Processing</div>
            <div className="text-2xl font-bold text-blue-400">{progress?.batches_processing || 0}</div>
            <div className="text-[10px] text-gray-600">right now</div>
          </div>
          <div className="bg-[#0A0A0F] rounded-lg p-4 border border-red-500/20">
            <div className="text-[10px] text-red-400 uppercase mb-1">Failed</div>
            <div className="text-2xl font-bold text-red-400">{progress?.batches_failed || 0}</div>
            <div className="text-[10px] text-gray-600">batches</div>
          </div>
        </div>

        {/* ETA */}
        {eta && !progress?.completed_at && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
            <Clock size={14} />
            Estimated completion: ~{eta} minutes at current rate
            {progress?.last_batch_at && (
              <span className="text-gray-600 ml-2">(Last batch: {new Date(progress.last_batch_at).toLocaleTimeString()})</span>
            )}
          </div>
        )}

        {/* Status message */}
        <AnimatePresence>
          {statusMsg && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-4 p-3 bg-[#1A1A24] rounded-lg text-sm text-gray-300 font-mono">
              {statusMsg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Control Panel */}
      <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-6 mb-6">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Zap size={16} className="text-[#D4AF37]" /> Controls
        </h3>
        <div className="flex gap-3">
          {!autoProcess ? (
            <button onClick={() => setAutoProcess(true)}
              disabled={isProcessing || progress?.completed_at != null}
              className="px-6 py-3 bg-gradient-to-r from-[#D4AF37] to-[#B8942E] text-black rounded-lg font-semibold hover:opacity-90 disabled:opacity-40 flex items-center gap-2">
              <Play size={18} /> Start Auto-Processing
            </button>
          ) : (
            <button onClick={() => setAutoProcess(false)}
              className="px-6 py-3 bg-gradient-to-r from-yellow-600 to-yellow-500 text-white rounded-lg font-semibold hover:opacity-90 flex items-center gap-2">
              <Pause size={18} /> Pause
            </button>
          )}

          <button onClick={processOneBatch}
            disabled={isProcessing}
            className="px-6 py-3 bg-[#1A1A24] text-white rounded-lg font-medium hover:bg-[#2A2A3A] disabled:opacity-40 flex items-center gap-2 border border-[#1E1E2E]">
            {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            Process 1 Batch (1,000 records)
          </button>

          <button onClick={fetchProgress}
            className="px-4 py-3 bg-[#1A1A24] text-gray-400 rounded-lg hover:text-white flex items-center gap-2 border border-[#1E1E2E]">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg mb-6 overflow-hidden">
        <div className="flex border-b border-[#1E1E2E]">
          <button onClick={() => setActiveTab('logs')}
            className={`px-6 py-3 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'logs' ? 'text-[#D4AF37] border-b-2 border-[#D4AF37]' : 'text-gray-400 hover:text-gray-200'}`}>
            <FileText size={14} /> Batch Logs
          </button>
          <button onClick={() => { setActiveTab('report'); if (!report) fetchReport(); }}
            className={`px-6 py-3 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'report' ? 'text-[#D4AF37] border-b-2 border-[#D4AF37]' : 'text-gray-400 hover:text-gray-200'}`}>
            <PieChart size={14} /> Report
          </button>
        </div>

        {/* Batch Logs Tab */}
        {activeTab === 'logs' && (
          <div className="p-6">
            {batchLogs.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">No batches processed yet</div>
            ) : (
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#1A1A24]">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-3">Batch</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Processed</th>
                      <th className="px-4 py-3">Updated</th>
                      <th className="px-4 py-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchLogs.map((log) => (
                      <tr key={log.batch_number} className="border-t border-[#1E1E2E]">
                        <td className="px-4 py-3 text-white font-mono">#{log.batch_number}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            log.status === 'completed' ? 'text-green-400 bg-green-400/10' :
                            log.status === 'failed' ? 'text-red-400 bg-red-400/10' :
                            'text-yellow-400 bg-yellow-400/10'
                          }`}>{log.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{log.records_processed?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[#D4AF37]">{log.records_updated?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-500">{log.completed_at ? new Date(log.completed_at).toLocaleTimeString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Report Tab */}
        {activeTab === 'report' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <PieChart size={16} className="text-[#D4AF37]" /> Before / After Comparison
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={fetchReport} disabled={isLoadingReport}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#3B5BFE]/20 text-[#3B5BFE] hover:bg-[#3B5BFE]/30 border border-[#3B5BFE]/30 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {isLoadingReport ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Refresh
                </button>
                <button onClick={() => {
                    if (!report) return;
                    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url;
                    a.download = `watchfacts-report-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
                  }} disabled={!report}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  <Download size={12} /> JSON
                </button>
              </div>
            </div>

            {isLoadingReport && (
              <div className="text-center py-12 text-gray-500 text-sm">
                <Loader2 size={24} className="animate-spin mx-auto mb-3 text-[#D4AF37]" />
                Loading report...
              </div>
            )}
            {!isLoadingReport && !report && (
              <div className="text-center py-12 text-gray-500 text-sm">Click Refresh to generate the report</div>
            )}

            {report && (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <ReportCard icon={Database} label="Total" value={report.total.toLocaleString()} color="text-blue-400" bg="bg-blue-400/10" />
                  <ReportCard icon={CheckCircle} label="v3 Processed" value={report.v3_processed.toLocaleString()} color="text-green-400" bg="bg-green-400/10" />
                  <ReportCard icon={Clock} label="Pre-v3" value={report.pre_v3.toLocaleString()} color="text-gray-400" bg="bg-gray-400/10" />
                  <ReportCard icon={Percent} label="Complete" value={`${report.percent_complete}%`} color="text-[#D4AF37]" bg="bg-[#D4AF37]/10" />
                </div>

                {/* Reference Extraction */}
                <div className="rounded-lg bg-[#0A0A0F] border border-[#1E1E2E] p-5">
                  <h4 className="text-xs font-semibold text-[#D4AF37] mb-4 flex items-center gap-2"><Tag size={14} /> Reference Extraction Rate</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Before v3</div>
                      <div className="flex items-end gap-2">
                        <span className="text-xl font-bold text-gray-400">{report.references.pre_rate}%</span>
                        <span className="text-[10px] text-gray-600 mb-1">({report.references.pre_with_ref.toLocaleString()} / {report.pre_v3.toLocaleString()})</span>
                      </div>
                      <div className="h-2 bg-[#1E1E2E] rounded-full mt-1"><div className="h-full bg-gray-500 rounded-full" style={{ width: `${Math.min(report.references.pre_rate, 100)}%` }} /></div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#D4AF37] mb-1">After v3</div>
                      <div className="flex items-end gap-2">
                        <span className="text-xl font-bold text-[#D4AF37]">{report.references.post_rate}%</span>
                        <span className="text-[10px] text-gray-600 mb-1">({report.references.post_with_ref.toLocaleString()} / {report.v3_processed.toLocaleString()})</span>
                      </div>
                      <div className="h-2 bg-[#1E1E2E] rounded-full mt-1"><div className="h-full bg-[#D4AF37] rounded-full" style={{ width: `${Math.min(report.references.post_rate, 100)}%` }} /></div>
                    </div>
                  </div>
                  {report.references.post_rate > report.references.pre_rate && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-green-400">
                      <TrendingUp size={12} /> +{report.references.post_rate - report.references.pre_rate}pp improvement
                    </div>
                  )}
                </div>

                {/* Verdict Distribution */}
                <div className="rounded-lg bg-[#0A0A0F] border border-[#1E1E2E] p-5">
                  <h4 className="text-xs font-semibold text-[#D4AF37] mb-4 flex items-center gap-2"><PieChart size={14} /> Verdict Distribution</h4>
                  <div className="space-y-2">
                    {['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE', 'WTB', 'WTS'].map(v => {
                      const pre = report.verdicts.pre[v] || 0, post = report.verdicts.post[v] || 0;
                      const preT = Object.values(report.verdicts.pre).reduce((a, b) => a + b, 0) || 1;
                      const postT = Object.values(report.verdicts.post).reduce((a, b) => a + b, 0) || 1;
                      const prePct = Math.round((pre / preT) * 100), postPct = Math.round((post / postT) * 100);
                      if (pre === 0 && post === 0) return null;
                      return (
                        <div key={v} className="flex items-center gap-3 text-xs">
                          <span className={`w-14 font-semibold ${v === 'APPROVED' ? 'text-green-400' : v === 'REVIEW' ? 'text-yellow-400' : v === 'HUMAN' ? 'text-orange-400' : v === 'RECYCLE' ? 'text-red-400' : 'text-blue-400'}`}>{v}</span>
                          <div className="flex-1 flex items-center gap-2">
                            <div className="flex-1 h-4 bg-[#1E1E2E] rounded overflow-hidden flex"><div className={`h-full ${v === 'APPROVED' ? 'bg-green-400/20' : v === 'REVIEW' ? 'bg-yellow-400/20' : v === 'HUMAN' ? 'bg-orange-400/20' : v === 'RECYCLE' ? 'bg-red-400/20' : 'bg-blue-400/20'} flex items-center justify-center text-[9px] font-mono`} style={{ width: `${Math.max(prePct, 8)}%` }}>{prePct > 0 ? `${prePct}%` : ''}</div></div>
                            <ArrowRightLeft size={10} className="text-gray-600 flex-shrink-0" />
                            <div className="flex-1 h-4 bg-[#1E1E2E] rounded overflow-hidden flex"><div className={`h-full ${v === 'APPROVED' ? 'bg-green-400/20' : v === 'REVIEW' ? 'bg-yellow-400/20' : v === 'HUMAN' ? 'bg-orange-400/20' : v === 'RECYCLE' ? 'bg-red-400/20' : 'bg-blue-400/20'} flex items-center justify-center text-[9px] font-mono`} style={{ width: `${Math.max(postPct, 8)}%` }}>{postPct > 0 ? `${postPct}%` : ''}</div></div>
                          </div>
                          <span className="w-24 text-right text-gray-500 font-mono">{pre.toLocaleString()} → {post.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Brand Distribution */}
                <div className="rounded-lg bg-[#0A0A0F] border border-[#1E1E2E] p-5">
                  <h4 className="text-xs font-semibold text-[#D4AF37] mb-4 flex items-center gap-2"><Database size={14} /> Brand Distribution (Top 10)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-500 border-b border-[#1E1E2E]">
                        <th className="px-3 py-2 text-left">Brand</th><th className="px-3 py-2 text-right">Before</th><th className="px-3 py-2 text-right">After</th><th className="px-3 py-2 text-right">Change</th>
                      </tr></thead>
                      <tbody>
                        {(() => {
                          const all = new Set([...report.brands.pre.map(b => b[0]), ...report.brands.post.map(b => b[0])]);
                          const rows = [...all].map(b => {
                            const p = report.brands.pre.find(x => x[0] === b)?.[1] || 0;
                            const a = report.brands.post.find(x => x[0] === b)?.[1] || 0;
                            return { brand: b, pre: p, post: a, change: a - p };
                          }).sort((a, b) => (b.pre + b.post) - (a.pre + a.post)).slice(0, 10);
                          return rows.map((r, i) => (
                            <tr key={r.brand} className="border-t border-[#1E1E2E] hover:bg-[#1A1A24]">
                              <td className="px-3 py-2 font-medium text-white">{r.brand}</td>
                              <td className="px-3 py-2 text-right text-gray-400">{r.pre.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-[#D4AF37]">{r.post.toLocaleString()}</td>
                              <td className={`px-3 py-2 text-right font-mono ${r.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r.change > 0 ? '+' : ''}{r.change.toLocaleString()}</td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="text-center text-[10px] text-gray-600">
                  Report generated: {new Date(report.generated_at).toLocaleString()}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Queue Status */}
      <div className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-6">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Database size={16} className="text-[#D4AF37]" /> Queue Status
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {queueStatus.map((qs) => (
            <div key={qs.status} className={`p-3 rounded-lg border ${
              qs.status === 'completed' ? 'bg-green-500/5 border-green-500/20' :
              qs.status === 'pending' ? 'bg-yellow-500/5 border-yellow-500/20' :
              qs.status === 'processing' ? 'bg-blue-500/5 border-blue-500/20' :
              qs.status === 'failed' ? 'bg-red-500/5 border-red-500/20' :
              'bg-gray-800/50 border-gray-700'
            }`}>
              <div className="text-[10px] text-gray-500 uppercase mb-1">{qs.status}</div>
              <div className="text-xl font-bold text-white">{qs.count?.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ icon: Icon, label, value, color, bg }: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  label: string; value: string; color: string; bg: string;
}) {
  return (
    <div className="bg-[#111118] rounded-lg p-4 border border-[#1E1E2E]">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-7 h-7 rounded ${bg} flex items-center justify-center`}><Icon size={14} className={color} /></div>
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      <div className="text-lg font-bold text-white">{value}</div>
    </div>
  );
}
