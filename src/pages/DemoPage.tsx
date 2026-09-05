import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { parseWatch, getVerdict } from '@/utils/parseEngine';
import type { ParsedWatch } from '@/utils/parseEngine';
import { Download, Brain, Eye, CheckCircle2, ChevronDown, ChevronUp, Trash2, AlertTriangle, Search, FileSpreadsheet, Upload, Image as ImageIcon, MessageSquare, Sparkles, Layers, TestTube2, Activity } from 'lucide-react';
import TestModePanel, { computeFeatureScores } from '@/components/TestModePanel';

const BATCH_WARN = 100;
const BATCH_MAX_RENDER = 100;
const MAX_WATCHES_PER_REQUEST = 100;
const CHUNK_SIZE = 25;          // watches per API call (parallel-batchable)
const PROVIDERS = ['auto', 'claude', 'openai', 'gemini', 'deepseek', 'kimi'] as const;
type Provider = typeof PROVIDERS[number];

// ── Stage type mirrors what the API returns per watch ────────────────────────
type Stage = {
  stage: 'PARSE' | 'AI_TEXT' | 'ONLINE' | 'IMAGE';
  engine: string;
  confidence: number;
  data?: any;
  note?: string;
  error?: string;
  verdict?: string;
};

type PipelineResult = {
  input: string;
  parsed: ParsedWatch;
  confidence: number;
  verdict: 'APPROVED' | 'HUMAN' | 'RECYCLE';
  reason: string;
  hasImage?: boolean;
  hasLink?: boolean;
  imageUrl?: string | null;
  pageUrl?: string | null;
  stages: Stage[];
};

// ── Enriched UI result ───────────────────────────────────────────────────────
type EnrichedResult = ParsedWatch & {
  verdict: string;
  aiSuggestion?: any;
  expanded?: boolean;
  webEnrichment?: any;
  confidenceBoost?: number;
  pipeline?: PipelineResult;
  processing?: boolean;
  persisted?: boolean;     // True once saved to Supabase via /api/persist
  edited?: boolean;         // True if user has manually edited fields
  _autoEdit?: boolean;      // Internal: trigger edit form in TestModePanel
};

// ── Lazy-load SheetJS ────────────────────────────────────────────────────────
async function getXLSX() {
  const mod = await import('xlsx');
  return mod;
}

