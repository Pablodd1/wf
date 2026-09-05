import { useState, useCallback, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import { cleanAnalyze, type CleanWatch, type CleanStage } from '@/lib/cleanAnalyze';
import { saveStudyEntry, loadStudyHistory, type StudyLogEntry } from '@/lib/studyLog';
import {
  Sparkles, Cog, Globe, Eye, AlertTriangle, CheckCircle2,
  UserCheck, Trash2, Laptop, Send, Loader2,
  BookOpen, ShieldCheck, Hash, DollarSign, Calendar, Palette, Box,
  Clock, History,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StudyEntry {
  input: string;
  watch: CleanWatch;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/*  Stage icon + color maps                                            */
/* ------------------------------------------------------------------ */

const STAGE_META: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  PARSE:   { icon: Cog,       color: 'text-blue-400',  bg: 'bg-blue-500/10 border-blue-500/30',  label: 'Parse' },
  AI_TEXT: { icon: Sparkles,  color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30', label: 'AI Text' },
  ONLINE:  { icon: Globe,     color: 'text-cyan-400',   bg: 'bg-cyan-500/10 border-cyan-500/30', label: 'Online' },
  IMAGE:   { icon: Eye,       color: 'text-emerald-400',bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'Image' },
};

const VERDICT_META: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  APPROVED: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'APPROVED' },
  HUMAN:    { icon: UserCheck,    color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',    label: 'HUMAN REVIEW' },
  RECYCLE:  { icon: Trash2,      color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',         label: 'RECYCLE BIN' },
};

/* ------------------------------------------------------------------ */
/*  Confidence bar                                                     */
/* ------------------------------------------------------------------ */

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 85 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
        <div className={`h-full ${color} transition-all duration-700 ease-out`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono text-text-secondary w-8 text-right">{value}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage Box — one per pipeline step                                  */
/* ------------------------------------------------------------------ */

function StageBox({ stage, index }: { stage: CleanStage; index: number }) {
  const meta = STAGE_META[stage.stage] || STAGE_META.PARSE;
  const hasError = !!stage.error;
  const hasData = stage.data && Object.keys(stage.data).length > 0;
  const displayVerdict = stage.verdict === 'MATCH' ? '✅ Match' : stage.verdict === 'MISMATCH' ? '⛔ Mismatch' : null;

  return (
    <div className={`rounded-xl border ${hasError ? 'border-red-500/40 bg-red-500/5' : 'border-border-default bg-bg-card'} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-bg-elevated/50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-bg-elevated border border-border-default flex items-center justify-center">
            <meta.icon size={14} className={meta.color} />
          </div>
          <span className="text-xs font-bold text-text-primary">{meta.label}</span>
          <span className="text-[9px] text-text-muted font-mono bg-bg-elevated rounded px-1.5 py-0.5">{stage.engine}</span>
        </div>
        <div className="flex items-center gap-2">
          {displayVerdict && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              stage.verdict === 'MATCH' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
            }`}>
              {displayVerdict}
            </span>
          )}
          <span className="text-[10px] text-text-muted">Stage {index + 1}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Error */}
        {hasError && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            ⚠ {stage.error}
          </div>
        )}

        {/* Note */}
        {stage.note && (
          <p className="text-xs text-text-secondary leading-relaxed">{stage.note}</p>
        )}

        {/* Data fields */}
        {hasData && (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(stage.data as Record<string, any>)
              .filter(([_k, v]) => v !== null && v !== undefined && v !== '' && v !== 'Unknown')
              .slice(0, 10)
              .map(([k, v]) => (
                <div key={k} className="bg-bg-elevated/60 rounded-lg px-3 py-2">
                  <div className="text-[9px] uppercase tracking-wider text-text-muted mb-0.5">{k}</div>
                  <div className="text-xs font-mono font-bold text-text-primary truncate">
                    {String(v).slice(0, 30)}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Confidence at this stage */}
        <div className="pt-1">
          <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">Confidence after stage</div>
          <ConfidenceBar value={stage.confidence} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Extracted Field — key-value pair                                   */
/* ------------------------------------------------------------------ */

function Field({ label, value, icon: Icon, color }: { label: string; value: string | number | null | undefined; icon: any; color: string }) {
  const val = value !== null && value !== undefined && value !== '' && value !== 'Unknown'
    ? String(value)
    : null;
  return (
    <div className="bg-bg-elevated/70 border border-border-default rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className={color} />
        <span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      </div>
      {val ? (
        <span className="text-sm font-bold font-mono text-text-primary">{val}</span>
      ) : (
        <span className="text-sm text-text-muted italic">—</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Watch Result Card — full breakdown                                 */
/* ------------------------------------------------------------------ */

function WatchResultCard({ entry }: { entry: StudyEntry }) {
  const { watch } = entry;
  const p = watch.parsed;
  const verdictMeta = VERDICT_META[watch.verdict] || VERDICT_META.RECYCLE;
  const VerdictIcon = verdictMeta.icon;

  return (
    <div className="space-y-4">
      {/* ═══ VERDICT BANNER ═══ */}
      <div className={`rounded-xl border ${verdictMeta.bg} p-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <VerdictIcon size={24} className={verdictMeta.color} />
          <div>
            <div className={`text-lg font-extrabold ${verdictMeta.color}`}>{verdictMeta.label}</div>
            <p className="text-xs text-text-secondary mt-0.5 max-w-lg">{watch.reason}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold font-mono text-text-primary">{watch.confidence}%</div>
          <div className="text-[10px] text-text-muted uppercase">Confidence</div>
        </div>
      </div>

      {/* ═══ EXTRACTED FIELDS ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="Brand"           value={p.brand}        icon={ShieldCheck} color="text-amber-400" />
        <Field label="Reference"       value={p.reference}    icon={Hash}         color="text-blue-400" />
        <Field label="Dial Color"      value={p.dialColor}    icon={Palette}      color="text-purple-400" />
        <Field label="Condition"       value={p.condition}    icon={Box}          color="text-cyan-400" />
        <Field label="Year"            value={p.year}         icon={Calendar}     color="text-rose-400" />
        <Field label="Price"           value={p.price?.toLocaleString()} icon={DollarSign} color="text-emerald-400" />
        <Field label="Currency"        value={p.currency}     icon={DollarSign}   color="text-teal-400" />
      </div>

      {/* ═══ INPUT TEXT ═══ */}
      <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
        <div className="px-4 py-2 bg-bg-elevated/30 border-b border-border-default">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Original Input</span>
        </div>
        <div className="p-4 text-sm text-text-secondary font-mono whitespace-pre-wrap leading-relaxed">
          {watch.input}
        </div>
      </div>

      {/* ═══ STAGE-BY-STAGE PIPELINE ═══ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Laptop size={14} className="text-gold-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Pipeline Stages</span>
          <span className="text-[9px] text-text-muted bg-bg-elevated rounded-full px-2 py-0.5">{watch.stages.length} stages</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {watch.stages.map((s, i) => (
            <StageBox key={i} stage={s} index={i} />
          ))}
        </div>
      </div>

      {/* ═══ IMAGE STATUS ═══ */}
      {watch.hasImage && watch.imageUrl && (
        <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
          <div className="px-4 py-2 bg-bg-elevated/30 border-b border-border-default flex items-center gap-2">
            <Eye size={14} className="text-emerald-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Image Provided</span>
          </div>
          <div className="p-4">
            <img
              src={watch.imageUrl}
              alt="Watch"
              className="max-h-64 rounded-lg object-contain bg-bg-elevated mx-auto"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

const SAMPLE = "5712/1A Blue N5/2026 New 850k HKD";

export default function StudyPage() {
  const { stats } = { stats: { totalProcessed: 117744, normalizedCount: 39694, residueCount: 32200, throughputRate: 0, avgLatency: 0 } };
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<StudyEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries] = useState<StudyLogEntry[]>(() => loadStudyHistory());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Counts
  const approved = entries.filter(e => e.watch.verdict === 'APPROVED').length;
  const human = entries.filter(e => e.watch.verdict === 'HUMAN').length;
  const recycle = entries.filter(e => e.watch.verdict === 'RECYCLE').length;

  const submitOne = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const res = await cleanAnalyze(text);
      if (!res.success) {
        setError(res.error || 'Analysis failed');
        return;
      }
      const newEntries: StudyEntry[] = res.watches.map(w => ({
        input: w.input,
        watch: w,
        timestamp: new Date().toISOString(),
      }));
      const all = [...entries, ...newEntries];
      setEntries(all);
      // Auto-select the newest entry
      setSelectedIdx(all.length - newEntries.length);
      setInput('');
      // Save each new entry to permanent storage
      for (const e of newEntries) {
        await saveStudyEntry({ input: e.input, watch: e.watch });
      }
      // Focus back on input for next paste
      inputRef.current?.focus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [input, entries]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitOne();
    }
  }, [submitOne]);

  const clearAll = useCallback(() => {
    setEntries([]);
    setSelectedIdx(null);
    setError(null);
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      if (selectedIdx !== null) {
        if (next.length === 0) setSelectedIdx(null);
        else if (selectedIdx >= next.length) setSelectedIdx(next.length - 1);
        else if (selectedIdx === idx) setSelectedIdx(Math.min(idx, next.length - 1));
        else if (selectedIdx > idx) setSelectedIdx(selectedIdx - 1);
      }
      return next;
    });
  }, [selectedIdx]);

  const selectedEntry = selectedIdx !== null ? entries[selectedIdx] : null;

  return (
    <Layout {...stats}>
      <TabNav totalProcessed={stats.totalProcessed} />

      <div className="max-w-6xl mx-auto px-5 py-8">
        {/* ═══ HEADER ═══ */}
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <BookOpen size={22} className="text-gold-primary" />
            Study · Step-by-Step Analysis
          </h1>
          <p className="text-sm text-text-muted mt-1 max-w-2xl">
            Paste one watch description at a time. Watch the full pipeline unfold — 
            <span className="text-text-secondary"> Parse → AI → Online → Image → Verdict</span> — 
            and see exactly where it lands.
          </p>
        </div>

        <div className="flex gap-6">
          {/* ═══ LEFT: INPUT + HISTORY ═══ */}
          <div className="w-full md:w-[380px] flex-shrink-0 space-y-4">
            {/* Input */}
            <div className="rounded-xl border border-border-default bg-bg-card p-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste ONE watch description here… e.g.&#10;5712/1A Blue 850k HKD"
                rows={4}
                className="w-full bg-bg-elevated/50 border border-border-default rounded-lg p-3 text-sm text-text-primary placeholder:text-text-muted/40 font-mono resize-y focus:outline-none focus:border-gold-primary/50"
              />
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => setInput(SAMPLE)}
                  className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
                >
                  Load sample
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={submitOne}
                    disabled={loading || !input.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-primary text-bg-primary text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {loading ? 'Running pipeline…' : 'Analyze'}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-text-muted/50 mt-2">
                Ctrl+Enter to submit · Paste one at a time to study each result
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            {/* History toggle */}
            {historyEntries.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border-default bg-bg-card hover:bg-bg-elevated/50 transition-colors text-left"
              >
                <History size={14} className="text-gold-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-text-primary flex-1">Study History</span>
                <span className="text-[9px] bg-bg-elevated text-text-muted rounded-full px-2 py-0.5">{historyEntries.length}</span>
                <Clock size={14} className="text-text-muted" />
              </button>
            )}

            {/* History panel */}
            {showHistory && historyEntries.length > 0 && (
              <div className="rounded-xl border border-border-default bg-bg-card max-h-[300px] overflow-y-auto">
                {historyEntries.slice().reverse().slice(0, 100).map((h, i) => {
                  const vColor = h.verdict === 'APPROVED' ? 'text-emerald-400' : h.verdict === 'HUMAN' ? 'text-amber-400' : 'text-red-400';
                  return (
                    <div key={i} className="flex items-center gap-2 px-4 py-2 border-b border-border-default/50 text-xs">
                      <span className={`text-[10px] font-bold ${vColor} w-16`}>{h.verdict}</span>
                      <span className="font-mono text-text-primary truncate flex-1">{h.reference || h.brand || h.input.slice(0, 30)}</span>
                      <span className="text-text-muted">{h.confidence}%</span>
                      <span className="text-[9px] text-text-muted">{new Date(h.ts).toLocaleDateString()}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* History Counter */}
            {entries.length > 0 && (
              <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
                <div className="px-4 py-2.5 bg-bg-elevated/30 border-b border-border-default flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={14} className="text-gold-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Study List</span>
                    <span className="text-[9px] bg-bg-elevated text-text-muted rounded-full px-2 py-0.5">{entries.length}</span>
                  </div>
                  <button
                    onClick={clearAll}
                    className="text-[10px] text-text-muted hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                </div>

                {/* Verdict counts */}
                <div className="px-4 py-2 flex gap-2 border-b border-border-default bg-bg-elevated/20">
                  {[
                    { label: 'Approved', count: approved, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                    { label: 'Human', count: human, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                    { label: 'Recycle', count: recycle, color: 'text-red-400', bg: 'bg-red-500/10' },
                  ].map(s => (
                    <div key={s.label} className={`flex-1 rounded-lg ${s.bg} px-2 py-1.5 text-center`}>
                      <div className={`text-sm font-extrabold ${s.color}`}>{s.count}</div>
                      <div className="text-[8px] uppercase tracking-wider text-text-muted">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Entry list */}
                <div className="max-h-[400px] overflow-y-auto">
                  {[...entries].reverse().map((entry, revIdx) => {
                    const realIdx = entries.length - 1 - revIdx;
                    const vm = VERDICT_META[entry.watch.verdict] || VERDICT_META.RECYCLE;
                    const isSelected = selectedIdx === realIdx;
                    return (
                      <div
                        key={realIdx}
                        onClick={() => setSelectedIdx(realIdx)}
                        className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer border-b border-border-default/50 transition-colors ${
                          isSelected
                            ? 'bg-gold-primary/10 border-l-2 border-l-gold-primary'
                            : 'hover:bg-bg-elevated/50 border-l-2 border-l-transparent'
                        }`}
                      >
                        <vm.icon size={14} className={`${vm.color} flex-shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-mono text-text-primary truncate">
                            {entry.watch.parsed.reference || entry.watch.parsed.brand || 'Unidentified'}
                          </div>
                          <div className="text-[10px] text-text-muted truncate">{entry.input.slice(0, 60)}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-bold ${vm.color}`}>{entry.watch.confidence}%</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeEntry(realIdx); }}
                            className="text-text-muted hover:text-red-400 transition-colors p-0.5"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ═══ RIGHT: DETAILED RESULT ═══ */}
          <div className="flex-1 min-w-0">
            {selectedEntry ? (
              <div className="space-y-3">
                {selectedIdx !== null && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted font-mono">
                        Entry {selectedIdx! + 1} of {entries.length}
                      </span>
                      <span className="text-[10px] text-text-muted bg-bg-elevated rounded px-1.5 py-0.5">
                        {new Date(selectedEntry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedIdx(Math.max(0, (selectedIdx ?? 0) - 1))}
                        disabled={selectedIdx === 0}
                        className="px-2 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                      >
                        ← Prev
                      </button>
                      <button
                        onClick={() => setSelectedIdx(Math.min(entries.length - 1, (selectedIdx ?? 0) + 1))}
                        disabled={selectedIdx === entries.length - 1}
                        className="px-2 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
                <WatchResultCard entry={selectedEntry} />
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <Laptop size={48} className="text-text-muted/20 mx-auto mb-4" />
                  <p className="text-sm text-text-muted">
                    Paste a watch description on the left and click <strong className="text-gold-primary">Analyze</strong>.
                    Each result shows the full pipeline stage-by-stage.
                  </p>
                  <p className="text-xs text-text-muted/50 mt-2">
                    Keep pasting to build a study list. Click any entry to inspect its breakdown.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
