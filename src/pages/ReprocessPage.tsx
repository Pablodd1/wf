/**
 * REPROCESS PAGE  —  /reprocess
 *
 * Runs HUMAN + RECYCLE records through the 4-stage cascade:
 *   Stage 1: Enhanced regex (HKD k-suffix, million prices, brand-from-ref)
 *   Stage 2: Catalog lookup (ref → brand for digit-only refs)
 *   Stage 3: Confidence gate (≥90 → APPROVED, 70-89 → HUMAN, <70+ref → DeepSeek)
 *   Stage 4: DeepSeek merge (for sub-70 records with a ref)
 *
 * Processes in batches of 100. Shows live counters + sample results.
 */

import { useState, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { useWatchData } from '@/hooks/useWatchData';

interface ReprocessResult {
  id: string;
  verdict: 'APPROVED' | 'HUMAN' | 'RECYCLE';
  brand: string;
  reference: string;
  dialColor: string;
  condition: string;
  year: number | null;
  price: number | null;
  priceUSD: number | null;
  currency: string;
  confidence: number;
  source: 'regex' | 'catalog' | 'llm';
  flags: string[];
}

interface BatchResponse {
  processed: number;
  approved: number;
  human: number;
  recycled: number;
  llmCalls: number;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  results: ReprocessResult[];
}

const BATCH_SIZE = 100;

const statusColor = (v: string) => {
  if (v === 'APPROVED') return 'text-green-400';
  if (v === 'HUMAN') return 'text-yellow-400';
  return 'text-red-400';
};

const sourceBadge = (s: string) => {
  if (s === 'llm') return 'bg-purple-900/40 text-purple-300 border-purple-700';
  if (s === 'catalog') return 'bg-blue-900/40 text-blue-300 border-blue-700';
  return 'bg-slate-800 text-slate-400 border-slate-700';
};

export default function ReprocessPage() {
  const { records, stats, loading: dataLoading } = useWatchData();

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [offset, setOffset] = useState(0);
  const [totals, setTotals] = useState({ processed: 0, approved: 0, human: 0, recycled: 0, llmCalls: 0 });
  const [recentResults, setRecentResults] = useState<ReprocessResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [batchLog, setBatchLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  // Filter HUMAN + RECYCLE records
  const targets = records.filter(r => {
    const status = r.isResidue ? 'RECYCLE' : 'HUMAN';
    return status === 'HUMAN' || status === 'RECYCLE';
  });

  // Build raw rows for the API (array format matching parsedWatches.json)
  const targetRows = targets.map(r => [
    r.id,
    r.brand,
    r.reference,
    r.dialColor,
    r.price,
    r.price,
    r.originalCurrency,
    r.condition,
    r.rawMessage,
    r.confidence,
    r.isResidue ? 'RECYCLE' : 'HUMAN',
    r.failureFlags,
  ]);

  const runBatch = async (currentOffset: number, rows: any[][]) => {
    const res = await fetch('/api/reprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'batch', records: rows, limit: BATCH_SIZE, offset: currentOffset }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<BatchResponse>;
  };

  const start = async () => {
    if (targetRows.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setDone(false);
    setOffset(0);
    setTotals({ processed: 0, approved: 0, human: 0, recycled: 0, llmCalls: 0 });
    setRecentResults([]);
    setBatchLog([]);
    setError(null);

    let off = 0;
    while (off < targetRows.length && !stopRef.current) {
      try {
        const batch: BatchResponse = await runBatch(off, targetRows);

        // Persist approved + human to Supabase
        const toSave = batch.results.filter(r => r.verdict !== 'RECYCLE');
        if (toSave.length > 0) {
          fetch('/api/persist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: toSave, mode: 'reprocess' }),
          }).catch(() => {/* non-blocking */});
        }

        setTotals(prev => ({
          processed: prev.processed + batch.processed,
          approved: prev.approved + batch.approved,
          human: prev.human + batch.human,
          recycled: prev.recycled + batch.recycled,
          llmCalls: prev.llmCalls + batch.llmCalls,
        }));
        setOffset(off + batch.processed);
        setRecentResults(prev => [...batch.results.slice(0, 20), ...prev].slice(0, 50));
        setBatchLog(prev => [
          `Batch ${Math.ceil((off + batch.processed) / BATCH_SIZE)}: +${batch.approved} approved, +${batch.human} human, +${batch.recycled} recycled, ${batch.llmCalls} LLM calls`,
          ...prev,
        ].slice(0, 20));

        if (!batch.hasMore) break;
        off += BATCH_SIZE;
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        setError(err.message);
        break;
      }
    }

    setRunning(false);
    setDone(!stopRef.current);
  };

  const stop = () => {
    stopRef.current = true;
  };

  const progress = targetRows.length > 0 ? Math.min((offset / targetRows.length) * 100, 100) : 0;

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-white tracking-tight">Re-normalize Pipeline</h1>
          <p className="text-sm text-slate-400">
            Re-processes HUMAN + RECYCLE records through 4-stage cascade: regex → catalog → confidence gate → DeepSeek API
          </p>
        </div>

        {/* Stats overview */}
        {!dataLoading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Target Records', value: targetRows.length.toLocaleString(), color: 'text-white' },
              { label: 'Potentially Recoverable', value: '~46,000', color: 'text-gold-primary' },
              { label: 'DeepSeek Cost Est.', value: `~$${(targetRows.length * 0.0001).toFixed(2)}`, color: 'text-green-400' },
              { label: 'DEEPSEEK_API_KEY', value: 'Set ✓', color: 'text-green-400' },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Stage legend */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Pipeline Stages</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {[
              { n: '1', label: 'Regex Parse', desc: 'Brand/ref/price/dial/year. Handles HKD k-suffix, million prices, USDT, brand-from-ref pattern.' },
              { n: '2', label: 'Catalog Lookup', desc: 'Map digit refs to Patek/AP/Rolex using 177-entry catalog. Boosts confidence on hit.' },
              { n: '3', label: 'Confidence Gate', desc: '≥90% → APPROVED direct. 70–89% → HUMAN. <70% with ref → DeepSeek. No ref → RECYCLE.' },
              { n: '4', label: 'DeepSeek Merge', desc: 'Expert watch extraction prompt. Merges LLM result, re-scores, final verdict.' },
            ].map(s => (
              <div key={s.n} className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-gold-primary/20 text-gold-primary text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">{s.n}</span>
                <div>
                  <span className="text-white font-medium">{s.label}</span>
                  <span className="text-slate-400"> — {s.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-3 items-center">
          {!running ? (
            <button
              onClick={start}
              disabled={dataLoading || targetRows.length === 0}
              className="px-6 py-3 bg-gold-primary text-slate-900 font-bold rounded-xl hover:bg-gold-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {done ? 'Run Again' : `Start Re-process (${targetRows.length.toLocaleString()} records)`}
            </button>
          ) : (
            <button
              onClick={stop}
              className="px-6 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-500 transition-all"
            >
              Stop
            </button>
          )}
          {running && (
            <span className="text-sm text-slate-400 animate-pulse">
              Processing {offset.toLocaleString()} / {targetRows.length.toLocaleString()}…
            </span>
          )}
          {done && !running && (
            <span className="text-sm text-green-400 font-medium">Complete ✓</span>
          )}
        </div>

        {/* Progress bar */}
        {(running || done) && (
          <div className="space-y-2">
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gold-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Processed', value: totals.processed, color: 'text-white' },
                { label: 'Approved', value: totals.approved, color: 'text-green-400' },
                { label: 'Human', value: totals.human, color: 'text-yellow-400' },
                { label: 'Recycled', value: totals.recycled, color: 'text-red-400' },
                { label: 'LLM Calls', value: totals.llmCalls, color: 'text-purple-400' },
              ].map(s => (
                <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-lg font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Batch log + results grid */}
        {recentResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Batch log */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Batch Log</p>
              <div className="space-y-1 font-mono text-xs text-slate-400 max-h-48 overflow-y-auto">
                {batchLog.map((line, i) => (
                  <div key={i} className="text-slate-400">{line}</div>
                ))}
              </div>
            </div>

            {/* Recent results sample */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Recent Results (sample)</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {recentResults.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`font-bold w-20 shrink-0 ${statusColor(r.verdict)}`}>{r.verdict}</span>
                    <span className="text-slate-300 truncate flex-1">{r.brand} {r.reference}</span>
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadge(r.source)}`}>{r.source}</span>
                    <span className="text-slate-500 w-8 text-right">{r.confidence}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Final summary */}
        {done && totals.processed > 0 && (
          <div className="bg-slate-900 border border-gold-primary/30 rounded-xl p-6 space-y-3">
            <p className="text-sm font-bold text-gold-primary uppercase tracking-wider">Run Complete</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-3xl font-bold text-green-400">{totals.approved.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">Now APPROVED</p>
                <p className="text-xs text-green-400/60">{((totals.approved / totals.processed) * 100).toFixed(1)}% recovery rate</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-yellow-400">{totals.human.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">Still HUMAN review</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-400">{totals.recycled.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">Confirmed RECYCLE</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 text-center">
              {totals.llmCalls} DeepSeek calls · est. ${(totals.llmCalls * 0.0001).toFixed(4)} cost
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
