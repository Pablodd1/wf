import { useState, useCallback, useMemo } from 'react';
import {
  Brain,
  Save, RefreshCw, X, CheckCircle2,
  Wand2, Database, Layers, Activity,
} from 'lucide-react';
import {
  computeFeatureScores, scoreColors,
  FEATURE_LABELS, type CatalogComparison, type FeatureScores,
} from '@/types/catalog';

// Re-export for backward compat
export { computeFeatureScores, FEATURE_LABELS, scoreColors };
export type { CatalogComparison, FeatureScores };

// ── Re-launched record after human edits ──────────────────────────────────
interface EditedRecord {
  brand: string;
  reference: string;
  dialColor: string;
  condition: string;
  price: number;
  currency: string;
  year: number | null;
  notes?: string;
}

interface ParseResult {
  brand?: string;
  reference?: string;
  dialColor?: string;
  condition?: string;
  price?: number;
  currency?: string;
  year?: number | null;
  verdict?: string;
  confidence?: number;
  rawMessage?: string;
  [key: string]: unknown;
}

interface Props {
  result: ParseResult | null;
  onRelaunch: (edited: EditedRecord) => Promise<void>;
  onAIReview: (msg: string) => Promise<any>;
  onClose: () => void;
  catalogs: CatalogComparison;
}



// ── AI co-pilot panel for records the parser can't handle ─────────────────
function AICopilot({
  rawMessage,
  onSuggest,
  onClose,
  onAIReview,
}: {
  rawMessage: string;
  onSuggest: (parsed: any) => void;
  onClose: () => void;
  onAIReview: (msg: string) => Promise<any>;
}) {
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const askCoPilot = useCallback(async () => {
    setThinking(true);
    setHint(null);
    try {
      const parsed = await onAIReview(rawMessage);
      if (parsed) {
        const display = JSON.stringify(parsed, null, 2);
        setHint(display);
        onSuggest(parsed);
      }
    } catch (e: any) {
      setHint(`Error: ${e.message}`);
    } finally {
      setThinking(false);
    }
  }, [rawMessage, onAIReview, onSuggest]);

  return (
    <div className="rounded-lg p-3 mt-3" style={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-bold text-purple-300">AI CO-PILOT (GPT-4o-mini)</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-2">
        The parser couldn't fully understand this. Let GPT-4o-mini analyze it and suggest fields for you to confirm.
      </p>
      <button
        onClick={askCoPilot}
        disabled={thinking}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
        style={{ backgroundColor: '#581c87', color: '#e9d5ff' }}
      >
        {thinking ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="animate-spin w-3 h-3 border-2 rounded-full inline-block" style={{ borderColor: '#e9d5ff', borderTopColor: 'transparent' }} />
            Analyzing...
          </span>
        ) : (
          <><Brain className="inline w-3 h-3 mr-1" />Ask AI to interpret</>
        )}
      </button>
      {hint && (
        <pre className="mt-3 p-2 rounded text-[10px] font-mono overflow-x-auto whitespace-pre-wrap" style={{ backgroundColor: '#020617', color: '#a5b4fc' }}>
          {hint}
        </pre>
      )}
    </div>
  );
}

