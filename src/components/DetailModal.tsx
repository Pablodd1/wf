/**
 * Detail modal — full watch record view with inline editing.
 * Click "Edit" to toggle editable fields directly in the modal.
 * Save merges changes and fires re-run pipeline.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Package, Paperclip, Star, Check, Settings, AlertTriangle, Trash2, Play, RotateCcw } from 'lucide-react';
import type { WatchRecord, FailureFlag } from '@/types';
import { BrandBadge } from './ui/BrandBadge';
import { ConditionBadge } from './ui/ConditionBadge';
import { ConfidenceRing } from './ui/ConfidenceRing';
import { DialColorSwatch } from './ui/DialColorSwatch';
import { DemandBadge } from './ui/DemandBadge';
import { StageDot } from './ui/StageDot';

interface DetailModalProps {
  record: WatchRecord | null;
  open: boolean;
  onClose: () => void;
  onApprove: (record: WatchRecord) => void;
  onEdit: (record: WatchRecord) => void;
  onFlag: (record: WatchRecord) => void;
  onDelete: (record: WatchRecord) => void;
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: [0, 0, 0.2, 1] as [number, number, number, number] } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] } },
};

const contentVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.3, ease: [0, 0, 0.2, 1] as [number, number, number, number] } }),
};

const flagColors: Record<string, string> = {
  YEAR_MISSING: 'bg-warning-dim text-warning',
  DIAL_UNKNOWN: 'bg-info-dim text-info',
  INCOMPLETE_REFERENCE: 'bg-[rgba(249,115,22,0.15)] text-[#F97316]',
  BOXPAPERS_UNKNOWN: 'bg-[rgba(107,114,128,0.15)] text-text-muted',
  LOW_SELLER_RATING: 'bg-purple-dim text-purple',
  PRICE_OUTLIER: 'bg-danger-dim text-danger',
  BRAND_UNCERTAIN: 'bg-warning-dim text-warning',
  CURRENCY_MISMATCH: 'bg-info-dim text-info',
};

const stageColors: Record<string, string> = {
  INGEST: '#3B82F6', VALIDATE: '#F59E0B', NORMALIZE: '#22C55E', ENRICH: '#8B5CF6', ML_SCORE: '#F97316',
};

const outcomeColors: Record<string, string> = {
  HIGH: 'text-success', RISING: 'text-info', STABLE: 'text-warning', LOW: 'text-text-muted', DECLINING: 'text-danger',
};

const BRAND_OPTIONS = ['Patek Philippe', 'Rolex', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Cartier', 'IWC', 'Omega', 'Tudor', 'Panerai', 'Hublot', 'Breitling', 'Jaeger-LeCoultre', 'Grand Seiko', 'Unknown'];
const CONDITION_OPTIONS = ['New', 'Like New', 'Used', 'Fair', 'Vintage', 'Unknown'];
const CURRENCY_OPTIONS = ['USD', 'HKD', 'EUR', 'GBP', 'SGD', 'CHF'];

function getStageDotState(stage: { status: string }): 'inactive' | 'active' | 'completed' | 'failed' {
  if (stage.status === 'failed') return 'failed';
  if (stage.status === 'completed') return 'completed';
  if (stage.status === 'active') return 'active';
  return 'inactive';
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

const inputCls = 'w-full bg-bg-elevated border border-border-default rounded px-2 py-1.5 text-[11px] text-text-primary font-mono focus:border-gold-primary focus:ring-1 focus:ring-gold-primary/20 transition-colors';
const labelCls = 'text-[10px] text-text-muted uppercase tracking-wider block mb-1';

export function DetailModal({ record, open, onClose, onApprove, onEdit, onFlag, onDelete }: DetailModalProps) {
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const editFormFromRecord = useMemo<Partial<WatchRecord>>(() => {
    if (!record) return {};
    return {
      brand: record.brand,
      reference: record.reference,
      dialColor: record.dialColor,
      price: record.price,
      condition: record.condition,
      year: record.year,
      rawMessage: record.rawMessage,
      originalCurrency: record.originalCurrency,
      hasBox: record.hasBox,
      hasPapers: record.hasPapers,
    };
  }, [record]);
  const [editForm, setEditForm] = useState<Partial<WatchRecord>>(editFormFromRecord);
  const [prevRecord, setPrevRecord] = useState(record);
  if (record !== prevRecord) {
    setPrevRecord(record);
    if (record && open) {
      setEditForm(editFormFromRecord);
    }
  }

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setEditing(false);
  }

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const updateField = useCallback(<K extends keyof WatchRecord>(field: K, value: WatchRecord[K]) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleToggleEdit = useCallback(() => {
    if (editing) {
      // Cancel — restore from original record
      if (record) {
        setEditForm({
          brand: record.brand,
          reference: record.reference,
          dialColor: record.dialColor,
          price: record.price,
          condition: record.condition,
          year: record.year,
          rawMessage: record.rawMessage,
          originalCurrency: record.originalCurrency,
          hasBox: record.hasBox,
          hasPapers: record.hasPapers,
        });
      }
    }
    setEditing(!editing);
  }, [editing, record]);

  const handleSaveLocal = useCallback(() => {
    if (!record) return;
    const updated: WatchRecord = { ...record, ...editForm };
    onEdit(updated);
    setEditing(false);
  }, [record, editForm, onEdit]);

  if (!record) return null;

  const confidencePct = Math.round(record.confidence);
  const varianceGood = Math.abs(record.priceVariance) <= 10;
  const varianceBad = Math.abs(record.priceVariance) > 20;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" exit="exit"
            className="absolute inset-0 bg-black/70" onClick={onClose} />

          <motion.div variants={modalVariants} initial="hidden" animate="visible" exit="exit"
            className="relative z-[110] w-full max-w-[900px] max-h-[90vh] bg-bg-card border border-border-active rounded-lg shadow-elevated shadow-gold overflow-hidden flex flex-col">

            {/* Header */}
            <motion.div custom={0} variants={contentVariants} initial="hidden" animate="visible"
              className="flex items-center justify-between px-5 py-4 border-b border-border-default flex-shrink-0">
              <div className="flex items-center gap-3">
                <BrandBadge brand={editing ? editForm.brand || record.brand : record.brand} />
                <span className="font-mono text-xl font-bold text-text-primary">
                  {editing ? editForm.reference || 'Unknown' : record.reference || 'Unknown'}
                </span>
                <span className="text-[10px] text-gold-muted font-semibold uppercase tracking-[0.04em]">{record.family}</span>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-gold-primary hover:bg-bg-elevated transition-colors cursor-pointer"
                aria-label="Close modal"><X size={20} /></button>
            </motion.div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="flex flex-col lg:flex-row">
                {/* Left Column - Image */}
                <motion.div custom={1} variants={contentVariants} initial="hidden" animate="visible"
                  className="lg:w-[40%] p-5 flex flex-col">
                  <div className="relative w-full aspect-square bg-bg-primary border border-border-default rounded-md flex items-center justify-center overflow-hidden">
                    <span className="absolute inset-0 flex items-center justify-center text-gold-primary/5 text-4xl font-serif tracking-[0.2em] select-none pointer-events-none">
                      {record.brand ? record.brand.toUpperCase() : 'WATCH'}
                    </span>
                    {record.imageUrl ? (
                      <img src={record.imageUrl} alt={record.reference} className="w-full h-full object-cover relative z-[1]"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <>
                        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="relative z-[1]">
                          <ellipse cx="60" cy="60" rx="32" ry="40" stroke="#C9A96E" strokeWidth="1.5" />
                          <ellipse cx="60" cy="60" rx="24" ry="30" stroke="#C9A96E" strokeWidth="1" />
                          <line x1="60" y1="20" x2="60" y2="32" stroke="#C9A96E" strokeWidth="1.5" />
                          <line x1="60" y1="88" x2="60" y2="100" stroke="#C9A96E" strokeWidth="1.5" />
                          <line x1="36" y1="48" x2="44" y2="52" stroke="#C9A96E" strokeWidth="1" />
                          <line x1="76" y1="52" x2="84" y2="48" stroke="#C9A96E" strokeWidth="1" />
                          <line x1="36" y1="72" x2="44" y2="68" stroke="#C9A96E" strokeWidth="1" />
                          <line x1="76" y1="68" x2="84" y2="72" stroke="#C9A96E" strokeWidth="1" />
                        </svg>
                        <span className="absolute bottom-4 text-sm text-text-muted">No Image Available</span>
                      </>
                    )}
                  </div>
                </motion.div>

                {/* Right Column - Details */}
                <motion.div custom={2} variants={contentVariants} initial="hidden" animate="visible"
                  className="lg:w-[60%] p-5 border-l border-border-default">

                  {/* Dial + Price */}
                  <div className="flex items-center gap-2 mb-4">
                    <DialColorSwatch color={editing ? editForm.dialColor || record.dialColor : record.dialColor} size={14} />
                  </div>
                  <div className="mb-4">
                    <div className="text-2xl font-mono font-bold text-gold-primary">
                      ${editing ? (editForm.price || 0).toLocaleString() : record.price.toLocaleString()}
                    </div>
                    <div className="text-sm text-text-muted mt-0.5">
                      {editing ? (editForm.originalCurrency || 'USD') : record.originalCurrency} {record.originalPrice.toLocaleString()}
                    </div>
                  </div>

                  {/* Edit Banner when editing */}
                  {editing && (
                    <div className="mb-4 p-2 rounded-lg bg-gold-primary/10 border border-gold-primary/30 text-[10px] text-gold-primary flex items-center gap-2">
                      <Settings size={12} />
                      Editing fields — change any value below, then click "Save & Re-run"
                    </div>
                  )}

                  {/* Inline Edit Form (appears when editing) */}
                  {editing && (
                    <div className="grid grid-cols-2 gap-3 mb-5 p-3 rounded-lg bg-bg-elevated/50 border border-border-default">
                      <div>
                        <span className={labelCls}>Brand</span>
                        <select value={editForm.brand || ''} onChange={e => updateField('brand', e.target.value)} className={inputCls}>
                          <option value="">Select...</option>
                          {BRAND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div>
                        <span className={labelCls}>Reference</span>
                        <input type="text" value={editForm.reference || ''} onChange={e => updateField('reference', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <span className={labelCls}>Dial Color</span>
                        <input type="text" value={editForm.dialColor || ''} onChange={e => updateField('dialColor', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <span className={labelCls}>Price (USD)</span>
                        <input type="number" value={editForm.price || 0} onChange={e => updateField('price', Number(e.target.value))} className={inputCls} />
                      </div>
                      <div>
                        <span className={labelCls}>Currency</span>
                        <select value={editForm.originalCurrency || 'USD'} onChange={e => updateField('originalCurrency', e.target.value)} className={inputCls}>
                          {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <span className={labelCls}>Condition</span>
                        <select value={editForm.condition || 'Unknown'} onChange={e => updateField('condition', e.target.value)} className={inputCls}>
                          {CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <span className={labelCls}>Year</span>
                        <input type="number" value={editForm.year ?? ''} onChange={e => updateField('year', e.target.value ? Number(e.target.value) : null)} className={inputCls} min={1900} max={2099} />
                      </div>
                      <div>
                        <span className={labelCls}>Box/Papers</span>
                        <select value={editForm.hasBox && editForm.hasPapers ? 'Full Set' : editForm.hasBox ? 'Box Only' : editForm.hasPapers ? 'Papers Only' : 'None'}
                          onChange={e => {
                            const v = e.target.value;
                            updateField('hasBox', v === 'Full Set' || v === 'Box Only');
                            updateField('hasPapers', v === 'Full Set' || v === 'Papers Only');
                          }} className={inputCls}>
                          {['Full Set', 'Box Only', 'Papers Only', 'None', 'Unknown'].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <span className={labelCls}>Source Message</span>
                        <textarea value={editForm.rawMessage || ''} onChange={e => updateField('rawMessage', e.target.value)}
                          className={`${inputCls} resize-none`} rows={3} />
                      </div>
                    </div>
                  )}

                  {/* Read-only Specs Grid (hides fields that show in edit form) */}
                  {!editing && (
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      <div><span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Year</span><span className="text-[11px] font-mono text-text-primary">{record.year ?? 'Unknown'}</span></div>
                      <div><span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Condition</span><ConditionBadge condition={record.condition} /></div>
                      <div><span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Dial</span><DialColorSwatch color={record.dialColor} size={14} /></div>
                      <div>
                        <span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Box/Papers</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                          <Package size={12} className={record.hasBox ? 'text-success' : 'text-text-muted'} />
                          <Paperclip size={12} className={record.hasPapers ? 'text-success' : 'text-text-muted'} />
                          <span>{record.hasBox && record.hasPapers ? 'Full Set' : record.hasBox ? 'Box Only' : record.hasPapers ? 'Papers Only' : 'None'}</span>
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Seller Rating</span>
                        <span className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} size={12} className={i < record.sellerRating ? 'text-gold-primary fill-gold-primary' : 'text-bg-elevated'} />
                          ))}
                        </span>
                      </div>
                      <div><span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Days on Market</span><span className="text-[11px] font-mono text-text-primary">{record.daysOnMarket} days</span></div>
                      <div><span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Market Comparables</span><span className="text-[11px] font-mono text-text-primary">{record.marketComparables}</span></div>
                      <div><span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Source</span><span className="text-[11px] font-mono text-text-primary uppercase">{record.source}</span></div>
                    </div>
                  )}

                  {/* ML Intelligence */}
                  <div className="border-l-2 border-purple pl-4 mb-5 py-1">
                    <span className="text-[10px] text-text-muted uppercase tracking-[0.08em] block mb-3">ML Intelligence</span>
                    <div className="flex items-center gap-3 mb-2">
                      <ConfidenceRing percentage={record.confidence} size={36} />
                      <div><span className="text-[10px] text-text-muted uppercase">Confidence</span><span className="text-sm font-mono font-bold text-text-primary block">{confidencePct}%</span></div>
                    </div>
                    <div className="mb-2">
                      <span className="text-[10px] text-text-muted uppercase">ML Predicted Price</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-text-primary">${record.mlPredictedPrice.toLocaleString()}</span>
                        <span className={`text-[11px] font-mono ${varianceGood ? 'text-success' : varianceBad ? 'text-danger' : 'text-warning'}`}>
                          {record.priceVariance > 0 ? '+' : ''}{record.priceVariance.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mb-2">
                      <div><span className="text-[10px] text-text-muted uppercase block">Demand</span><DemandBadge forecast={record.demandForecast} /></div>
                      <div><span className="text-[10px] text-text-muted uppercase block">Outcome</span><span className={`text-[11px] font-bold ${outcomeColors[record.outcomeClassification] ?? 'text-text-secondary'}`}>{record.outcomeClassification}</span></div>
                    </div>
                  </div>

                  {/* Flags */}
                  {record.failureFlags.length > 0 && (
                    <div className="mb-4">
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block mb-2">Flags</span>
                      <div className="flex flex-wrap gap-1.5">
                        {record.failureFlags.map((flag: FailureFlag) => (
                          <span key={flag} className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${flagColors[flag] ?? 'bg-warning-dim text-warning'}`}>{flag}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Source - Collapsible */}
                  <div className="mb-4">
                    <button onClick={() => setSourceExpanded(!sourceExpanded)}
                      className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors cursor-pointer">
                      <span>Source Message</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`transition-transform duration-200 ${sourceExpanded ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <AnimatePresence>
                      {sourceExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                          <div className="mt-2 p-2 bg-bg-card border border-border-default rounded font-mono text-[11px] text-text-secondary whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">{record.rawMessage}</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Processing Log */}
                  <div className="mb-4">
                    <span className="text-[10px] text-text-muted uppercase tracking-[0.08em] block mb-2">Processing Log</span>
                    <div className="relative pl-3">
                      <div className="absolute left-[6px] top-2 bottom-2 w-px bg-border-default" />
                      {record.pipelineLog.map((stage, idx) => (
                        <div key={idx} className="flex items-start gap-3 py-1 relative">
                          <div className="relative z-[1] mt-0.5"><StageDot color={stageColors[stage.name] ?? '#6B7280'} state={getStageDotState(stage)} size={8} /></div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-bold uppercase" style={{ color: stageColors[stage.name] ?? '#6B7280' }}>{stage.name}</span>
                            <span className="text-[10px] text-text-secondary block">{stage.message}</span>
                            <span className="text-[9px] text-text-muted font-mono">{formatTimestamp(stage.timestamp)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Footer */}
            <motion.div custom={3} variants={contentVariants} initial="hidden" animate="visible"
              className="flex items-center justify-between px-5 py-4 border-t border-border-default flex-shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {editing ? (
                  <button onClick={handleSaveLocal}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold bg-gold-primary text-bg-primary hover:bg-gold-bright transition-colors cursor-pointer">
                    <Play size={14} /> Save & Re-run
                  </button>
                ) : (
                  <button onClick={() => onApprove(record)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-success-dim text-success hover:bg-success hover:text-bg-primary transition-colors cursor-pointer">
                    <Check size={14} /> Approve
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editing ? (
                  <button onClick={handleToggleEdit}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-bg-elevated text-text-muted hover:text-text-primary transition-colors cursor-pointer">
                    <RotateCcw size={14} /> Cancel
                  </button>
                ) : (
                  <>
                    <button onClick={handleToggleEdit}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-bg-elevated text-text-primary border border-border-default hover:bg-[rgba(201,169,110,0.15)] hover:text-gold-primary transition-colors cursor-pointer">
                      <Settings size={14} /> Edit
                    </button>
                    <button onClick={() => onFlag(record)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-warning-dim text-warning hover:bg-warning hover:text-bg-primary transition-colors cursor-pointer">
                      <AlertTriangle size={14} /> Flag
                    </button>
                    <button onClick={() => onDelete(record)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-danger-dim text-danger border border-danger/30 hover:bg-danger hover:text-white transition-colors cursor-pointer">
                      <Trash2 size={14} /> Delete
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
