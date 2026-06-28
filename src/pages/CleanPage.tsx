import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import { Footer } from '@/components/Footer';
import { useWatchData } from '@/hooks/useWatchData';
import { cleanAnalyze, saveCleanWatchToSupabase } from '@/lib/cleanAnalyze';
import { exportCleanExcel, exportCleanCsv } from '@/lib/cleanExport';
import { enrichWatch } from '@/lib/enrich';
import type { CleanResponse, CleanWatch, CleanStage, Verdict } from '@/lib/cleanAnalyze';
import type { EnrichmentData } from '@/lib/enrich';
import {
  Sparkles, Search, Cog, Download, FileSpreadsheet,
  CheckCircle2, UserCheck, Trash2, AlertTriangle, Loader2,
  ExternalLink, TrendingUp,
} from 'lucide-react';

const SAMPLE = `5712/1A Blue N5/2026 New 850k HKD
RM35-03 White unworn 2.1M HKD
126334 Black 2025 used 45k USD
Patek green new 500k`;


const verdictMeta: Record<Verdict, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  APPROVED: { label: 'Approved', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 },
  HUMAN:    { label: 'Human Review', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', Icon: UserCheck },
  RECYCLE:  { label: 'Recycle Bin', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', Icon: Trash2 },
};

const stageIcon: Record<string, React.ElementType> = {
  PARSE: Cog, AI_TEXT: Sparkles, ONLINE: Search, IMAGE: AlertTriangle,
};

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 85 ? 'bg-emerald-500' : value >= 35 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] font-mono text-text-secondary w-9 text-right">{value}%</span>
    </div>
  );
}

function StageRow({ s, idx }: { s: CleanStage; idx: number }) {
  const Icon = stageIcon[s.stage] || Search;
  const mismatch = s.verdict === 'MISMATCH';
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`h-7 w-7 rounded-full flex items-center justify-center border ${mismatch ? 'border-red-500/50 bg-red-500/10' : 'border-border-default bg-bg-elevated'}`}>
          <Icon size={13} className={mismatch ? 'text-red-400' : 'text-gold-primary'} />
        </div>
        {idx < 99 && <div className="w-px flex-1 bg-border-default my-1" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{s.stage.replace('_', ' ')}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted font-mono">{s.engine}</span>
          {s.verdict && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
              s.verdict === 'MATCH' ? 'bg-emerald-500/15 text-emerald-400' :
              s.verdict === 'MISMATCH' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
              {s.verdict}
            </span>
          )}
        </div>
        {s.note && <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{s.note}</p>}
        {s.error && <p className="text-[11px] text-red-400 mt-0.5">⚠ {s.error}</p>}
        <div className="mt-1.5"><ConfidenceBar value={s.confidence} /></div>
        {s.data && Object.keys(s.data).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(s.data)
              .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 'Unknown')
              .slice(0, 8)
              .map(([k, v]) => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated/60 text-text-muted font-mono">
                  <span className="text-text-secondary/60">{k}:</span> {String(v).slice(0, 28)}
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WatchCard({ w, n, enrichment, onEnrich }: { w: CleanWatch; n: number; enrichment?: EnrichmentData; onEnrich?: () => void }) {
  const meta = verdictMeta[w.verdict];
  const [loadingEnrich, setLoadingEnrich] = useState(false);

  async function handleEnrich() {
    if (!w.parsed.reference || loadingEnrich || !onEnrich) return;
    setLoadingEnrich(true);
    await onEnrich();
    setLoadingEnrich(false);
  }

  return (
    <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
      {/* header */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border-default">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-muted">#{n}</span>
            <span className="text-sm font-bold text-text-primary truncate">
              {w.parsed.brand !== 'Unknown' ? w.parsed.brand : 'Unidentified'}
              {w.parsed.reference ? ` · ${w.parsed.reference}` : ''}
            </span>
          </div>
          <p className="text-[11px] text-text-muted mt-1 line-clamp-2">{w.input}</p>
        </div>
        <div className={`shrink-0 flex flex-col items-end gap-1 px-2.5 py-1.5 rounded-lg border ${meta.bg}`}>
          <div className="flex items-center gap-1.5">
            <meta.Icon size={14} className={meta.color} />
            <span className={`text-xs font-bold ${meta.color}`}>{meta.label}</span>
          </div>
          <span className="text-[10px] font-mono text-text-muted">{w.confidence}%</span>
        </div>
      </div>
      {/* reason */}
      <div className="px-4 py-2 bg-bg-elevated/40 flex items-start gap-2">
        {w.verdict === 'HUMAN' && <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />}
        <p className="text-[11px] text-text-secondary leading-snug">{w.reason}</p>
      </div>
      {/* enrichment bar */}
      {w.parsed.reference && (
        <div className="px-4 py-2 border-b border-border-default flex items-center gap-2">
          <button
            onClick={handleEnrich}
            disabled={loadingEnrich}
            className="flex items-center gap-1.5 text-[11px] font-bold text-gold-primary hover:text-gold-bright transition-colors disabled:opacity-40"
          >
            {loadingEnrich ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />}
            {loadingEnrich ? 'Enriching…' : enrichment ? 'Re-enrich' : 'Enrich'}
          </button>
          {enrichment?.catalog?.collection && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted font-mono">
              {enrichment.catalog.collection}
            </span>
          )}
          {enrichment?.market?.chrono24?.priceRange && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
              ${enrichment.market.chrono24.priceRange.median.toLocaleString()}
            </span>
          )}
          {enrichment?.officialUrl && (
            <a href={enrichment.officialUrl} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-text-muted hover:text-gold-primary transition-colors flex items-center gap-0.5">
              <ExternalLink size={10} /> Official
            </a>
          )}
        </div>
      )}
      {/* stages */}
      <div className="p-4 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-3">Workflow · {w.stages.length} stages</p>
        {w.stages.map((s, i) => <StageRow key={i} s={s} idx={i === w.stages.length - 1 ? 99 : i} />)}
      </div>
    </div>
  );
}

