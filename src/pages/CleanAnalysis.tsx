/**
 * Clean / Manual Analysis Workbench
 *
 * Paste raw WhatsApp watch descriptions and see:
 * - Per-watch step-by-step pipeline analysis
 * - Confidence scoring with visual ring
 * - Verdict: APPROVED (≥85%) / AI_REVIEW / HUMAN_REVIEW
 * - IQR outlier detection across all prices
 * - Catalog cross-reference cascade visualization
 * - Action buttons: Approve / Discard / View Detail
 */

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Microscope,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Check,
  Search,
  TrendingUp,
  Database,
  Sparkles,
  ArrowRight,
  Zap,
  BarChart3,
} from 'lucide-react';
import { normalizeMultiple, detectOutliers, type NormalizedWatch, type PipelineStage, type CatalogEntry } from '@/lib/normalizer';
import { TabNav } from '@/components/TabNav';

// ─── Confidence Ring SVG ─────────────────────────────────────────

function ConfidenceRing({ score, size = 48 }: { score: number; size?: number }) {
  const stroke = size / 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 85 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e1e2e" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fill="#e2e2e2" fontSize={size * 0.28} fontWeight="700" fontFamily="JetBrains Mono, monospace">
        {score}
      </text>
    </svg>
  );
}

// ─── Stage Timeline ──────────────────────────────────────────────

