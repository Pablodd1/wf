import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Trash2, FileSpreadsheet, Loader2, CheckCircle2,
  Circle, ArrowRight, ArrowDown, Zap, Database, Settings,
  Sparkles, BarChart3, AlertTriangle, Package, Copy, XCircle,
} from 'lucide-react';
import type { ParsedResult, Verdict } from '@/types';
import { confidenceColor, confidenceLabel, formatPrice } from '@/lib/utils';
import { BrandBadge } from '@/components/ui/BrandBadge';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { ConfidenceRing } from '@/components/ui/ConfidenceRing';

type Stage = 'INGEST' | 'VALIDATE' | 'NORMALIZE' | 'ENRICH' | 'ML_SCORE';
type StageStatus = 'pending' | 'active' | 'complete';

interface StageDef {
  id: Stage;
  label: string;
  icon: React.ElementType;
  description: string;
}

const STAGES: StageDef[] = [
  { id: 'INGEST', label: 'INGEST', icon: Database, description: 'Raw text ingestion' },
  { id: 'VALIDATE', label: 'VALIDATE', icon: CheckCircle2, description: 'Structure validation' },
  { id: 'NORMALIZE', label: 'NORMALIZE', icon: Settings, description: 'Format normalization' },
  { id: 'ENRICH', label: 'ENRICH', icon: Sparkles, description: 'Data enrichment' },
  { id: 'ML_SCORE', label: 'ML SCORE', icon: BarChart3, description: 'Confidence scoring' },
];

const SAMPLE_INPUT = `PP 5711/1A blue dial full set 2023 $185k
Rolex 126610LN sub date new 2024 $14,200 box and papers
AP 15202ST royal oak blue used 2022 $98,700
RM11-03 flyback chronograph black $385,000 brand new
VC 4500V overseas blue like new $28,900

Rolex Daytona 116500LN white dial new 2024 $28,500
PP 5167A aquanaut black 2023 $45,200 excellent condition
AP 15500ST blue dial used $56,200 2021`;

function parseDemoListing(text: string): ParsedResult {
  const lower = text.toLowerCase();

  // Extract brand
  let brand = '';
  if (/patek|pp\b/.test(lower)) brand = 'Patek Philippe';
  else if (/rolex/.test(lower)) brand = 'Rolex';
  else if (/audemars|ap\b/.test(lower)) brand = 'Audemars Piguet';
  else if (/richard mille|rm\d/i.test(text)) brand = 'Richard Mille';
  else if (/vacheron|vc\b/.test(lower)) brand = 'Vacheron Constantin';
  else brand = 'Unknown';

  // Extract reference
  let reference = '';
  const refPatterns = [
    /\b(\d{4}\/\d+[A-Z])\b/,
    /\b(\d{5}[A-Z]{2,4})\b/,
    /\b(\d{6}[A-Z]{0,4})\b/,
    /\b(RM\d{2,3}(?:-01)?)\b/i,
    /\b(\d{4}[A-Z])\b/,
    /\b(\d{4}V)\b/,
  ];
  for (const pat of refPatterns) {
    const m = text.match(pat);
    if (m) { reference = m[1].toUpperCase(); break; }
  }

  // Extract price
  let price = 0;
  const pricePatterns = [
    /\$([\d,]+(?:\.\d+)?)\s*([kK]?)/,
    /\b([\d,]+)\s*(?:USD|USDT|CHF|EUR|GBP)?\b/,
  ];
  for (const pat of pricePatterns) {
    const m = text.match(pat);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ''));
      if (m[2] && m[2].toLowerCase() === 'k') val *= 1000;
      if (val > 1000) { price = val; break; }
    }
  }

  // Extract condition
  let condition = 'Used';
  if (/\bnew\b|\bbnib\b|\bbrand new\b/i.test(text)) condition = 'New';
  else if (/\blike new\b|\bexcellent\b|\blnib\b/i.test(text)) condition = 'Like New';
  else if (/\bnaked\b|\bhead only\b/i.test(text)) condition = 'Naked';

  // Extract year
  let year = 0;
  const yearMatch = text.match(/\b(19[\d]{2}|20[\d]{2})\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  // Extract dial color
  let dialColor = '';
  const colorPatterns = [
    { pat: /\bblue\b/i, color: 'Blue' },
    { pat: /\bblack\b/i, color: 'Black' },
    { pat: /\bwhite\b/i, color: 'White' },
    { pat: /\bgreen\b/i, color: 'Green' },
    { pat: /\bsilver\b/i, color: 'Silver' },
    { pat: /\bchampagne\b/i, color: 'Champagne' },
    { pat: /\bbrown\b/i, color: 'Brown' },
    { pat: /\bgrey\b/i, color: 'Grey' },
  ];
  for (const cp of colorPatterns) {
    if (cp.pat.test(text)) { dialColor = cp.color; break; }
  }

  // Extract family
  let family = '';
  const familyPatterns: Record<string, RegExp> = {
    'Nautilus': /nautilus/i,
    'Aquanaut': /aquanaut/i,
    'Submariner': /submariner|sub date/i,
    'Daytona': /daytona/i,
    'Royal Oak': /royal oak/i,
    'Overseas': /overseas/i,
    'RM': /RM\d/i,
  };
  for (const [fam, pat] of Object.entries(familyPatterns)) {
    if (pat.test(text)) { family = fam; break; }
  }

  // Calculate confidence
  let confidence = 0;
  if (reference) confidence += 30;
  if (brand && brand !== 'Unknown') confidence += 25;
  if (price > 0) confidence += 20;
  if (condition !== 'Used') confidence += 10;
  if (dialColor) confidence += 10;
  if (year > 0) confidence += 5;

  // Determine verdict
  let verdict: Verdict = 'RECYCLE';
  if (confidence >= 85) verdict = 'APPROVED';
  else if (confidence >= 70) verdict = 'REVIEW';
  else if (confidence >= 50) verdict = 'HUMAN';

  return {
    reference: reference || 'N/A',
    brand: brand || 'Unknown',
    family,
    price,
    originalPrice: price,
    originalCurrency: 'USD',
    condition,
    year,
    dialColor,
    confidence,
    verdict,
    description: text.trim(),
    raw: text,
  };
}