// ── Editable fields panel for human-in-the-loop ───────────────────────────
function EditFields({
  initial,
  onSave,
  onCancel,
  aiSuggestion,
}: {
  result: any;
  initial: EditedRecord;
  onSave: (r: EditedRecord) => void;
  onCancel: () => void;
  aiSuggestion?: any;
}) {
  const [edit, setEdit] = useState<EditedRecord>(initial);

  const upd = (k: keyof EditedRecord, v: any) => setEdit(prev => ({ ...prev, [k]: v }));

  // Apply AI suggestion to all fields
  const applyAI = () => {
    if (!aiSuggestion) return;
    const updated: any = { ...edit };
    if (aiSuggestion.brand) updated.brand = aiSuggestion.brand;
    if (aiSuggestion.reference) updated.reference = aiSuggestion.reference;
    if (aiSuggestion.dialColor) updated.dialColor = aiSuggestion.dialColor;
    if (aiSuggestion.condition) updated.condition = aiSuggestion.condition;
    if (aiSuggestion.price) updated.price = Number(aiSuggestion.price);
    if (aiSuggestion.currency) updated.currency = aiSuggestion.currency;
    if (aiSuggestion.year) updated.year = Number(aiSuggestion.year);
    setEdit(updated);
  };

  const fieldClass = "w-full px-2 py-1.5 rounded text-xs font-mono outline-none";
  const fieldStyle = { backgroundColor: '#0a0a0a', color: '#e8e8e8', border: '1px solid #333' };

  return (
    <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: '#111', border: '1px solid #333' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Save className="w-3.5 h-3.5 text-yellow-400" />
          <span className="text-xs font-bold text-yellow-300">EDIT FIELDS — then re-launch</span>
        </div>
        <div className="flex gap-2">
          {aiSuggestion && (
            <button onClick={applyAI} className="text-[10px] px-2 py-1 rounded font-semibold" style={{ backgroundColor: '#581c87', color: '#e9d5ff' }}>
              Apply AI Suggestion
            </button>
          )}
          <button onClick={onCancel} className="text-[10px] px-2 py-1 rounded text-gray-400 hover:text-white">
            Cancel
          </button>
          <button onClick={() => onSave(edit)} className="text-[10px] px-2 py-1 rounded font-bold" style={{ backgroundColor: '#d4af37', color: '#050505' }}>
            Save + Re-launch →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Brand</label>
          <input value={edit.brand} onChange={e => upd('brand', e.target.value)} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Reference</label>
          <input value={edit.reference} onChange={e => upd('reference', e.target.value.toUpperCase())} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Dial</label>
          <input value={edit.dialColor} onChange={e => upd('dialColor', e.target.value)} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Condition</label>
          <input value={edit.condition} onChange={e => upd('condition', e.target.value)} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Price</label>
          <input type="number" value={edit.price} onChange={e => upd('price', Number(e.target.value))} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Currency</label>
          <input value={edit.currency} onChange={e => upd('currency', e.target.value.toUpperCase())} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Year</label>
          <input type="number" value={edit.year || ''} onChange={e => upd('year', e.target.value ? Number(e.target.value) : null)} className={fieldClass} style={fieldStyle} />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wide text-gray-500">Notes</label>
          <input value={edit.notes || ''} onChange={e => upd('notes', e.target.value)} className={fieldClass} style={fieldStyle} placeholder="optional" />
        </div>
      </div>
    </div>
  );
}

