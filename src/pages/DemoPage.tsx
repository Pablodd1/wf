import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import {
  FlaskConical, Search, BookOpen, Activity, Gavel, TrendingUp,
  ChevronDown, ChevronUp, Loader2, Trash2, Zap, AlertTriangle,
  Brain, Edit3, Check, X as XIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParseResult {
  index: number;
  brand: string;
  reference: string | null;
  verdict: 'APPROVED' | 'REVIEW' | 'HUMAN' | 'RECYCLE';
  confidence: number;
  priceUSD: number | null;
  currency: string | null;
  source: 'llm' | 'regex';
}

interface IngestResponse {
  success: boolean;
  split: boolean;
  listingsFound: number;
  persisted: number;
  results: ParseResult[];
  source: 'llm' | 'regex';
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Example quick-fill messages                                        */
/* ------------------------------------------------------------------ */

const EXAMPLES = [
  'Rolex 126610LV Starbucks N8/2024 HKD88000',
  'PP 5711/1A-018 tiffany box paper 2021 USD250000',
  'AP 26240ST blue jub N5 305000hkd',
  'Lange 236.049 new full set HKD230000',
];

/* ------------------------------------------------------------------ */
/*  Confidence bar colour                                              */
/* ------------------------------------------------------------------ */

function confidenceColor(score: number): string {
  if (score >= 100) return '#22c55e';
  if (score >= 80)  return '#eab308';
  if (score >= 60)  return '#f97316';
  return '#ef4444';
}

function confidenceLabel(score: number): string {
  if (score >= 100) return 'text-green-400';
  if (score >= 80)  return 'text-yellow-400';
  if (score >= 60)  return 'text-orange-400';
  return 'text-red-400';
}

/* ------------------------------------------------------------------ */
/*  Verdict badge                                                      */
/* ------------------------------------------------------------------ */

function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, string> = {
    APPROVED: 'bg-green-500/20 text-green-400 border-green-500/40',
    REVIEW:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    HUMAN:    'bg-orange-500/20 text-orange-400 border-orange-500/40',
    RECYCLE:  'bg-red-500/20 text-red-400 border-red-500/40',
  };
  const cls = map[verdict] ?? 'bg-gray-700 text-gray-300 border-gray-600';
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold border uppercase tracking-widest ${cls}`}>
      {verdict}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage Card wrapper                                                 */
/* ------------------------------------------------------------------ */

function StageCard({
  number, title, icon: Icon, children,
}: {
  number: number; title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 mb-3 border border-gray-700">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-xs font-bold text-yellow-400">
          {number}
        </div>
        <Icon size={15} className="text-yellow-400" />
        <span className="text-xs font-bold uppercase tracking-widest text-gray-300">{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Field row                                                          */
/* ------------------------------------------------------------------ */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1 border-b border-gray-700/50 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-gray-500 shrink-0 w-32">{label}</span>
      <span className="text-sm text-white text-right font-medium">{value ?? <span className="text-gray-600 italic text-xs">—</span>}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editable Field                                                     */
/* ------------------------------------------------------------------ */

function EditableField({
  label, value, onSave,
}: {
  label: string; value: string; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function handleSave() {
    onSave(draft);
    setEditing(false);
  }

  function handleCancel() {
    setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between py-1 border-b border-gray-700/50 last:border-0 group">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 shrink-0 w-32">{label}</span>
        <span className="text-sm text-white text-right font-medium flex items-center gap-2">
          {value || <span className="text-gray-600 italic text-xs">—</span>}
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-yellow-400 hover:text-yellow-300"
            title={`Edit ${label}`}
          >
            <Edit3 size={12} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between py-1 border-b border-gray-700/50 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-gray-500 shrink-0 w-32">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="bg-gray-900 border border-gray-600 rounded px-2 py-0.5 text-sm text-white w-32 text-right font-mono"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
        />
        <button onClick={handleSave} className="text-green-400 hover:text-green-300" title="Save">
          <Check size={14} />
        </button>
        <button onClick={handleCancel} className="text-red-400 hover:text-red-300" title="Cancel">
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible JSON viewer                                            */
/* ------------------------------------------------------------------ */

function JsonViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-xl border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 transition-colors text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Raw API Response
        </span>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>
      {open && (
        <pre className="bg-gray-950 text-green-400 text-xs font-mono p-4 overflow-x-auto max-h-80 overflow-y-auto leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HUMAN Alert Banner                                                 */
/* ------------------------------------------------------------------ */

function HumanAlert({ result, onAiReAnalyze }: {
  result: ParseResult;
  onAiReAnalyze: () => void;
}) {
  if (result.verdict !== 'HUMAN') return null;

  return (
    <div className="mb-4 rounded-xl border-2 border-orange-500/50 bg-orange-500/10 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <AlertTriangle size={20} className="text-orange-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-orange-400 mb-1 uppercase tracking-wider">
            ⚠ Human Review Required
          </div>
          <p className="text-xs text-orange-300/80 mb-3">
            Low confidence ({result.confidence}%) — the parser could not fully identify this listing.
            Review the extracted fields below, edit if needed, or use AI to re-analyze.
          </p>
          <button
            onClick={onAiReAnalyze}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-400 text-gray-900 font-bold text-xs rounded-lg transition-colors"
          >
            <Brain size={14} />
            AI Re-Analyze
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Insight Panel (re-analysis result)                              */
/* ------------------------------------------------------------------ */

function AiInsightPanel({ result, onClose }: {
  result: { brand?: string; reference?: string; price?: number; currency?: string } | null;
  onClose: () => void;
}) {
  if (!result) return null;
  return (
    <div className="mb-4 rounded-xl bg-purple-500/10 border border-purple-500/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-widest text-purple-400">🤖 AI Insight</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">Dismiss</button>
      </div>
      <div className="space-y-1 text-xs text-purple-300">
        {result.brand && <div>Brand: <strong className="text-white">{result.brand}</strong></div>}
        {result.reference && <div>Reference: <strong className="text-white">{result.reference}</strong></div>}
        {result.price != null && <div>Price: <strong className="text-white">${result.price.toLocaleString()} {result.currency || 'USD'}</strong></div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline display for one result                                    */
/* ------------------------------------------------------------------ */

function PipelineResult({
  result, index, onUpdateResult, rawMessage,
}: {
  result: ParseResult; index: number;
  onUpdateResult?: (idx: number, updated: Partial<ParseResult>) => void;
  rawMessage?: string;
}) {
  const score = result.confidence ?? 0;
  const [aiInsight, setAiInsight] = useState<{ brand?: string; reference?: string; price?: number; currency?: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function handleAiReAnalyze() {
    setAiLoading(true);
    setAiInsight(null);
    try {
      // Use the same ingest endpoint — re-parse with LLM focus on this specific listing
      const res = await fetch('/api/ai-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawMessage: rawMessage || result.reference || result.brand,
          brand: result.brand,
          reference: result.reference,
          priceUSD: result.priceUSD,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.brand || data.reference) {
          setAiInsight(data);
          // Auto-update the fields with AI's suggestions
          if (data.brand && data.brand !== result.brand) onUpdateResult?.(index, { brand: data.brand });
          if (data.reference && data.reference !== result.reference) onUpdateResult?.(index, { reference: data.reference });
        }
      }
    } catch {} finally {
      setAiLoading(false);
    }
  }

  function handleEdit(field: string, value: string) {
    if (!onUpdateResult) return;
    onUpdateResult(index, { [field]: value } as Partial<ParseResult>);
  }

  return (
    <div className="mb-6">
      {index > 0 && (
        <div className="flex items-center gap-2 mb-4 mt-2">
          <div className="h-px flex-1 bg-gray-700" />
          <span className="text-[10px] uppercase tracking-widest text-gray-600 px-2">Listing #{index + 1}</span>
          <div className="h-px flex-1 bg-gray-700" />
        </div>
      )}

      {/* HUMAN alert */}
      <HumanAlert result={result} onAiReAnalyze={handleAiReAnalyze} />

      {/* AI Insight result */}
      {aiInsight && <AiInsightPanel result={aiInsight} onClose={() => setAiInsight(null)} />}

      {/* Stage 1: PARSE */}
      <StageCard number={1} title="Parse" icon={Search}>
        <EditableField label="Brand" value={result.brand !== 'Unknown' ? result.brand : ''} onSave={v => handleEdit('brand', v)} />
        <EditableField label="Reference" value={result.reference || ''} onSave={v => handleEdit('reference', v)} />
        <EditableField
          label="Price"
          value={result.priceUSD != null ? `$${result.priceUSD.toLocaleString()}` : ''}
          onSave={v => handleEdit('priceUSD', v.replace(/[$,]/g, ''))}
        />
        <Field label="Currency" value={result.currency} />
        <Field label="Source" value={
          <span className={`text-xs px-2 py-0.5 rounded ${result.source === 'llm' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
            {result.source === 'llm' ? '🤖 LLM' : '⚡ Regex'}
          </span>
        } />
      </StageCard>

      {/* Stage 2: CATALOG */}
      <StageCard number={2} title="Catalog Match" icon={BookOpen}>
        <Field
          label="Match Found"
          value={
            result.reference ? (
              <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Yes — ref extracted</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">No reference</span>
            )
          }
        />
        <Field label="Brand" value={result.brand !== 'Unknown' ? result.brand : null} />
        <Field label="Reference" value={result.reference} />
      </StageCard>

      {/* Stage 3: CONFIDENCE */}
      <StageCard number={3} title="Confidence Score" icon={Activity}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-2xl font-extrabold ${confidenceLabel(score)}`}>{score}%</span>
          <span className="text-xs text-gray-500">
            {score >= 100 ? 'Excellent' : score >= 80 ? 'Good' : score >= 60 ? 'Fair' : 'Low'}
          </span>
        </div>
        <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(score, 100)}%`,
              backgroundColor: confidenceColor(score),
            }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-gray-600">0</span>
          <span className="text-[10px] text-gray-600">50</span>
          <span className="text-[10px] text-gray-600">100</span>
        </div>
      </StageCard>

      {/* Stage 4: VERDICT */}
      <StageCard number={4} title="Verdict" icon={Gavel}>
        <div className="flex items-center justify-between">
          <div>
            <VerdictBadge verdict={result.verdict} />
            <p className="text-xs text-gray-500 mt-2">
              {result.verdict === 'APPROVED' && 'High confidence — ready to list.'}
              {result.verdict === 'REVIEW'   && 'Moderate confidence — manual review suggested.'}
              {result.verdict === 'HUMAN'    && 'Low confidence — human verification required.'}
              {result.verdict === 'RECYCLE'  && 'Very low confidence — message discarded.'}
            </p>
          </div>
        </div>
      </StageCard>

      {/* Stage 5: ENRICHMENT */}
      <StageCard number={5} title="Enrichment" icon={TrendingUp}>
        <div className="text-xs text-gray-500 italic">
          {result.priceUSD ? (
            <div className="space-y-1">
              <Field label="Parsed USD" value={`$${result.priceUSD.toLocaleString()}`} />
              <Field label="Chrono24 Data" value={
                <span className="text-gray-600 text-xs">Live data available on deployed env</span>
              } />
            </div>
          ) : (
            <span>No price data — enrichment unavailable.</span>
          )}
        </div>
      </StageCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Demo Page                                                     */
/* ------------------------------------------------------------------ */

export default function DemoPage() {
  const [message, setMessage]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [response, setResponse]   = useState<IngestResponse | null>(null);
  const [error, setError]         = useState<string | null>(null);

  async function handleAnalyze() {
    const text = message.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawMessage: text, source: 'demo' }),
      });
      const data: IngestResponse = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResponse(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setMessage('');
    setResponse(null);
    setError(null);
  }

  function handleUpdateResult(idx: number, updated: Partial<ParseResult>) {
    if (!response) return;
    const newResults = [...response.results];
    newResults[idx] = { ...newResults[idx], ...updated };
    setResponse({ ...response, results: newResults });
  }

  return (
    <Layout>
      <TabNav />

      <div className="min-h-screen bg-gray-900 text-white px-4 py-8 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center">
            <FlaskConical size={20} className="text-yellow-400" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Pipeline Demo</h1>
            <p className="text-xs text-gray-500">Paste a WhatsApp dealer message and run the full parse pipeline</p>
          </div>
        </div>

        {/* Example chips */}
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Quick examples</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setMessage(ex)}
                className="text-[11px] bg-gray-800 border border-gray-700 hover:border-yellow-500/60 hover:text-yellow-300 text-gray-400 rounded-full px-3 py-1 transition-colors truncate max-w-[260px]"
                title={ex}
              >
                {ex.length > 40 ? ex.slice(0, 38) + '…' : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Paste WhatsApp message here..."
          rows={5}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm text-white placeholder-gray-600 resize-y focus:outline-none focus:border-yellow-500/60 transition-colors font-mono leading-relaxed mb-4"
        />

        {/* Action buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleAnalyze}
            disabled={loading || !message.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-900 font-bold text-sm rounded-xl transition-colors"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Zap size={15} />
            )}
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white font-semibold text-sm rounded-xl transition-colors"
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 text-sm text-red-400">
            ❌ {error}
          </div>
        )}

        {/* Bundle hint */}
        {response?.split && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 mb-4 text-xs text-blue-300 flex items-center gap-2">
            <Zap size={14} />
            Multi-watch bundle detected — {response.listingsFound} listings extracted
          </div>
        )}

        {/* Results */}
        {response && (
          <div>
            {/* Summary banner */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4 flex items-center justify-between">
              <div className="text-sm">
                <span className="font-bold text-white">{response.listingsFound}</span>
                <span className="text-gray-400"> listing{response.listingsFound !== 1 ? 's' : ''} found</span>
                {response.split && (
                  <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">
                    multi-message split
                  </span>
                )}
              </div>
              <span className={`text-xs px-2 py-1 rounded border ${
                response.source === 'llm'
                  ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                  : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              }`}>
                {response.source === 'llm' ? '🤖 LLM assisted' : '⚡ Regex engine'}
              </span>
            </div>

            {/* Per-listing pipeline stages */}
            {response.results.map((result, i) => (
              <PipelineResult key={result.index} result={result} index={i} onUpdateResult={handleUpdateResult} rawMessage={message} />
            ))}

            {/* Raw JSON viewer */}
            <JsonViewer data={response} />
          </div>
        )}
      </div>
    </Layout>
  );
}