function splitListings(text: string): string[] {
  return text
    .split(/\/\/|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
}

export default function DemoPage() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<ParsedResult[]>([]);
  const [stageStatus, setStageStatus] = useState<Record<Stage, StageStatus>>({
    INGEST: 'pending', VALIDATE: 'pending', NORMALIZE: 'pending', ENRICH: 'pending', ML_SCORE: 'pending',
  });
  const [processing, setProcessing] = useState(false);
  const abortRef = useRef(false);

  const resetStages = useCallback(() => {
    setStageStatus({
      INGEST: 'pending', VALIDATE: 'pending', NORMALIZE: 'pending', ENRICH: 'pending', ML_SCORE: 'pending',
    });
  }, []);

  const runPipeline = useCallback(async () => {
    if (!input.trim()) return;
    abortRef.current = false;
    setProcessing(true);
    setResults([]);
    resetStages();

    const listings = splitListings(input);
    const parsed: ParsedResult[] = [];

    // INGEST
    setStageStatus(s => ({ ...s, INGEST: 'active' }));
    await new Promise(r => setTimeout(r, 600));
    if (abortRef.current) { setProcessing(false); return; }
    setStageStatus(s => ({ ...s, INGEST: 'complete' }));

    // VALIDATE
    setStageStatus(s => ({ ...s, VALIDATE: 'active' }));
    await new Promise(r => setTimeout(r, 500));
    if (abortRef.current) { setProcessing(false); return; }
    setStageStatus(s => ({ ...s, VALIDATE: 'complete' }));

    // NORMALIZE
    setStageStatus(s => ({ ...s, NORMALIZE: 'active' }));
    await new Promise(r => setTimeout(r, 500));
    if (abortRef.current) { setProcessing(false); return; }
    setStageStatus(s => ({ ...s, NORMALIZE: 'complete' }));

    // ENRICH
    setStageStatus(s => ({ ...s, ENRICH: 'active' }));
    await new Promise(r => setTimeout(r, 500));
    if (abortRef.current) { setProcessing(false); return; }
    setStageStatus(s => ({ ...s, ENRICH: 'complete' }));

    // ML_SCORE
    setStageStatus(s => ({ ...s, ML_SCORE: 'active' }));
    for (const listing of listings) {
      const parsedResult = parseDemoListing(listing);
      parsed.push(parsedResult);
      setResults([...parsed]);
      await new Promise(r => setTimeout(r, 200));
    }
    if (abortRef.current) { setProcessing(false); return; }
    setStageStatus(s => ({ ...s, ML_SCORE: 'complete' }));

    setProcessing(false);
  }, [input, resetStages]);

  const handleClear = useCallback(() => {
    abortRef.current = true;
    setInput('');
    setResults([]);
    resetStages();
    setProcessing(false);
  }, [resetStages]);

  const exportResults = useCallback(() => {
    if (results.length === 0) return;
    const headers = ['Reference', 'Brand', 'Family', 'Price', 'Condition', 'Year', 'Dial', 'Confidence', 'Verdict', 'Description'];
    const rows = results.map(r => [r.reference, r.brand, r.family, r.price, r.condition, r.year, r.dialColor, `${r.confidence}%`, r.verdict, r.description]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchfacts-parsed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const loadSample = useCallback(() => {
    setInput(SAMPLE_INPUT);
  }, []);

  const copySample = useCallback(() => {
    navigator.clipboard.writeText(SAMPLE_INPUT);
  }, []);

  return (<>
      <div className="p-5 max-w-[1800px] mx-auto h-[calc(100vh-56px)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Zap size={22} className="text-amber-400" /> Pipeline Demo
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Paste raw watch listings and watch them flow through the processing pipeline
            </p>
          </div>
          <div className="flex gap-2">
            {results.length > 0 && (
              <button
                onClick={exportResults}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
              >
                <FileSpreadsheet size={16} /> Export Results
              </button>
            )}
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm"
            >
              <Trash2 size={16} /> Clear All
            </button>
          </div>
        </div>

        {/* Three Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100%-80px)]">
          {/* COLUMN 1: RAW INPUT */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <Package size={14} /> Raw Input
              </h2>
              <div className="flex gap-1">
                <button onClick={loadSample} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">
                  Load Sample
                </button>
                <button onClick={copySample} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">
                  <Copy size={10} />
                </button>
              </div>
            </div>
            <div className="flex-1 p-3 flex flex-col gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste watch listings here...&#10;Supports multiple formats:&#10;- One per line&#10;- Separated by //&#10;&#10;Example:&#10;PP 5711/1A blue dial $185k&#10;Rolex 126610LN sub date $14,200"
                className="flex-1 w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-white text-sm font-mono resize-none focus:outline-none focus:border-amber-400/50 transition-colors placeholder-gray-600"
              />
              <button
                onClick={runPipeline}
                disabled={processing || !input.trim()}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black rounded-lg font-bold transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {processing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {processing ? 'Processing...' : 'Parse Listings'}
              </button>
            </div>
          </div>

          {/* COLUMN 2: PIPELINE STAGES */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <ArrowRight size={14} /> Pipeline Stages
              </h2>
            </div>
            <div className="flex-1 p-4 flex flex-col justify-center">
              <div className="space-y-3">
                {STAGES.map((stage, i) => {
                  const Icon = stage.icon;
                  const status = stageStatus[stage.id];
                  const isActive = status === 'active';
                  const isComplete = status === 'complete';

                  return (
                    <motion.div
                      key={stage.id}
                      animate={isActive ? { scale: [1, 1.02, 1] } : {}}
                      transition={{ repeat: isActive ? Infinity : 0, duration: 1.5 }}
                    >
                      <div
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-500 ${
                          isComplete
                            ? 'bg-green-400/10 border-green-400/30'
                            : isActive
                              ? 'bg-amber-400/10 border-amber-400/50 shadow-[0_0_15px_rgba(201,169,110,0.15)]'
                              : 'bg-gray-950 border-gray-800'
                        }`}
                      >
                        <div className={`p-2 rounded-md ${isComplete ? 'bg-green-400/20' : isActive ? 'bg-amber-400/20' : 'bg-gray-800'}`}>
                          {isComplete ? (
                            <CheckCircle2 size={20} className="text-green-400" />
                          ) : (
                            <Icon size={20} className={isActive ? 'text-amber-400' : 'text-gray-600'} />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className={`text-sm font-bold ${isComplete ? 'text-green-400' : isActive ? 'text-amber-400' : 'text-gray-500'}`}>
                            {stage.label}
                          </div>
                          <div className={`text-xs ${isComplete ? 'text-green-400/70' : isActive ? 'text-amber-400/70' : 'text-gray-600'}`}>
                            {stage.description}
                          </div>
                        </div>
                        {isActive && (
                          <Loader2 size={16} className="text-amber-400 animate-spin" />
                        )}
                      </div>

                      {i < STAGES.length - 1 && (
                        <div className="flex justify-center py-1">
                          <ArrowDown size={14} className={isComplete ? 'text-green-400/40' : 'text-gray-700'} />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {/* Stats */}
              {(results.length > 0 || processing) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 pt-4 border-t border-gray-800 grid grid-cols-3 gap-2"
                >
                  <div className="text-center">
                    <div className="text-lg font-bold font-mono text-white">{results.length}</div>
                    <div className="text-xs text-gray-500 uppercase">Parsed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold font-mono text-green-400">
                      {results.filter(r => r.verdict === 'APPROVED').length}
                    </div>
                    <div className="text-xs text-gray-500 uppercase">Approved</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold font-mono text-red-400">
                      {results.filter(r => r.verdict === 'RECYCLE').length}
                    </div>
                    <div className="text-xs text-gray-500 uppercase">Recycled</div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* COLUMN 3: RESULTS */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <CheckCircle2 size={14} /> Results
              </h2>
              {results.length > 0 && (
                <span className="text-xs text-gray-500 font-mono">{results.length} items</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <AnimatePresence>
                {results.length === 0 && !processing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-full text-gray-600"
                  >
                    <Circle size={48} className="mb-3" />
                    <p className="text-sm">Results will appear here</p>
                    <p className="text-xs mt-1">Click &quot;Parse Listings&quot; to begin</p>
                  </motion.div>
                )}

                {results.map((result, i) => (
                  <motion.div
                    key={`${result.reference}-${i}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-gray-950 border border-gray-800 rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <BrandBadge brand={result.brand} />
                        <ConditionBadge condition={result.condition} />
                      </div>
                      <ConfidenceRing percentage={result.confidence} size={32} />
                    </div>

                    <div className="font-mono text-base font-semibold text-white mb-0.5">
                      {result.reference}
                    </div>
                    {result.family && (
                      <div className="text-xs text-amber-400/70 uppercase tracking-wider mb-2">{result.family}</div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                      <span className="text-amber-400 font-mono font-bold">{formatPrice(result.price)}</span>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded uppercase"
                        style={{
                          color: confidenceColor(result.confidence),
                          backgroundColor: `${confidenceColor(result.confidence)}20`,
                        }}
                      >
                        {result.verdict}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {result.year > 0 && <span>Year: {result.year}</span>}
                      {result.dialColor && <span>Dial: {result.dialColor}</span>}
                    </div>

                    <div className="mt-2 pt-2 border-t border-gray-800">
                      <p className="text-xs text-gray-500 line-clamp-2">{result.description}</p>
                    </div>

                    {/* Verdict indicators */}
                    <div className="mt-2 flex gap-1">
                      {['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'].map((v) => (
                        <div
                          key={v}
                          className="flex-1 h-1 rounded-full"
                          style={{
                            backgroundColor: result.verdict === v ? confidenceColor(result.confidence) : '#1E1E2E',
                            opacity: result.verdict === v ? 1 : 0.3,
                          }}
                        />
                      ))}
                    </div>

                    {/* Field match indicator */}
                    <div className="mt-2 flex gap-1">
                      {[
                        { label: 'Ref', found: result.reference && result.reference !== 'N/A' },
                        { label: 'Brand', found: result.brand && result.brand !== 'Unknown' },
                        { label: 'Price', found: result.price > 0 },
                        { label: 'Dial', found: !!result.dialColor },
                        { label: 'Year', found: result.year > 0 },
                        { label: 'Cond', found: result.condition && result.condition !== 'Used' },
                      ].map((field) => (
                        <div
                          key={field.label}
                          className={`flex-1 text-center py-0.5 rounded text-xs font-medium ${
                            field.found ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                          }`}
                          title={field.found ? `${field.label}: found` : `${field.label}: missing`}
                        >
                          {field.label}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ─── Catalog Match Confidence Protocol ──────────────────────────── */}
        <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
            <BarChart3 size={16} className="text-[#D4AF37]" />
            <h3 className="text-sm font-semibold text-white">Catalog Match Confidence Protocol</h3>
          </div>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="pb-3 pr-4">Catalog Match</th>
                  <th className="pb-3 pr-4">AI Intervention Needed</th>
                  <th className="pb-3 pr-4">Confidence Score</th>
                  <th className="pb-3">Action</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                <tr className="border-b border-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-green-400">Everything found in catalog</td>
                  <td className="py-3 pr-4 text-gray-500">None</td>
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 font-mono font-semibold">100%</span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 font-medium">Auto-approve</span>
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-blue-400">1 thing missing (e.g., dial color)</td>
                  <td className="py-3 pr-4 text-gray-500">AI fills 1 gap</td>
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-400/10 text-blue-400 font-mono font-semibold">90%</span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-400/10 text-blue-400 font-medium">Review suggested</span>
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-amber-400">2 things missing (e.g., ref + dial)</td>
                  <td className="py-3 pr-4 text-gray-500">AI fills 2 gaps</td>
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 font-mono font-semibold">80%</span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 font-medium">Must review</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-medium text-red-400">3+ things missing or garbage</td>
                  <td className="py-3 pr-4 text-gray-500">AI can't resolve</td>
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 font-mono font-semibold">&lt;80%</span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 font-medium">Manual intervention</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Overall accuracy summary */}
          {results.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-800 flex items-center gap-6 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-green-400" />
                {results.filter(r => r.confidence >= 85).length} auto-approved
              </span>
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-amber-400" />
                {results.filter(r => r.confidence >= 70 && r.confidence < 85).length} review suggested
              </span>
              <span className="flex items-center gap-1.5">
                <XCircle size={13} className="text-red-400" />
                {results.filter(r => r.confidence < 70).length} need review
              </span>
            </div>
          )}
        </div>
      </div>
    </>);
}