function StageTimeline({ stages }: { stages: PipelineStage[] }) {
  const [expandedStage, setExpandedStage] = useState<number | null>(null);

  const stageColors: Record<string, string> = {
    'Structured Extraction': '#3b82f6',
    'Normalization & Translation': '#8b5cf6',
    'Catalog Cross-Reference': '#f59e0b',
    'Confidence Scoring': '#10b981',
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle2 size={14} className="text-green-500" />;
    if (status === 'warning') return <AlertTriangle size={14} className="text-yellow-500" />;
    if (status === 'error') return <XCircle size={14} className="text-red-500" />;
    return <Zap size={14} className="text-blue-400" />;
  };

  return (
    <div className="mt-3 space-y-1">
      {stages.map((stage, i) => {
        const isOpen = expandedStage === i;
        return (
          <div key={i} className="border border-border-default rounded-md overflow-hidden bg-bg-elevated/30">
            <button
              onClick={() => setExpandedStage(isOpen ? null : i)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-elevated/50 transition-colors"
            >
              {statusIcon(stage.status)}
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stageColors[stage.name] || '#666' }} />
              <span className="text-xs font-medium text-text-primary flex-1">{stage.name}</span>
              {isOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
            </button>
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 space-y-1.5">
                    {stage.notes.map((note, j) => (
                      <div key={j} className="flex items-start gap-2 text-[11px]">
                        <ArrowRight size={10} className="text-text-muted mt-0.5 shrink-0" />
                        <span className="text-text-secondary">{note}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ─── Verdict Badge ───────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === 'APPROVED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-500/10 text-green-400 border border-green-500/20">
        <CheckCircle2 size={10} /> Approved
      </span>
    );
  }
  if (verdict === 'AI_REVIEW') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
        <Sparkles size={10} /> AI Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
      <AlertTriangle size={10} /> Human Review
    </span>
  );
}

// ─── Flag Chip ───────────────────────────────────────────────────

function FlagChip({ flag }: { flag: string }) {
  const colors: Record<string, string> = {
    SHORT_REFERENCE: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    PRICE_MISSING: 'bg-red-500/10 text-red-400 border-red-500/20',
    PRICE_OUTLIER: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    NO_CATALOG_MATCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    DIAL_UNKNOWN: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    CONDITION_UNKNOWN: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[flag] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
      {flag}
    </span>
  );
}

// ─── Catalog Card ────────────────────────────────────────────────

function CatalogCard({ entry, matchType }: { entry: CatalogEntry; matchType: string }) {
  return (
    <div className="mt-2 p-2.5 rounded-lg bg-bg-elevated/50 border border-border-default">
      <div className="flex items-center gap-2 mb-1.5">
        <Database size={12} className="text-gold-primary" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gold-primary">Catalog Entry</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${
          matchType === 'exact' ? 'bg-green-500/10 text-green-400' :
          matchType === 'fuzzy' ? 'bg-yellow-500/10 text-yellow-400' :
          'bg-blue-500/10 text-blue-400'
        }`}>
          {matchType.toUpperCase()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <span className="text-text-muted">Reference</span><span className="text-text-primary font-mono">{entry.reference}</span>
        <span className="text-text-muted">Collection</span><span className="text-text-primary">{entry.collection}</span>
        <span className="text-text-muted">Movement</span><span className="text-text-primary">{entry.movement}</span>
        <span className="text-text-muted">Material</span><span className="text-text-primary">{entry.material}</span>
        <span className="text-text-muted">Diameter</span><span className="text-text-primary">{entry.diameter}</span>
        <span className="text-text-muted">Complications</span><span className="text-text-primary">{entry.complications.join(', ')}</span>
        <span className="text-text-muted">Dial Colors</span><span className="text-text-primary">{entry.dialColors.join(', ')}</span>
        <span className="text-text-muted">Price Range</span>
        <span className="text-text-primary font-mono">
          ${entry.typicalPriceLow.toLocaleString()} - ${entry.typicalPriceHigh.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

const SAMPLE_TEXT = `FS Patek 5711/1A-010 blue dial unworn $185k
WTS 5711/1A-014 green $650k
Patek Philippe 5167A-001 $65k HKD excellent condition black dial
FS 5270P-001 blue dial $380k
WTT 6119R $32k rose gold silver dial
FS 6300G $5.2M grand complications`;

export default function CleanAnalysis() {
  const [inputText, setInputText] = useState(SAMPLE_TEXT);
  const [results, setResults] = useState<NormalizedWatch[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleAnalyze = useCallback(() => {
    const lines = inputText
      .split(/\n|(?=---)/)
      .map((l) => l.replace(/^---+/, '').trim())
      .filter((l) => l.length > 0);
    const normalized = normalizeMultiple(lines);
    setResults(normalized);
    setHasAnalyzed(true);
    setExpandedId(null);
  }, [inputText]);

  const handleApprove = useCallback((id: string) => {
    setResults((prev) => prev.map((w) => w.id === id ? { ...w, userAction: 'approved' as const } : w));
  }, []);

  const handleDiscard = useCallback((id: string) => {
    setResults((prev) => prev.map((w) => w.id === id ? { ...w, userAction: 'discarded' as const } : w));
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total = results.length;
    const approved = results.filter((w) => w.verdict === 'APPROVED').length;
    const aiReview = results.filter((w) => w.verdict === 'AI_REVIEW').length;
    const humanReview = results.filter((w) => w.verdict === 'HUMAN_REVIEW').length;
    const userApproved = results.filter((w) => w.userAction === 'approved').length;
    const userDiscarded = results.filter((w) => w.userAction === 'discarded').length;
    return { total, approved, aiReview, humanReview, userApproved, userDiscarded };
  }, [results]);

  // IQR Outlier Detection
  const iqrStats = useMemo(() => {
    const prices = results
      .map((w) => w.normalizedPriceUSD)
      .filter((p): p is number => p !== null);
    if (prices.length < 4) return null;
    return detectOutliers(prices);
  }, [results]);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans">
      <TabNav totalProcessed={2832} />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20 flex items-center justify-center">
              <Microscope size={20} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary tracking-tight">Clean Analysis Workbench</h1>
              <p className="text-xs text-text-muted">Paste raw watch descriptions. Step-by-step pipeline analysis. Pure algorithms — no API calls.</p>
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="mb-6 border border-border-default rounded-xl bg-bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-bg-elevated/30">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Raw Input</span>
            <span className="text-[10px] text-text-muted">Separate watches with new lines or ---</span>
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full h-40 bg-transparent px-4 py-3 text-xs font-mono text-text-primary placeholder:text-text-muted/40 resize-none focus:outline-none focus:ring-1 focus:ring-gold-primary/30"
            placeholder="Paste watch descriptions here..."
            spellCheck={false}
          />
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-default bg-bg-elevated/30">
            <span className="text-[10px] text-text-muted">
              {inputText.split(/\n/).filter((l) => l.trim().length > 0).length} line(s)
            </span>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAnalyze}
              className="flex items-center gap-2 px-5 py-2 bg-gold-primary text-bg-primary text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-gold-hover transition-colors"
            >
              <Search size={14} /> Run Analysis
            </motion.button>
          </div>
        </div>

        {/* Stats Bar */}
        {hasAnalyzed && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6"
          >
            {[
              { label: 'Analyzed', value: stats.total, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { label: 'Approved', value: stats.approved, color: 'text-green-400', bg: 'bg-green-500/10' },
              { label: 'AI Review', value: stats.aiReview, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
              { label: 'Human Review', value: stats.humanReview, color: 'text-red-400', bg: 'bg-red-500/10' },
              { label: 'User ✓', value: stats.userApproved, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
              { label: 'Discarded', value: stats.userDiscarded, color: 'text-gray-400', bg: 'bg-gray-500/10' },
            ].map((s) => (
              <div key={s.label} className={`${s.bg} border border-border-default rounded-lg p-3 text-center`}>
                <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </motion.div>
        )}

        {/* IQR Outlier Panel */}
        {hasAnalyzed && iqrStats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 border border-border-default rounded-xl bg-bg-card overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-default bg-bg-elevated/30">
              <BarChart3 size={14} className="text-purple-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">IQR Outlier Detection</span>
              <span className="text-[10px] text-text-muted ml-auto">
                Q1=${Math.round(iqrStats.q1).toLocaleString()} | Q3=${Math.round(iqrStats.q3).toLocaleString()} | IQR=${Math.round(iqrStats.iqr).toLocaleString()}
              </span>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-3 bg-bg-elevated rounded-full overflow-hidden flex">
                  <div className="h-full bg-green-500/40 rounded-l-full" style={{ width: '25%' }} />
                  <div className="h-full bg-blue-500/40" style={{ width: '50%' }} />
                  <div className="h-full bg-green-500/40 rounded-r-full" style={{ width: '25%' }} />
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-text-muted font-mono mb-2">
                <span>Lower: ${Math.round(iqrStats.lowerBound).toLocaleString()}</span>
                <span>Upper: ${Math.round(iqrStats.upperBound).toLocaleString()}</span>
              </div>
              {iqrStats.outliers.length > 0 ? (
                <div className="flex items-start gap-2">
                  <TrendingUp size={12} className="text-red-400 mt-0.5 shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {iqrStats.outliers.map((o, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-mono">
                        ${o.toLocaleString()}
                      </span>
                    ))}
                    <span className="text-[10px] text-text-muted ml-1">{iqrStats.outliers.length} outlier(s) flagged</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[10px] text-green-400">
                  <CheckCircle2 size={12} /> All prices within normal range
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Results Grid */}
        {hasAnalyzed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Analysis Results</h2>
              <span className="text-[10px] text-text-muted">{results.length} watch(es)</span>
            </div>

            <AnimatePresence>
              {results.map((watch, index) => {
                const isExpanded = expandedId === watch.id;
                const isActioned = watch.userAction !== 'none';

                return (
                  <motion.div
                    key={watch.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: isActioned ? 0.5 : 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={`border rounded-xl overflow-hidden ${
                      watch.verdict === 'APPROVED' ? 'border-green-500/20 bg-green-500/5' :
                      watch.verdict === 'AI_REVIEW' ? 'border-yellow-500/20 bg-yellow-500/5' :
                      'border-red-500/20 bg-red-500/5'
                    }`}
                  >
                    {/* Card Header */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-elevated/20 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : watch.id)}
                    >
                      <ConfidenceRing score={watch.confidenceScore} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <VerdictBadge verdict={watch.verdict} />
                          {watch.catalogMatch && (
                            <span className="text-[10px] text-text-muted font-mono">{watch.catalogMatch.reference}</span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary truncate font-mono">{watch.rawInput}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {watch.failureFlags.map((flag) => (
                            <FlagChip key={flag} flag={flag} />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {watch.normalizedPriceUSD && (
                          <span className="text-xs font-bold font-mono text-text-primary">
                            ${watch.normalizedPriceUSD.toLocaleString()}
                          </span>
                        )}
                        {isExpanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                      </div>
                    </div>

                    {/* Expanded Detail */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 border-t border-border-default/50">
                            {/* Extracted fields summary */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 mb-3">
                              {[
                                { label: 'Brand', value: watch.normalizedBrand || '—' },
                                { label: 'Reference', value: watch.normalizedRef || '—' },
                                { label: 'Dial', value: watch.normalizedDial || 'UNKNOWN' },
                                { label: 'Condition', value: watch.normalizedCondition || 'UNKNOWN' },
                              ].map((f) => (
                                <div key={f.label} className="bg-bg-elevated/30 rounded-md px-3 py-2">
                                  <div className="text-[10px] text-text-muted uppercase tracking-wider">{f.label}</div>
                                  <div className="text-xs text-text-primary font-medium truncate">{f.value}</div>
                                </div>
                              ))}
                            </div>

                            {/* Pipeline stages */}
                            <div className="mb-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5 block">Pipeline Log</span>
                              <StageTimeline stages={watch.stages} />
                            </div>

                            {/* Catalog match */}
                            {watch.catalogMatch && (
                              <CatalogCard entry={watch.catalogMatch} matchType={watch.matchType} />
                            )}

                            {/* Action buttons */}
                            <div className="flex items-center gap-2 mt-3">
                              {watch.userAction === 'none' ? (
                                <>
                                  <motion.button
                                    whileHover={{ scale: 1.03 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => handleApprove(watch.id)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-green-500/15 text-green-400 text-[11px] font-bold uppercase tracking-wider rounded-lg border border-green-500/20 hover:bg-green-500/25 transition-colors"
                                  >
                                    <Check size={13} /> Approve
                                  </motion.button>
                                  <motion.button
                                    whileHover={{ scale: 1.03 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => handleDiscard(watch.id)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-400 text-[11px] font-bold uppercase tracking-wider rounded-lg border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                  >
                                    <Trash2 size={13} /> Discard
                                  </motion.button>
                                </>
                              ) : watch.userAction === 'approved' ? (
                                <span className="flex items-center gap-1.5 text-[11px] text-green-400 font-bold">
                                  <CheckCircle2 size={14} /> User Approved — passed to normalized inventory
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-[11px] text-red-400 font-bold">
                                  <XCircle size={14} /> Discarded — moved to residue bin
                                </span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