// ── 3-catalog comparison view ──────────────────────────────────────────────
function CatalogComparisonView({ catalogs }: { catalogs: CatalogComparison }) {
  const rows = [
    {
      icon: Database, color: '#22c55e', name: catalogs.internal.name,
      field1: catalogs.internal.hit ? `✓ ${catalogs.internal.brand}` : '— no match',
      field2: catalogs.internal.model || '—',
      field3: catalogs.internal.collection || '—',
      field4: `${catalogs.internal.size} total refs`,
      hit: catalogs.internal.hit,
    },
    {
      icon: Brain, color: '#a855f7', name: catalogs.llm.name,
      field1: catalogs.llm.brand ? `${catalogs.llm.brand}` : '—',
      field2: catalogs.llm.reference ? `${catalogs.llm.reference}` : '—',
      field3: catalogs.llm.model || '—',
      field4: `${Math.round(catalogs.llm.confidence * 100)}% confidence`,
      hit: catalogs.llm.confidence >= 0.7,
    },
    {
      icon: Layers, color: '#60a5fa', name: catalogs.dataset.name,
      field1: catalogs.dataset.sampleCount ? `${catalogs.dataset.sampleCount} similar` : '— unique',
      field2: catalogs.dataset.avgPrice ? `$${catalogs.dataset.avgPrice.toLocaleString()}` : '—',
      field3: catalogs.dataset.commonDial || '—',
      field4: catalogs.dataset.maxPrice ? `max $${catalogs.dataset.maxPrice.toLocaleString()}` : '—',
      hit: catalogs.dataset.sampleCount > 0,
    },
  ];

  return (
    <div className="rounded-lg p-3 mt-3" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f' }}>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-bold text-blue-300">3-CATALOG COMPARISON</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <div key={i} className="flex items-center gap-2 p-2 rounded" style={{ backgroundColor: '#111', border: `1px solid ${r.hit ? r.color + '44' : '#222'}` }}>
              <Icon className="w-4 h-4 shrink-0" style={{ color: r.color }} />
              <div className="flex-1 grid grid-cols-4 gap-2 text-[11px]">
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">Source</div>
                  <div className="font-semibold" style={{ color: r.color }}>{r.name}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">Brand/Ref</div>
                  <div className="font-mono truncate" style={{ color: r.hit ? '#e8e8e8' : '#666' }}>{r.field1}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">Model</div>
                  <div className="truncate" style={{ color: r.hit ? '#e8e8e8' : '#666' }}>{r.field2}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">Context</div>
                  <div className="truncate" style={{ color: '#888' }}>{r.field4}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-feature confidence 1-10 grid ──────────────────────────────────────
function FeatureScoreGrid({ scores }: { scores: FeatureScores }) {
  const features = (Object.keys(FEATURE_LABELS) as Array<keyof FeatureScores>).filter(k => k !== 'overall');
  return (
    <div className="rounded-lg p-3 mt-3" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f' }}>
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4 text-yellow-400" />
        <span className="text-xs font-bold text-yellow-300">PER-FEATURE CONFIDENCE (1-10)</span>
        <span className="ml-auto text-xs font-mono" style={{ color: scoreColors(scores.overall).fg }}>
          OVERALL: {scores.overall}/10 {scoreColors(scores.overall).label}
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {features.map(k => {
          const v = scores[k];
          const c = scoreColors(v);
          return (
            <div key={k} className="p-2 rounded text-center" style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }}>
              <div className="text-[9px] uppercase tracking-wide truncate" style={{ color: '#aaa' }}>{FEATURE_LABELS[k]}</div>
              <div className="text-base font-bold font-mono" style={{ color: c.fg }}>{v}</div>
              <div className="text-[8px]" style={{ color: c.fg }}>{c.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main TestModePanel ────────────────────────────────────────────────────
export default function TestModePanel(props: Props) {
  const { result, onRelaunch, onAIReview, onClose, catalogs } = props;
  const [editing, setEditing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<Record<string, string | undefined> | null>(null);
  const [showCopilot, setShowCopilot] = useState(false);


  const initial: EditedRecord = useMemo(() => ({
    brand: result?.brand || 'Unknown',
    reference: result?.reference || '',
    dialColor: result?.dialColor || 'UNKNOWN',
    condition: result?.condition || 'Unknown',
    price: result?.price || 0,
    currency: result?.currency || '',
    year: result?.year || null,
    notes: '',
  }), [result]);

  const scores = useMemo(() => computeFeatureScores(result, catalogs), [result, catalogs]);

  const handleSave = useCallback(async (edited: EditedRecord) => {
    await onRelaunch(edited);
    setEditing(false);
  }, [onRelaunch]);

  const handleAISuggest = useCallback((parsed: Record<string, string | undefined>) => {
    setAiSuggestion(parsed);
  }, []);

  const relaunch = useCallback(async () => {
    await onRelaunch(initial);
  }, [onRelaunch, initial]);

  if (!result) return null;

  // Don't show this panel for already-approved records (unless manually opened)
  const verdictColor = result.verdict === 'APPROVED' || result.verdict === 'AUTO_APPROVED'
    ? '#22c55e' : result.verdict === 'RECYCLE' ? '#ef4444' : '#eab308';
  const verdictLabel = result.verdict === 'AUTO_APPROVED' ? 'APPROVED' : result.verdict;

  return (
    <div className="rounded-xl p-4 my-3" style={{ backgroundColor: '#050505', border: `1px solid ${verdictColor}66` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: `${verdictColor}22`, color: verdictColor, border: `1px solid ${verdictColor}66` }}>
            {verdictLabel}
          </div>
          <span className="text-xs text-gray-400">Confidence: <span className="font-mono font-bold" style={{ color: verdictColor }}>{result.confidence}%</span></span>
          <span className="text-xs text-gray-500 truncate max-w-[300px]" title={result.rawMessage || ''}>
            "{(result.rawMessage || '').slice(0, 80)}{(result.rawMessage || '').length > 80 ? '...' : ''}"
          </span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <FeatureScoreGrid scores={scores} />
      <CatalogComparisonView catalogs={catalogs} />

      {/* Action panel — only show for non-APPROVED verdicts OR if user wants to refine */}
      {(result.verdict !== 'APPROVED' && result.verdict !== 'AUTO_APPROVED') || editing ? (
        <div className="mt-3">
          {!editing ? (
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => setEditing(true)}
                className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ backgroundColor: '#422006', color: '#eab308', border: '1px solid #854d0e' }}>
                <Save className="w-3.5 h-3.5" /> Edit fields + Re-launch
              </button>
              <button onClick={() => setShowCopilot(s => !s)}
                className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ backgroundColor: '#1e1b4b', color: '#a5b4fc', border: '1px solid #312e81' }}>
                <Wand2 className="w-3.5 h-3.5" /> {showCopilot ? 'Hide AI Co-pilot' : 'Ask AI Co-pilot'}
              </button>
              <button onClick={relaunch}
                className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ backgroundColor: '#0f172a', color: '#60a5fa', border: '1px solid #1e3a5f' }}>
                <RefreshCw className="w-3.5 h-3.5" /> Just Re-launch
              </button>
              <div className="ml-auto text-[10px] text-gray-500 italic">
                ↻ Loop back to initial pipeline after edits
              </div>
            </div>
          ) : (
            <EditFields
              result={result}
              initial={initial}
              onSave={handleSave}
              onCancel={() => setEditing(false)}
              aiSuggestion={aiSuggestion}
            />
          )}

          {showCopilot && !editing && (
            <AICopilot
              rawMessage={result.rawMessage || ''}
              onSuggest={handleAISuggest}
              onClose={() => setShowCopilot(false)}
              onAIReview={onAIReview}
            />
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: '#22c55e' }}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Record approved at {result.confidence}% — no human review needed.</span>
        </div>
      )}
    </div>
  );
}