export default function CleanPage() {
  const { stats } = useWatchData();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<CleanResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [enrichments, setEnrichments] = useState<Record<number, EnrichmentData>>({});

  async function run() {
    if (!text.trim()) return;
    setLoading(true); setErr(null); setRes(null); setEnrichments({});
    const r = await cleanAnalyze(text);
    setLoading(false);
    if (!r.success) { setErr(r.error || 'Analysis failed'); return; }
    setRes(r);
    // Auto-save each result to Supabase (fire-and-forget, non-blocking)
    r.watches.forEach(async (w) => {
      try {
        const saveRes = await saveCleanWatchToSupabase(w);
        if (!saveRes.success || !saveRes.persisted) {
          console.warn('[CleanPage] Supabase save failed:', saveRes.error);
        }
      } catch (e) {
        console.warn('[CleanPage] Supabase save error:', e);
      }
    });
  }

  async function handleEnrich(idx: number, ref: string, brand: string) {
    const data = await enrichWatch(ref, brand);
    if (data.success && data.enrichment) {
      setEnrichments(prev => ({ ...prev, [idx]: data.enrichment! }));
    }
  }

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      <TabNav totalProcessed={stats.totalProcessed} />

      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* header */}
        <div className="mb-6">
          <h1 className="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <Sparkles size={18} className="text-gold-primary" />
            Clean · Manual Analysis
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Paste one or several watch descriptions. Each watch is analyzed
            <span className="text-text-secondary"> individually</span> through the full pipeline —
            <span className="text-text-secondary"> Parse → AI → Online → Image</span> — with a single 85% gate:
            <span className="text-emerald-400"> ≥85% Approved</span>,
            <span className="text-amber-400"> below → Human</span>,
            <span className="text-red-400"> no info → Recycle</span>.
          </p>
        </div>

        {/* input */}
        <div className="rounded-xl border border-border-default bg-bg-card p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Paste watch description(s) here…\n\n" + SAMPLE}
            rows={7}
            className="w-full bg-bg-elevated/50 border border-border-default rounded-lg p-3 text-sm text-text-primary placeholder:text-text-muted/50 font-mono resize-y focus:outline-none focus:border-gold-primary/50"
          />
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setText(SAMPLE)}
              className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
            >
              Load sample
            </button>
            <button
              onClick={run}
              disabled={loading || !text.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gold-primary text-bg-primary text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle size={14} /> {err}
          </div>
        )}

        {/* summary */}
        {res && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-text-primary">Results Summary</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (res) await exportCleanExcel(res.watches, res.summary);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gold-primary/30 text-gold-primary text-xs font-bold hover:bg-gold-primary/10 transition-colors"
              >
                <Download size={12} />
                Export Excel
              </button>
              <button
                onClick={() => {
                  if (res) exportCleanCsv(res.watches, res.summary);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-text-muted/30 text-text-muted text-xs font-bold hover:bg-bg-elevated transition-colors"
              >
                <FileSpreadsheet size={12} />
                Download CSV
              </button>
            </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total', val: res.summary.total, color: 'text-text-primary' },
                { label: 'Approved', val: res.summary.approved, color: 'text-emerald-400' },
                { label: 'Human', val: res.summary.human, color: 'text-amber-400' },
                { label: 'Recycle', val: res.summary.recycle, color: 'text-red-400' },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-border-default bg-bg-card p-3 text-center">
                  <div className={`text-2xl font-extrabold ${c.color}`}>{c.val}</div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">{c.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* results */}
        {res && (
          <div className="mt-4 space-y-4">
            {res.watches.map((w, i) => (
              <WatchCard
                key={i}
                w={w}
                n={i + 1}
                enrichment={enrichments[i]}
                onEnrich={w.parsed.reference ? () => handleEnrich(i, w.parsed.reference!, w.parsed.brand) : undefined}
              />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </Layout>
  );
}