// ── Excel palette (kept identical to previous export) ────────────────────────
const C = {
  navyBg: { rgb: 'FF1F4E78' },
  navyFg: { rgb: 'FFFFFFFF' },
  green: { rgb: 'FF90EE90' },
  orange: { rgb: 'FFFFA500' },
  red: { rgb: 'FFFF6B6B' },
  white: { rgb: 'FFFFFFFF' },
  lightGrey: { rgb: 'FFF5F5F5' },
  text: { rgb: 'FF1A1A1A' },
};
function border() {
  const b = { style: 'thin', color: { rgb: 'FFDDDDDD' } };
  return { top: b, bottom: b, left: b, right: b };
}
function hCell(v: string) {
  return {
    v, t: 's',
    s: {
      font: { bold: true, color: C.navyFg, sz: 10, name: 'Calibri' },
      fill: { fgColor: C.navyBg, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: border(),
    },
  };
}
function dCell(v: any, bg: any, align = 'left') {
  const isNum = typeof v === 'number';
  return {
    v: v ?? '', t: isNum ? 'n' : 's',
    s: {
      font: { sz: 9, color: C.text, name: 'Calibri' },
      fill: { fgColor: bg, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center', wrapText: false },
      border: border(),
      ...(isNum ? { numFmt: '#,##0' } : {}),
    },
  };
}
function titleCell(v: string) {
  return {
    v, t: 's',
    s: {
      font: { bold: true, sz: 14, color: C.navyBg, name: 'Calibri' },
      alignment: { horizontal: 'left', vertical: 'center' },
    },
  };
}
function verdictBg(v: string) {
  if (v === 'APPROVED' || v === 'AUTO_APPROVED') return C.green;
  if (v === 'RECYCLE') return C.red;
  return C.orange;
}

// ── Input mode tabs ──────────────────────────────────────────────────────────
type InputMode = 'text' | 'images' | 'chat' | 'csv';
const MODE_TABS: { id: InputMode; label: string; icon: any; hint: string }[] = [
  { id: 'text',   label: 'Paste Listings', icon: MessageSquare, hint: 'One watch per line — paste 1, 50, or 100 at once' },
  { id: 'chat',   label: 'Paste Chat Block', icon: Layers,        hint: 'Drop a full WhatsApp export — we split it' },
  { id: 'images', label: 'Image URLs',      icon: ImageIcon,     hint: 'Comma- or newline-separated image URLs (vision verify)' },
  { id: 'csv',    label: 'Catalog CSV',     icon: FileSpreadsheet, hint: 'Paste catalog CSV: Brand,Model,Reference,Dial Color — expands enriched_refs.json' },
];

// ── Component ────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [input, setInput] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [results, setResults] = useState<EnrichedResult[]>([]);
  const [provider, setProvider] = useState<Provider>('auto');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [aiLoading, setAiLoading] = useState<Set<string>>(new Set());
  const [webLoading, setWebLoading] = useState<Set<string>>(new Set());
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [testMode, setTestMode] = useState(false);  // OFF by default — show real pipeline results
  const [testModeCache, setTestModeCache] = useState<Record<number, any>>({});  // cached 3-catalog comparison per record
  const [csvStatus, setCsvStatus] = useState<{ stage: string; message: string; added?: number; updated?: number; catalogSize?: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File upload (for chat block mode) ─────────────────────────────────────
  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = String(e.target?.result || '');
      setInput(text);
      setInputMode('chat');
    };
    reader.readAsText(file);
  }, []);

  // ── Main analyze: call /api/clean-analyze ─────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setIsProcessing(true);
    setLastLatencyMs(null);
    const startTs = Date.now();

    // Split text into chunks up-front so we can show progress
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      chunks.push(lines.slice(i, i + CHUNK_SIZE).join('\n'));
    }
    setProgress({ done: 0, total: lines.length });

    // Seed optimistic UI with regex-only results (so cards render immediately)
    const optimistic: EnrichedResult[] = lines.map(line => {
      const p = parseWatch(line);
      return { ...p, verdict: getVerdict(p.confidence), expanded: false, processing: true };
    });
    setResults(optimistic);

    try {
      // Fire all chunks in parallel — server handles its own batch concurrency
      const responses = await Promise.all(
        chunks.map(chunk =>
          fetch('/api/clean-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk, provider }),
          }).then(r => r.json())
        )
      );

      // Stitch the responses back into one flat list in original order
      const flat: PipelineResult[] = [];
      for (const resp of responses) {
        if (resp?.watches) flat.push(...resp.watches);
      }

      // Build the final cards DIRECTLY from the API watches — NOT by zipping
      // against the per-line optimistic array. A single input line can explode
      // into multiple watches (e.g. the "🔥A 🔥B 🔥C" emoji line → 3 watches),
      // so index i in `optimistic` (one per line) does NOT correspond to index i
      // in `flat` (one per watch). Each API watch carries its OWN raw text in
      // `input`/`rawEntry`; that is the authoritative pairing. We re-derive the
      // card's base fields from that exact raw text so the displayed raw and the
      // parsed result always belong to the same watch.
      const enriched: EnrichedResult[] = flat.map((r) => {
        const ownRaw = (r as any).rawEntry || r.input || '';
        const base = parseWatch(ownRaw);   // base parse from THIS watch's own text
        const merged: EnrichedResult = {
          ...base,
          rawMessage: ownRaw,              // display + persist key = this watch's raw
          brand: r.parsed.brand || base.brand,
          reference: r.parsed.reference || base.reference,
          dialColor: r.parsed.dialColor || base.dialColor,
          condition: r.parsed.condition || base.condition,
          year: r.parsed.year ?? base.year,
          price: r.parsed.price ?? base.price,
          currency: r.parsed.currency || base.currency,
          confidence: r.confidence,
          verdict: r.verdict,
          pipeline: r,
          processing: false,
          expanded: r.verdict === 'HUMAN',   // auto-expand so users see the stages
          _aiChangedRef: (r.parsed as any)._aiChangedRef || false,
          _parserRef: (r.parsed as any)._parserRef || null,
        };
        return merged;
      });
      setResults(enriched);
      setLastLatencyMs(Date.now() - startTs);
      setProgress({ done: flat.length, total: flat.length });

      // Auto-persist APPROVED records to Supabase live_ingest
      const approved = enriched.filter(r => r.verdict === 'APPROVED');
      if (approved.length > 0) {
        const persisted = await persistApproved(approved);
        setResults(prev => prev.map((r) => {
          // Match by rawMessage since we iterate in the same order
          const idx = approved.findIndex(a => a.rawMessage === r.rawMessage);
          if (idx >= 0 && persisted[idx]) return { ...r, persisted: true };
          return r;
        }));
      }
    } catch (e: any) {
      console.error('Analyze failed:', e);
      setResults(prev => prev.map(r => ({ ...r, processing: false })));
    } finally {
      setIsProcessing(false);
    }
  }, [input, provider]);

  // ── Persist approved records to Supabase ────────────────────────────────
  const persistApproved = useCallback(async (records: EnrichedResult[]): Promise<boolean[]> => {
    const results: boolean[] = [];
    // Send in batches of 20 (matches clean-analyze batch size)
    for (let i = 0; i < records.length; i += 20) {
      const batch = records.slice(i, i + 20);
      try {
        const resp = await fetch('/api/persist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'reprocess',
            records: batch.map(r => ({
              id: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`,
              brand: r.brand,
              reference: r.reference,
              dial_color: r.dialColor,
              condition: r.condition,
              year: r.year,
              price_raw: r.price,
              price_usd: r.price,  // demo prices assumed USD
              currency: r.currency,
              confidence: r.confidence,
              verdict: r.verdict,
              source: 'demo-ui',
              raw_message: r.rawMessage,
              flags: r.flags || [],
            })),
          }),
        });
        const data = await resp.json();
        const saved = data.saved || 0;
        for (let j = 0; j < batch.length; j++) {
          results.push(j < saved);
        }
      } catch (e) {
        console.error('persist failed:', e);
        for (let j = 0; j < batch.length; j++) results.push(false);
      }
    }
    return results;
  }, []);

  // ── Single-watch web lookup (legacy keep) ──────────────────────────────────
  const handleWebLookup = useCallback(async (idx: number) => {
    const r = results[idx];
    if (!r) return;
    setWebLoading(prev => new Set(prev).add(idx.toString()));
    try {
      // Use new /api/online-search (GPT-4o-mini + structured output)
      // Replaces the broken /api/web-lookup (DDG HTML blocked from Vercel IPs)
      const res = await fetch('/api/online-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: r.reference,
          brand: r.brand !== 'Unknown' ? r.brand : undefined,
          rawMessage: r.rawMessage,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const webConfidence = data.confidence || 70;
        const boost = Math.max(0, webConfidence - r.confidence);
        const newConf = Math.min(100, r.confidence + boost);
        // If web search found valid info, apply it
        const updates: Partial<EnrichedResult> = {
          confidence: newConf,
          verdict: getVerdict(newConf),
          webEnrichment: data,
          confidenceBoost: boost,
        };
        if (data.brand && data.brand !== 'Unknown' && (!r.brand || r.brand === 'Unknown')) {
          updates.brand = data.brand;
        }
        if (data.model && !r.model) {
          updates.model = data.model;
        }
        if (data.dialColors && (r.dialColor === 'UNKNOWN' || !r.dialColor)) {
          updates.dialColor = data.dialColors.split(',')[0].trim();
        }
        setResults(prev => prev.map((item, i) =>
          i === idx ? { ...item, ...updates } : item
        ));
      }
    } catch (e) {
      console.error('Web lookup failed:', e);
    } finally {
      setWebLoading(prev => { const n = new Set(prev); n.delete(idx.toString()); return n; });
    }
  }, [results]);

  const handleAskAI = useCallback(async (idx: number) => {
    const r = results[idx];
    if (!r) return;
    setAiLoading(prev => new Set(prev).add(idx.toString()));
    try {
      const res = await fetch('/api/clean-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: r.rawMessage, provider }),
      });
      const data = await res.json();
      if (data?.watches?.[0]) {
        const w = data.watches[0];
        setResults(prev => prev.map((item, i) =>
          i === idx ? { ...item, confidence: w.confidence, verdict: w.verdict, pipeline: w, aiSuggestion: w.parsed } : item
        ));
      }
    } catch (e) {
      console.error('AI parse failed:', e);
    } finally {
      setAiLoading(prev => { const n = new Set(prev); n.delete(idx.toString()); return n; });
    }
  }, [results, provider]);

  // ── Catalog CSV ingest ────────────────────────────────────────────────────
  // POST a CSV string (Brand,Model,Reference,Dial Color,Image Link) to /api/ingest-catalog
  const handleCsvIngest = useCallback(async () => {
    const csv = input.trim();
    if (!csv) return;
    setIsProcessing(true);
    setCsvStatus({ stage: 'sending', message: 'Posting CSV to /api/ingest-catalog...' });
    try {
      const res = await fetch('/api/ingest-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (data.success) {
        setCsvStatus({
          stage: 'done',
          message: data.message,
          added: data.added,
          updated: data.updated,
          catalogSize: data.catalogSize,
        });
      } else {
        setCsvStatus({ stage: 'error', message: data.error || 'Ingest failed' });
      }
    } catch (e: any) {
      setCsvStatus({ stage: 'error', message: e?.message || String(e) });
    } finally {
      setIsProcessing(false);
    }
  }, [input]);

  const toggleExpand = useCallback((idx: number) => {
    setResults(prev => prev.map((item, i) => i === idx ? { ...item, expanded: !item.expanded } : item));
  }, []);

  // ── Test Mode: load 3-catalog comparison for a record ────────────────────
  const loadTestComparison = useCallback(async (idx: number, force = false) => {
    if (!force && testModeCache[idx]) return testModeCache[idx];
    const r = results[idx];
    if (!r) return null;
    try {
      const resp = await fetch('/api/test-mode-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: r.reference, brand: r.brand, rawMessage: r.rawMessage }),
      });
      const data = await resp.json();
      if (data.success) {
        const catalog = {
          internal: data.internal,
          llm: data.llm,
          dataset: data.dataset,
        };
        setTestModeCache(prev => ({ ...prev, [idx]: catalog }));
        return catalog;
      }
    } catch (e) {
      console.error('test-mode-compare failed:', e);
    }
    return null;
  }, [results, testModeCache]);

  // ── Auto-load 3-catalog comparisons when results change (fixes 3-CATALOG 0/10) ──
  useEffect(() => {
    if (!testMode || results.length === 0) return;
    const indices = results.map((_, i) => i).filter(i => !testModeCache[i]);
    if (indices.length === 0) return;
    Promise.all(indices.map(i => loadTestComparison(i, true))).catch(() => {});
  }, [results, testMode, testModeCache, loadTestComparison]);

  // ── Inline field edit: open TestModePanel in edit mode for this record ──
  const openEditFor = useCallback((idx: number) => {
    // Ensure card is expanded
    setResults(prev => prev.map((item, i) =>
      i === idx ? { ...item, expanded: true, _autoEdit: true } : item
    ));
    // Load comparison if not loaded
    if (!testModeCache[idx]) {
      loadTestComparison(idx);
    }
    // Scroll the TestModePanel into view after a short delay
    setTimeout(() => {
      const el = document.querySelector(`[data-test-edit="${idx}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear autoEdit after 3 seconds
      setTimeout(() => {
        setResults(prev => prev.map((item, i) =>
          i === idx ? { ...item, _autoEdit: false } : item
        ));
      }, 3000);
    }, 200);
  }, [testModeCache, loadTestComparison]);

  // ── Test Mode: re-launch pipeline with human-edited record ──────────────
  const handleTestRelaunch = useCallback(async (idx: number, edited: {
    brand: string; reference: string; dialColor: string; condition: string;
    price: number; currency: string; year: number | null; notes?: string;
  }) => {
    // Construct an artificial rawMessage that the parser will recognize as fully-formed
    const parts = [
      edited.brand !== 'Unknown' ? edited.brand : '',
      edited.reference,
      edited.dialColor !== 'UNKNOWN' ? edited.dialColor : '',
      edited.condition !== 'Unknown' ? edited.condition : '',
      edited.year ? String(edited.year) : '',
      edited.price ? `${edited.price} ${edited.currency}` : '',
    ].filter(Boolean);
    const rebuilt = parts.join(' ');

    // Re-parse locally (no need for server round-trip)
    const r = parseWatch(rebuilt);
    // Apply the human edits on top (human is authoritative)
    const updated = {
      ...results[idx],
      brand: edited.brand || r.brand,
      reference: edited.reference || r.reference,
      dialColor: edited.dialColor || r.dialColor,
      condition: edited.condition || r.condition,
      price: edited.price || r.price,
      currency: edited.currency || r.currency,
      year: edited.year || r.year,
      confidence: 100,  // human-edited = 100% confidence
      verdict: 'APPROVED' as const,
      rawMessage: results[idx].rawMessage + (edited.notes ? ` [EDITED: ${edited.notes}]` : ''),
      edited: true,
      expanded: false,
    };
    setResults(prev => prev.map((item, i) => i === idx ? updated : item));
    // Invalidate test mode cache so the next load picks up new scores
    setTestModeCache(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }, [results]);

  // ── Test Mode: ask AI co-pilot for ambiguous record ─────────────────────
  const handleTestCopilot = useCallback(async (rawMessage: string) => {
    try {
      const resp = await fetch('/api/co-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawMessage }),
      });
      const data = await resp.json();
      return data.copilot || data;
    } catch (e: any) {
      console.error('co-pilot failed:', e);
      return null;
    }
  }, []);

  // ── Exports ────────────────────────────────────────────────────────────────
  const handleDownloadCSV = useCallback(() => {
    const rows = [['rawMessage', 'brand', 'reference', 'dialColor', 'price', 'currency', 'condition', 'year', 'confidence', 'verdict', 'model', 'intent', 'provider']];
    for (const r of results) {
      rows.push([
        r.rawMessage, r.brand, r.reference, r.dialColor, String(r.price), r.currency,
        r.condition, String(r.year ?? ''), String(r.confidence), r.verdict,
        r.model || '', r.intent || '',
        r.pipeline?.stages?.find((s: Stage) => s.stage === 'AI_TEXT')?.engine || '',
      ]);
    }
    const bom = '\uFEFF';
    const csv = bom + rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Curated_Luxury_Demo_${results.length}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const handleDownloadExcel = useCallback(async () => {
    const XLSX = await getXLSX();
    const stamp = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();
    const approved = results.filter(r => r.verdict === 'APPROVED');
    const human = results.filter(r => r.verdict === 'HUMAN');
    const recycle = results.filter(r => r.verdict === 'RECYCLE');

    const ws1: any[][] = [];
    ws1.push([titleCell(`Curated Luxury Demo Export — ${stamp}`)]);
          ws1.push([{
            v: `${results.length} records  ·  ${approved.length} Approved  ·  ${human.length} Human  ·  ${recycle.length} Recycle  ·  Provider: ${provider}`,
            t: 's',
            s: { font: { sz: 9, italic: true, color: { rgb: 'FF666666' } } },
          }]);
    ws1.push([]);
    const COLS = ['Raw Message', 'Brand', 'Reference', 'Dial', 'Price', 'Currency', 'Condition', 'Year', 'Confidence', 'Verdict', 'Intent', 'Model', 'AI Engine'];
    ws1.push(COLS.map(hCell));
    for (const r of results) {
      const bg = verdictBg(r.verdict);
      const engine = r.pipeline?.stages?.find((s: Stage) => s.stage === 'AI_TEXT')?.engine || '—';
      ws1.push([
        dCell(r.rawMessage?.slice(0, 120) || '', bg),
        dCell(r.brand, bg),
        dCell(r.reference, bg),
        dCell(r.dialColor, bg),
        dCell(r.price || 0, bg, 'right'),
        dCell(r.currency, bg, 'center'),
        dCell(r.condition, bg),
        dCell(r.year ?? '—', bg, 'center'),
        dCell(r.confidence, bg, 'right'),
        dCell(r.verdict, bg, 'center'),
        dCell(r.intent || '—', bg, 'center'),
        dCell(r.model || '—', bg),
        dCell(engine, bg, 'center'),
      ]);
    }
    const ws1Sheet = XLSX.utils.aoa_to_sheet(ws1);
    ws1Sheet['!cols'] = [
      {wch:55},{wch:18},{wch:16},{wch:12},{wch:12},{wch:10},
      {wch:12},{wch:6},{wch:11},{wch:14},{wch:10},{wch:18},{wch:14},
    ];
    ws1Sheet['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:12} },
      { s:{r:1,c:0}, e:{r:1,c:12} },
    ];
    ws1Sheet['!freeze'] = { xSplit: 0, ySplit: 4 };
    XLSX.utils.book_append_sheet(wb, ws1Sheet, 'All Records');

    // Summary sheet — by verdict AND by intent
    const ws2: any[][] = [];
    ws2.push([titleCell('Summary')]);
    ws2.push([]);
    ws2.push(['By Verdict', 'Count', 'Pct', 'Avg Confidence', 'Avg Price'].map(hCell));
    const verdictGroups: [string, EnrichedResult[], any][] = [
      ['APPROVED', approved, C.green],
      ['HUMAN', human, C.orange],
      ['RECYCLE', recycle, C.red],
    ];
    for (const [label, group, bg] of verdictGroups) {
      const avgConf = group.length ? Math.round(group.reduce((s, r) => s + r.confidence, 0) / group.length) : 0;
      const priced = group.filter(r => r.price > 0);
      const avgPrice = priced.length ? Math.round(priced.reduce((s, r) => s + r.price, 0) / priced.length) : 0;
      ws2.push([
        dCell(label, bg, 'center'),
        dCell(group.length, bg, 'right'),
        dCell(`${Math.round(group.length / Math.max(1, results.length) * 100)}%`, bg, 'right'),
        dCell(avgConf, bg, 'right'),
        dCell(avgPrice, bg, 'right'),
      ]);
    }
    ws2.push([]);
    ws2.push(['By Intent', 'Count', 'Pct', 'Avg Confidence', 'Avg Price'].map(hCell));
    const intentGroups: [string, EnrichedResult[], any][] = [
      ['SELLERS (have stock)', results.filter(r => r.intent === 'SELL' || !r.intent), { rgb: 'FFD8B4FE' }],
      ['BUYERS (looking to buy)', results.filter(r => r.intent === 'BUY'), { rgb: 'FFFB923C' }],
      ['INQUIRIES (asking)', results.filter(r => r.intent === 'INQUIRY'), { rgb: 'FF60A5FA' }],
    ];
    for (const [label, group, bg] of intentGroups) {
      const avgConf = group.length ? Math.round(group.reduce((s, r) => s + r.confidence, 0) / group.length) : 0;
      const priced = group.filter(r => r.price > 0);
      const avgPrice = priced.length ? Math.round(priced.reduce((s, r) => s + r.price, 0) / priced.length) : 0;
      ws2.push([
        dCell(label, bg, 'center'),
        dCell(group.length, bg, 'right'),
        dCell(`${Math.round(group.length / Math.max(1, results.length) * 100)}%`, bg, 'right'),
        dCell(avgConf, bg, 'right'),
        dCell(avgPrice, bg, 'right'),
      ]);
    }
    const ws2Sheet = XLSX.utils.aoa_to_sheet(ws2);
    ws2Sheet['!cols'] = [{wch:24},{wch:10},{wch:8},{wch:16},{wch:14}];
    ws2Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:4} }];
    XLSX.utils.book_append_sheet(wb, ws2Sheet, 'Summary');

    XLSX.writeFile(wb, `Curated_Luxury_Demo_${stamp}.xlsx`);
  }, [results, provider]);

  const handleClear = useCallback(() => {
    setInput('');
    setResults([]);
    setProgress({ done: 0, total: 0 });
    setLastLatencyMs(null);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const lineCount = input.trim() ? input.split('\n').filter(l => l.trim()).length : 0;
  const visibleResults = results.slice(0, BATCH_MAX_RENDER);

  // Test-mode summary: aggregate per-feature scores across all results
  const testModeSummary = useMemo(() => {
    if (results.length === 0) return null;
    const totals = { parser: 0, catalog: 0, ai: 0, image: 0, export: 0, loop: 0, overall: 0 };
    for (const r of results) {
      const cache = testModeCache[results.indexOf(r)];
      const scores = computeFeatureScores(r, cache || null);
      totals.parser += scores.parser;
      totals.catalog += scores.catalog;
      totals.ai += scores.ai;
      totals.image += scores.image;
      totals.export += scores.export;
      totals.loop += scores.loop;
      totals.overall += scores.overall;
    }
    const n = results.length;
    return {
      parser: Math.round(totals.parser / n),
      catalog: Math.round(totals.catalog / n),
      ai: Math.round(totals.ai / n),
      image: Math.round(totals.image / n),
      export: Math.round(totals.export / n),
      loop: Math.round(totals.loop / n),
      overall: Math.round(totals.overall / n),
    };
  }, [results, testModeCache]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#050505' }}>
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#d4af37', fontFamily: "'Playfair Display', serif" }}>
              Curated Luxury Demo
            </h1>
            <p className="mt-2 text-sm max-w-2xl" style={{ color: '#888' }}>
              Real-time pipeline demo. Paste text, images, or a full chat — every watch flows through
              <span style={{ color: '#22c55e' }}> PARSE</span> →
              <span style={{ color: '#60a5fa' }}> CATALOG</span> →
              <span style={{ color: '#a78bfa' }}> AI TEXT</span> →
              <span style={{ color: '#eab308' }}> IMAGE</span> →
              <span style={{ color: '#d4af37' }}> VERDICT</span>
              &nbsp;and you see every stage.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Test mode toggle */}
            <button
              onClick={() => setTestMode(t => !t)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
              style={{
                backgroundColor: testMode ? '#a78bfa' : '#1a1a1a',
                color: testMode ? '#050505' : '#a78bfa',
                border: '1px solid ' + (testMode ? '#a78bfa' : '#333'),
              }}
              title="Show test mode: per-feature confidence 1-10, 3-catalog comparison, edit + re-launch loop, AI co-pilot"
            >
              <TestTube2 className="w-3.5 h-3.5" />
              Test Mode {testMode ? 'ON' : 'OFF'}
            </button>
            {lastLatencyMs !== null && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide" style={{ color: '#666' }}>Last Run</div>
                <div className="text-2xl font-bold" style={{ color: '#d4af37' }}>{(lastLatencyMs / 1000).toFixed(1)}s</div>
                <div className="text-xs" style={{ color: '#888' }}>{results.length} watches · {provider}</div>
              </div>
            )}
          </div>
        </div>

        {/* ── Test Mode Summary Panel ─────────────────────────────────────── */}
        {testMode && testModeSummary && (
          <div className="rounded-xl p-4 mb-6" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1e1b4b' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#a78bfa' }}>
                  Test Mode — Live Feature Confidence (1-10)
                </h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: testModeSummary.overall >= 9 ? '#052e16' : testModeSummary.overall >= 7 ? '#0f172a' : '#422006', color: testModeSummary.overall >= 9 ? '#22c55e' : testModeSummary.overall >= 7 ? '#60a5fa' : '#eab308' }}>
                  OVERALL: {testModeSummary.overall}/10
                </span>
              </div>
              <div className="text-[10px]" style={{ color: '#666' }}>
                {results.length} records · per-feature avg across all results
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {(['parser','catalog','ai','image','export','loop'] as const).map(k => {
                const v = testModeSummary[k];
                const c = v >= 9 ? { bg: '#052e16', fg: '#22c55e', label: 'EXCELLENT' }
                       : v >= 7 ? { bg: '#0f172a', fg: '#60a5fa', label: 'GOOD' }
                       : v >= 5 ? { bg: '#422006', fg: '#eab308', label: 'OK' }
                       : { bg: '#450a0a', fg: '#ef4444', label: 'WEAK' };
                const labels = { parser: 'Regex Parser', catalog: '3-Catalog', ai: 'AI Cascade', image: 'Image', export: 'Export', loop: 'Loop-Back' };
                return (
                  <div key={k} className="p-2 rounded text-center" style={{ backgroundColor: c.bg, border: '1px solid ' + c.fg + '44' }}>
                    <div className="text-[9px] uppercase tracking-wide" style={{ color: '#aaa' }}>{labels[k]}</div>
                    <div className="text-base font-bold font-mono" style={{ color: c.fg }}>{v}</div>
                    <div className="text-[8px]" style={{ color: c.fg }}>{c.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Input panel ─────────────────────────────────────────────────── */}
        <div className="rounded-xl p-6 mb-6" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          {/* Mode tabs + provider toggle */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex gap-2">
              {MODE_TABS.map(t => {
                const Icon = t.icon;
                const active = inputMode === t.id;
                return (
                  <button key={t.id} onClick={() => setInputMode(t.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all"
                    style={{
                      backgroundColor: active ? '#d4af37' : '#1a1a1a',
                      color: active ? '#050505' : '#d4af37',
                      border: '1px solid ' + (active ? '#d4af37' : '#333'),
                    }}>
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#888' }}>AI Provider:</span>
              <select value={provider} onChange={e => setProvider(e.target.value as Provider)}
                className="text-xs px-2 py-1.5 rounded-lg font-mono"
                style={{ backgroundColor: '#111', color: '#d4af37', border: '1px solid #333' }}>
                <option value="auto">Auto (cascade)</option>
                <option value="claude">Claude Sonnet 4.5</option>
                <option value="openai">GPT-4o</option>
                <option value="gemini">Gemini 2.0 Flash</option>
                <option value="deepseek">DeepSeek V3</option>
                <option value="kimi">Kimi K2.6</option>
              </select>
            </div>
          </div>

          <div className="text-xs mb-2" style={{ color: '#666' }}>
            {MODE_TABS.find(t => t.id === inputMode)?.hint}
          </div>

          {/* Textarea + upload */}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={
              inputMode === 'text'
                ? 'One watch per line:\n🏮5712/1A Blue N5/2026 New 850k HKD\n🔥116610LV Green 2021 1.2M HKD'
                : inputMode === 'images'
                ? 'Paste image URLs (one per line):\nhttps://example.com/watch1.jpg\nhttps://example.com/watch2.jpg'
                : inputMode === 'csv'
                ? 'Paste catalog CSV (first row = header):\nBrand,Model,Reference,Dial Color\nPatek Philippe,Nautilus,5711/110P-001,Black\nRolex,Submariner,116610LV,Green'
                : 'Paste a full WhatsApp chat export here — we auto-split into individual watches'
            }
            className="w-full h-40 rounded-lg p-4 text-sm font-mono outline-none resize-none"
            style={{ backgroundColor: '#111', color: '#e8e8e8', border: '1px solid #222' }}
          />

          {/* Hidden file input for chat uploads */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          <div className="flex gap-3 mt-4 flex-wrap items-center">
            <button onClick={inputMode === 'csv' ? handleCsvIngest : handleAnalyze}
              disabled={isProcessing || !input.trim()}
              className="px-6 py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 hover:opacity-90"
              style={{ backgroundColor: '#d4af37', color: '#050505' }}>
              {isProcessing ? (
                <span className="inline-flex items-center gap-2">
                  <span className="animate-spin w-3.5 h-3.5 border-2 rounded-full inline-block" style={{ borderColor: '#050505', borderTopColor: 'transparent' }} />
                  Processing {progress.done}/{progress.total}...
                </span>
              ) : inputMode === 'csv' ? (
                <><FileSpreadsheet className="inline w-4 h-4 mr-2" />Ingest Catalog</>
              ) : (
                <><Sparkles className="inline w-4 h-4 mr-2" />Run Pipeline</>
              )}
            </button>

            {/* CSV status panel */}
            {inputMode === 'csv' && csvStatus && (
              <div className="ml-3 px-3 py-1.5 rounded-lg text-xs" style={{
                backgroundColor: csvStatus.stage === 'done' ? '#052e16' : csvStatus.stage === 'error' ? '#450a0a' : '#1a2e05',
                color: csvStatus.stage === 'done' ? '#4ade80' : csvStatus.stage === 'error' ? '#fca5a5' : '#86efac',
                border: `1px solid ${csvStatus.stage === 'done' ? '#22c55e' : csvStatus.stage === 'error' ? '#ef4444' : '#4ade80'}66`,
              }}>
                <div className="font-semibold">
                  {csvStatus.stage === 'done' ? '✓ Catalog Updated' : csvStatus.stage === 'error' ? '✗ Error' : '⋯ ' + csvStatus.stage}
                </div>
                <div className="mt-0.5">
                  {csvStatus.message}
                  {csvStatus.catalogSize && (
                    <span className="ml-2 opacity-75">| total: {csvStatus.catalogSize} refs</span>
                  )}
                </div>
              </div>
            )}

            <button onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
              style={{ backgroundColor: '#1a1a1a', color: '#e8e8e8', border: '1px solid #333' }}>
              <Upload className="w-3.5 h-3.5" />Upload .txt
            </button>

            {lineCount > 0 && (
              <div className="flex items-center px-3 text-xs rounded-lg" style={{ backgroundColor: '#111', color: '#888', border: '1px solid #222' }}>
                {lineCount} line{lineCount !== 1 ? 's' : ''}
                {lineCount > MAX_WATCHES_PER_REQUEST && (
                  <span className="ml-2" style={{ color: '#eab308' }}>(capped at {MAX_WATCHES_PER_REQUEST})</span>
                )}
              </div>
            )}
            {results.length > 0 && (
              <>
                <button onClick={handleClear}
                  className="px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                  style={{ backgroundColor: '#1a1a1a', color: '#ef4444', border: '1px solid #333' }}>
                  <Trash2 className="w-3.5 h-3.5" />Clear
                </button>
                <button onClick={handleDownloadExcel}
                  className="px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                  style={{ backgroundColor: '#1a1a1a', color: '#e8e8e8', border: '1px solid #333' }}>
                  <FileSpreadsheet className="w-3.5 h-3.5" />Export Excel
                </button>
                <button onClick={handleDownloadCSV}
                  className="px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                  style={{ backgroundColor: '#1a1a1a', color: '#e8e8e8', border: '1px solid #333' }}>
                  <Download className="w-3.5 h-3.5" />Export CSV
                </button>
              </>
            )}
          </div>

          {/* Progress bar */}
          {isProcessing && progress.total > 0 && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1a1a' }}>
                <div className="h-full transition-all" style={{
                  width: `${(progress.done / progress.total) * 100}%`,
                  backgroundColor: '#d4af37',
                }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Batch warning ───────────────────────────────────────────────── */}
        {results.length >= BATCH_WARN && (
          <div className="mb-4 px-4 py-3 rounded-lg flex items-center gap-2 text-sm"
            style={{ backgroundColor: '#422006', border: '1px solid #854d0e', color: '#eab308' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span><strong>{results.length}</strong> watches analyzed. Pipeline ran {Math.ceil(results.length / CHUNK_SIZE)} chunks in parallel.</span>
          </div>
        )}

        {/* ── Summary bar ─────────────────────────────────────────────────── */}
        {results.length > 0 && (
          <div className="flex gap-3 mb-4 text-xs flex-wrap">
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
              <span className="font-bold" style={{ color: '#22c55e' }}>{results.filter(r => r.verdict === 'APPROVED').length}</span> Approved
              <span className="ml-2 text-[10px]" style={{ color: '#60a5fa' }}>
                ({results.filter(r => r.verdict === 'APPROVED' && r.persisted).length} saved)
              </span>
            </div>
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
              <span className="font-bold" style={{ color: '#eab308' }}>{results.filter(r => r.verdict === 'HUMAN').length}</span> Human Review
            </div>
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
              <span className="font-bold" style={{ color: '#ef4444' }}>{results.filter(r => r.verdict === 'RECYCLE').length}</span> Recycle
            </div>
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
              <span className="font-bold" style={{ color: '#60a5fa' }}>{results.filter(r => r.pipeline).length}</span> With Pipeline Trace
            </div>
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #7c2d12', color: '#fed7aa' }}>
              <span className="font-bold" style={{ color: '#fb923c' }}>{results.filter(r => r.intent === 'BUY').length}</span> 🛒 Buyers
            </div>
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #581c87', color: '#d8b4fe' }}>
              <span className="font-bold" style={{ color: '#c084fc' }}>{results.filter(r => r.intent === 'SELL' || !r.intent).length}</span> 🏷️ Sellers
            </div>
            <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1e3a8a', color: '#bfdbfe' }}>
              <span className="font-bold" style={{ color: '#60a5fa' }}>{results.filter(r => r.intent === 'INQUIRY').length}</span> ❓ Inquiries
            </div>
          </div>
        )}

        {/* ── Demand Panel (BUYER signals) ─────────────────────────────────────── */}
        {results.length > 0 && results.filter(r => r.intent === 'BUY').length > 0 && (
          <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#1c0f0a', border: '1px solid #7c2d12' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">🛒</span>
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
                DEMAND SIGNALS — Buyers Looking For
              </h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: '#7c2d12', color: '#fed7aa' }}>
                {results.filter(r => r.intent === 'BUY').length} ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              These records represent <strong style={{ color: '#fb923c' }}>buyer demand</strong> — people looking to buy specific watches.
              Use this for matching inventory to demand or contacting buyers with stock.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {results.filter(r => r.intent === 'BUY').slice(0, 6).map((r, i) => (
                <div key={i} className="p-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #7c2d12' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold" style={{ color: '#fb923c' }}>WANTED</span>
                    <span className="text-[10px] text-gray-500">{r.confidence}%</span>
                  </div>
                  <div className="text-sm mt-1 truncate" style={{ color: '#fed7aa' }}>
                    {r.brand !== 'Unknown' && <span style={{ color: '#d4af37' }}>{r.brand}</span>}
                    {r.reference && <span className="font-mono ml-1">{r.reference}</span>}
                  </div>
                  {r.dialColor && r.dialColor !== 'UNKNOWN' && (
                    <div className="text-[11px] text-gray-400">{r.dialColor}</div>
                  )}
                  <div className="text-[10px] text-gray-500 truncate mt-1" title={r.rawMessage}>
                    "{r.rawMessage.slice(0, 80)}{r.rawMessage.length > 80 ? '...' : ''}"
                  </div>
                </div>
              ))}
            </div>
            {results.filter(r => r.intent === 'BUY').length > 6 && (
              <div className="text-center text-[10px] text-gray-500 mt-2">
                +{results.filter(r => r.intent === 'BUY').length - 6} more buyer signals — see Results below
              </div>
            )}
          </div>
        )}

        {/* ── Results: pipeline cards ─────────────────────────────────────── */}
        {results.length > 0 && (
          <div className="space-y-3">
            {visibleResults.map((r, idx) => (
              <div key={idx}>
                <PipelineCard
                  result={r}
                  idx={idx}
                  expanded={!!r.expanded}
                  onToggle={() => toggleExpand(idx)}
                  onWebLookup={() => handleWebLookup(idx)}
                  onAskAI={() => handleAskAI(idx)}
                  onFieldEdit={() => openEditFor(idx)}
                  webLoading={webLoading.has(idx.toString())}
                  aiLoading={aiLoading.has(idx.toString())}
                />
                {/* Test Mode Panel: shows 3-catalog comparison + edit/re-launch loop + AI co-pilot */}
                {testMode && r.expanded && (
                  <TestModePanel
                    result={r}
                    catalogs={testModeCache[idx] || {
                      internal: { name: 'Internal Catalog (2,206 refs)', hit: false, size: 2206 },
                      llm: { name: 'GPT-4o-mini LLM', confidence: 0 },
                      dataset: { name: 'Historical Dataset (117K records)', sampleCount: 0 },
                    }}
                    onRelaunch={(edited) => handleTestRelaunch(idx, edited)}
                    onAIReview={handleTestCopilot}
                    onClose={() => toggleExpand(idx)}
                  />
                )}
                {!testModeCache[idx] && testMode && r.expanded && (
                  <button
                    onClick={() => loadTestComparison(idx)}
                    className="ml-4 mt-1 text-[10px] text-purple-400 hover:text-purple-300"
                  >
                    Load 3-catalog comparison for this record →
                  </button>
                )}
              </div>
            ))}
            {results.length > BATCH_MAX_RENDER && (
              <div className="text-center py-6 text-sm" style={{ color: '#666' }}>
                +{results.length - BATCH_MAX_RENDER} more — export for full dataset.
              </div>
            )}
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {results.length === 0 && (
          <div className="rounded-xl p-12 text-center" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
            <Brain className="w-12 h-12 mx-auto mb-4" style={{ color: '#333' }} />
            <p className="text-sm" style={{ color: '#555' }}>Paste watch listings above and click <strong style={{ color: '#d4af37' }}>Run Pipeline</strong>.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Pipeline card — the visual showcase per watch
// ──────────────────────────────────────────────────────────────────────────────
function PipelineCard({
  result: r, expanded, onToggle, onWebLookup, onAskAI, onFieldEdit, webLoading, aiLoading,
}: {
  result: EnrichedResult; idx: number; expanded: boolean; onToggle: () => void;
  onWebLookup: () => void; onAskAI: () => void;
  onFieldEdit?: () => void;
  webLoading: boolean; aiLoading: boolean;
}) {
  const verdictColor = r.verdict === 'APPROVED' ? '#22c55e' : r.verdict === 'RECYCLE' ? '#ef4444' : '#eab308';
  const verdictBorder = r.verdict === 'APPROVED' ? '#166534' : r.verdict === 'RECYCLE' ? '#7f1d1d' : '#854d0e';
  const aiStage = r.pipeline?.stages?.find(s => s.stage === 'AI_TEXT');
  const onlineStage = r.pipeline?.stages?.find(s => s.stage === 'ONLINE');
  const imageStage = r.pipeline?.stages?.find(s => s.stage === 'IMAGE');
  const aiEngine = aiStage?.engine || '—';
  const engineBadgeColor: Record<string, string> = {
    claude: '#d97706', openai: '#10a981', gemini: '#3b82f6',
    deepseek: '#8b5cf6', kimi: '#ec4899', 'regex/code': '#6b7280',
  };

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{
        backgroundColor: '#0a0a0a',
        border: '1px solid ' + (r.processing ? '#333' : verdictBorder),
        opacity: r.processing ? 0.6 : 1,
      }}>

      {/* ── Header row ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: r.verdict === 'APPROVED' ? '#052e16' : r.verdict === 'RECYCLE' ? '#450a0a' : '#422006' }}>
            {r.processing ? (
              <span className="animate-spin w-4 h-4 border-2 rounded-full inline-block" style={{ borderColor: '#d4af37', borderTopColor: 'transparent' }} />
            ) : r.verdict === 'APPROVED' ? (
              <CheckCircle2 className="w-5 h-5" style={{ color: '#22c55e' }} />
            ) : r.verdict === 'RECYCLE' ? (
              <Trash2 className="w-5 h-5" style={{ color: '#ef4444' }} />
            ) : (
              <Eye className="w-5 h-5" style={{ color: '#eab308' }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate" style={{ color: '#e8e8e8' }}>{r.rawMessage}</div>
            <div className="text-xs mt-1 flex gap-2 flex-wrap items-center" style={{ color: '#888' }}>
              <span style={{ color: r.brand !== 'Unknown' ? '#d4af37' : '#ef4444' }}>{r.brand}</span>
              {r.reference && <span className="font-mono">{r.reference}</span>}
              {r.dialColor !== 'UNKNOWN' && <span>{r.dialColor}</span>}
              {r.price > 0 && <span>{r.currency} {r.price.toLocaleString()}{r.usdEquivalent && r.currency !== 'USD' && r.currency !== 'USDT' ? <span style={{color:'#666'}}> (~${r.usdEquivalent.toLocaleString()})</span> : null}</span>}
              {/* Intent badge: SELL = purple, BUY = orange, INQUIRY = blue */}
              {r.intent && r.intent !== 'SELL' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                  style={{
                    backgroundColor: r.intent === 'BUY' ? '#7c2d12' : '#1e3a8a',
                    color: r.intent === 'BUY' ? '#fed7aa' : '#bfdbfe',
                    border: `1px solid ${r.intent === 'BUY' ? '#ea580c' : '#3b82f6'}`,
                  }}>
                  {r.intent === 'BUY' ? '🛒 BUYER' : r.intent === 'INQUIRY' ? '❓ INQUIRY' : r.intent}
                </span>
              )}
              {r.pipeline && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{
                  backgroundColor: '#1a1a1a',
                  color: engineBadgeColor[aiEngine] || '#888',
                }}>
                  {aiEngine}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: r.confidence >= 85 ? '#052e16' : r.confidence >= 50 ? '#422006' : '#450a0a',
                color: r.confidence >= 85 ? '#22c55e' : r.confidence >= 50 ? '#eab308' : '#ef4444',
                border: '1px solid ' + (r.confidence >= 85 ? '#166534' : r.confidence >= 50 ? '#854d0e' : '#7f1d1d'),
              }}>
              {r.confidence}%
            </div>
            {r.verdict === 'APPROVED' && (
              <div className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1"
                style={{
                  backgroundColor: r.persisted ? '#052e16' : '#1a2e05',
                  color: r.persisted ? '#4ade80' : '#86efac',
                  border: `1px solid ${r.persisted ? '#22c55e' : '#4ade80'}66`,
                }}>
                {r.persisted ? '✓ SAVED' : '⋯ saving'}
              </div>
            )}
            {expanded ? <ChevronUp className="w-4 h-4" style={{ color: '#666' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#666' }} />}
          </div>
        </div>
      </div>

      {/* ── Expanded: visual pipeline ──────────────────────────────── */}
      {expanded && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: '#1a1a1a' }}>

          {/* Pipeline stages as horizontal flow */}
          {r.pipeline && (
            <div className="mt-3 mb-3">
              <div className="text-xs mb-2 font-semibold uppercase tracking-wide" style={{ color: '#666' }}>
                Pipeline Trace
              </div>
              <div className="flex gap-1 items-stretch overflow-x-auto pb-2">
                <PipelineStep label="PARSE" engine="regex/code" confidence={r.pipeline.confidence} stages={r.pipeline.stages} stepIndex={0} color="#6b7280" />
                <PipelineArrow />
                <PipelineStep label="AI TEXT" engine={aiStage?.engine || 'skipped'} confidence={aiStage?.confidence ?? r.pipeline.confidence} stages={r.pipeline.stages} stepIndex={1} color={engineBadgeColor[aiEngine] || '#a78bfa'} error={aiStage?.error} />
                <PipelineArrow />
                <PipelineStep label="ONLINE" engine="web" confidence={onlineStage?.confidence ?? r.pipeline.confidence} stages={r.pipeline.stages} stepIndex={2} color="#60a5fa" error={onlineStage?.error} />
                <PipelineArrow />
                <PipelineStep label="IMAGE" engine={imageStage?.engine || 'none'} confidence={imageStage?.confidence ?? r.pipeline.confidence} stages={r.pipeline.stages} stepIndex={3} color="#eab308" error={imageStage?.error} verdict={imageStage?.verdict} />
                <PipelineArrow />
                <PipelineStep label="VERDICT" engine={r.verdict} confidence={r.confidence} stages={r.pipeline.stages} stepIndex={4} color={verdictColor} final />
              </div>
            </div>
          )}

          {/* Parsed fields grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            <FieldBox
              label="Brand"
              value={r.brand}
              good={r.brand !== 'Unknown'}
              onEdit={onFieldEdit}
            />
            <FieldBox
              label="Reference"
              value={r.reference || '—'}
              good={!!r.reference}
              mono
              onEdit={onFieldEdit}
            />
            <FieldBox
              label="Dial"
              value={r.dialColor || '—'}
              good={!!r.dialColor && r.dialColor !== 'UNKNOWN'}
              onEdit={onFieldEdit}
            />
            <FieldBox
              label="Price"
              value={r.price > 0 ? (
                <span>
                  {r.currency} {r.price.toLocaleString()}
                  {r.usdEquivalent && r.currency !== 'USD' && r.currency !== 'USDT' && (
                    <span style={{ color: '#666', fontSize: '11px', marginLeft: '4px' }}>
                      (~${r.usdEquivalent.toLocaleString()})
                    </span>
                  )}
                </span>
              ) : '—'}
              good={r.price > 0}
              onEdit={onFieldEdit}
            />
            <FieldBox
              label="Condition"
              value={r.condition}
              good={r.condition !== 'Unknown'}
              onEdit={onFieldEdit}
            />
            <FieldBox
              label="Year"
              value={r.year ? String(r.year) : '—'}
              good={!!r.year}
              onEdit={onFieldEdit}
            />
            <FieldBox label="Verdict" value={r.verdict} good={r.verdict === 'APPROVED'} />
            <FieldBox label="Confidence" value={`${r.confidence}%`} good={r.confidence >= 85} />
          </div>

          {/* DISCREPANCY WARNING — AI changed the reference from what the parser found */}
          {r._aiChangedRef && r._parserRef && (
            <div className="mt-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2" style={{
              backgroundColor: '#450a0a',
              border: '1px solid #7f1d1d',
              color: '#fca5a5',
            }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
              <div>
                <span className="font-bold">AI Discrepancy — Needs Human Review</span>
                <br />
                Parser found: <span className="font-mono font-bold" style={{ color: '#f87171' }}>{r._parserRef}</span>
                {' → '}
                AI suggests: <span className="font-mono font-bold" style={{ color: '#fbbf24' }}>{r.reference}</span>
                <br />
                <span style={{ color: '#f87171' }}>Confidence capped at 84% to prevent auto-approval.</span>
              </div>
            </div>
          )}

          {/* Reason */}
          {r.pipeline?.reason && (
            <div className="mt-3 px-3 py-2 rounded-lg text-xs" style={{
              backgroundColor: '#111',
              border: '1px solid #1a1a1a',
              color: '#aaa',
            }}>
              <span style={{ color: '#888' }}>Reason:</span> {r.pipeline.reason}
            </div>
          )}

          {/* Per-stage notes */}
          {r.pipeline?.stages && r.pipeline.stages.length > 1 && (
            <details className="mt-3">
              <summary className="text-xs cursor-pointer" style={{ color: '#60a5fa' }}>
                Show all stage notes ({r.pipeline.stages.length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {r.pipeline.stages.map((s, i) => (
                  <div key={i} className="text-xs px-3 py-2 rounded-lg flex items-start gap-2"
                    style={{ backgroundColor: '#111', border: '1px solid #1a1a1a' }}>
                    <span className="font-mono font-bold shrink-0" style={{
                      color: engineBadgeColor[s.engine] || '#888',
                    }}>[{s.stage}]</span>
                    <span className="flex-1" style={{ color: '#888' }}>
                      <span style={{ color: '#e8e8e8' }}>{s.engine}</span>
                      {s.note && <> — {s.note}</>}
                      {s.error && <span style={{ color: '#ef4444' }}> — ERROR: {s.error}</span>}
                      {s.verdict && <span style={{ color: '#eab308' }}> — {s.verdict}</span>}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: '#666' }}>{s.confidence}%</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Image preview if URL present */}
          {r.pipeline?.imageUrl && (
            <div className="mt-3 rounded-lg overflow-hidden" style={{ backgroundColor: '#111', border: '1px solid #1a1a1a' }}>
              <img src={r.pipeline.imageUrl} alt="watch" className="w-full max-h-48 object-contain" loading="lazy" />
            </div>
          )}

          {/* Action area for non-approved */}
          {r.verdict !== 'APPROVED' && (
            <div className="mt-3 flex gap-2 flex-wrap">
              <button onClick={onAskAI} disabled={aiLoading}
                className="px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#422006', color: '#eab308', border: '1px solid #854d0e' }}>
                {aiLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="animate-spin w-3 h-3 border-2 rounded-full inline-block" style={{ borderColor: '#eab308', borderTopColor: 'transparent' }} />
                    Re-parsing...
                  </span>
                ) : (
                  <><Brain className="inline w-3 h-3 mr-1" />Re-run AI</>
                )}
              </button>
              <button onClick={onWebLookup} disabled={webLoading || !r.reference}
                className="px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#0f172a', color: '#60a5fa', border: '1px solid #1e3a5f' }}>
                {webLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="animate-spin w-3 h-3 border-2 rounded-full inline-block" style={{ borderColor: '#60a5fa', borderTopColor: 'transparent' }} />
                    Looking up...
                  </span>
                ) : (
                  <><Search className="inline w-3 h-3 mr-1" />Web Lookup</>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PipelineStep — one stage in the horizontal flow
// ──────────────────────────────────────────────────────────────────────────────
function PipelineStep({
  label, engine, confidence, color, stepIndex, stages, error, verdict, final,
}: {
  label: string; engine: string; confidence: number; color: string;
  stepIndex: number; stages: Stage[];
  error?: string; verdict?: string; final?: boolean;
}) {
  const stage = stages[stepIndex];
  const ran = !!stage || final;
  return (
    <div className="shrink-0 rounded-lg px-3 py-2 min-w-[110px] text-center"
      style={{
        backgroundColor: '#111',
        border: '1px solid ' + (error ? '#7f1d1d' : ran ? color : '#222'),
        opacity: ran ? 1 : 0.4,
      }}>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</div>
      <div className="text-[10px] mt-1 font-mono truncate" style={{ color: '#888' }}>{engine}</div>
      {ran && (
        <div className="text-xs font-bold mt-1" style={{ color: confidence >= 85 ? '#22c55e' : confidence >= 50 ? '#eab308' : '#ef4444' }}>
          {confidence}%
        </div>
      )}
      {error && <div className="text-[9px] mt-1" style={{ color: '#ef4444' }}>error</div>}
      {verdict && <div className="text-[9px] mt-1" style={{ color: '#eab308' }}>{verdict}</div>}
    </div>
  );
}

function PipelineArrow() {
  return (
    <div className="shrink-0 self-center text-xs" style={{ color: '#444' }}>→</div>
  );
}

function FieldBox({ label, value, good, mono = false, onEdit }: { label: string; value: React.ReactNode; good: boolean; mono?: boolean; onEdit?: () => void }) {
  return (
    <div
      onClick={onEdit}
      className={onEdit ? 'rounded-lg p-2.5 cursor-pointer transition-all hover:ring-1 hover:ring-purple-500' : 'rounded-lg p-2.5'}
      style={{ backgroundColor: '#111', ...(onEdit ? { position: 'relative' } : {}) }}
      title={onEdit ? 'Click to edit' : undefined}
    >
      <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: '#666' }}>{label}</div>
      <div className={'text-sm font-medium truncate ' + (mono ? 'font-mono' : '')} style={{ color: good ? '#e8e8e8' : '#ef4444' }}>{value}</div>
      {onEdit && (
        <div className="absolute top-1 right-1 text-[8px] opacity-50" style={{ color: '#a78bfa' }}>✎</div>
      )}
    </div>
  );
}
