import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, Trash2, Edit3, ChevronDown, ChevronUp, Filter, Camera, UserCheck, XCircle, RefreshCw } from 'lucide-react';
import type { WatchRecord } from '@/types';

interface EnhancedResidueProps {
  records: WatchRecord[];
  onApprove: (record: WatchRecord) => void;
  onEdit: (record: WatchRecord) => void;
  onDelete: (record: WatchRecord) => void;
  approvedRecords: Set<string>;
  deletedRecords: Set<string>;
  reviewedRecords: Set<string>;
}

type SortKey = 'id' | 'reference' | 'price' | 'confidence' | 'severity';
type SortDir = 'asc' | 'desc';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  INFO: 1,
};

const FLAG_COLORS: Record<string, string> = {
  PRICE_OUTLIER: '#EF4444',
  INCOMPLETE_REFERENCE: '#F59E0B',
  YEAR_MISSING: '#3B82F6',
  DIAL_UNKNOWN: '#8B5CF6',
  BOXPAPERS_UNKNOWN: '#6B7280',
  LOW_SELLER_RATING: '#EC4899',
  BRAND_UNCERTAIN: '#14B8A6',
  CURRENCY_MISMATCH: '#F97316',
  LOW_CONFIDENCE: '#F59E0B',
  PRICE_MISSING: '#EF4444',
};

const FLAG_EXPLANATIONS: Record<string, string> = {
  PRICE_OUTLIER: 'Price significantly above market range — possible error or scam',
  INCOMPLETE_REFERENCE: 'Reference number missing or malformed — cannot identify watch',
  YEAR_MISSING: 'Production year not found in listing',
  DIAL_UNKNOWN: 'Dial color not specified — image may resolve this',
  BOXPAPERS_UNKNOWN: 'Box/papers status unclear',
  LOW_SELLER_RATING: 'Seller has poor rating history',
  BRAND_UNCERTAIN: 'Brand identification failed',
  CURRENCY_MISMATCH: 'Currency format unrecognized',
  LOW_CONFIDENCE: 'Overall data quality too low for auto-publishing',
  PRICE_MISSING: 'No price found in listing — cannot value',
};

export function EnhancedResidue({
  records, onApprove, onEdit, onDelete,
  approvedRecords, deletedRecords, reviewedRecords
}: EnhancedResidueProps) {
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterFlag, setFilterFlag] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showReviewed, setShowReviewed] = useState(false);

  // Filter out deleted records, show approved as reviewed
  const activeResidue = useMemo(() => {
    return records.filter((r) => {
      if (deletedRecords.has(r.id)) return false; // Hide deleted
      if (!showReviewed && reviewedRecords.has(r.id) && !approvedRecords.has(r.id)) return false; // Hide reviewed unless showing all
      return r.isResidue || approvedRecords.has(r.id); // Show residue + approved
    });
  }, [records, deletedRecords, reviewedRecords, approvedRecords, showReviewed]);

  // Auto-resolution stats
  const imageConfirmedCount = useMemo(() => records.filter((r) => r.imageConfirmed).length, [records]);
  const totalReviewed = reviewedRecords.size + approvedRecords.size;

  // Get all unique flags from active residue
  const allFlags = useMemo(() => {
    const flags = new Set<string>();
    activeResidue.forEach((r) => r.failureFlags?.forEach((f) => flags.add(f)));
    return Array.from(flags);
  }, [activeResidue]);

  // Sort and filter
  const sorted = useMemo(() => {
    let filtered = filterFlag === 'all'
      ? activeResidue
      : activeResidue.filter((r) => r.failureFlags?.includes(filterFlag));

    filtered = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id': cmp = a.id.localeCompare(b.id); break;
        case 'reference': cmp = (a.reference || '').localeCompare(b.reference || ''); break;
        case 'price': cmp = (a.price || 0) - (b.price || 0); break;
        case 'confidence': cmp = (a.confidence || 0) - (b.confidence || 0); break;
        case 'severity': cmp = (SEVERITY_ORDER[a.severity || 'INFO'] || 0) - (SEVERITY_ORDER[b.severity || 'INFO'] || 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [activeResidue, sortKey, sortDir, filterFlag]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-text-muted/30 ml-1">↕</span>;
    return sortDir === 'asc' ? <ChevronUp size={10} className="ml-1 text-gold-primary" /> : <ChevronDown size={10} className="ml-1 text-gold-primary" />;
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 md:px-5 mt-8 mb-8"
    >
      {/* Header with stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <AlertTriangle size={14} className="text-warning" />
            <span className="text-lg font-bold font-mono text-warning">{activeResidue.length}</span>
          </div>
          <div className="text-[8px] text-text-muted uppercase mt-0.5">Active Residue</div>
        </div>
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <Camera size={14} className="text-success" />
            <span className="text-lg font-bold font-mono text-success">{imageConfirmedCount}</span>
          </div>
          <div className="text-[8px] text-text-muted uppercase mt-0.5">Image Confirmed</div>
        </div>
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <UserCheck size={14} className="text-info" />
            <span className="text-lg font-bold font-mono text-info">{totalReviewed}</span>
          </div>
          <div className="text-[8px] text-text-muted uppercase mt-0.5">Human Reviewed</div>
        </div>
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <CheckCircle size={14} className="text-success" />
            <span className="text-lg font-bold font-mono text-success">{approvedRecords.size}</span>
          </div>
          <div className="text-[8px] text-text-muted uppercase mt-0.5">Approved to Publish</div>
        </div>
      </div>

      {/* Title bar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <AlertTriangle size={16} className="text-warning" />
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">
            Human Review Required
          </h2>
          <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded-full">
            {sorted.length} items
          </span>
          {approvedRecords.size > 0 && (
            <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded-full">
              {approvedRecords.size} approved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReviewed(!showReviewed)}
            className={`text-[10px] px-2 py-1 rounded border transition-colors ${showReviewed ? 'bg-info/10 border-info text-info' : 'bg-bg-elevated border-border-default text-text-muted'}`}
          >
            {showReviewed ? 'Hide Reviewed' : 'Show Reviewed'}
          </button>
          <Filter size={12} className="text-text-muted" />
          <select
            value={filterFlag}
            onChange={(e) => setFilterFlag(e.target.value)}
            className="bg-bg-elevated border border-border-default rounded px-2 py-1 text-[11px] text-text-primary"
          >
            <option value="all">All Flags</option>
            {allFlags.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Explanation banner */}
      <div className="bg-bg-elevated border border-border-default rounded-md p-3 mb-4 text-[11px] text-text-secondary">
        <span className="text-gold-primary font-semibold">How this works: </span>
        Each flagged record needs human review. Click a row to expand details. 
        Approve to publish, Edit to fix and re-run, or Discard to remove. 
        Records with images are pre-checked by AI but still need your confirmation.
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border-default rounded-md overflow-hidden">
        <div className="mobile-table-scroll">
          <div className="grid grid-cols-[60px_100px_80px_100px_80px_100px_180px] gap-2 px-4 py-2 bg-bg-elevated border-b border-border-default text-[10px] font-bold uppercase tracking-wider text-text-muted min-w-[700px]">
            <button onClick={() => handleSort('id')} className="text-left flex items-center">ID <SortIcon col="id" /></button>
            <button onClick={() => handleSort('reference')} className="text-left flex items-center">Ref <SortIcon col="reference" /></button>
            <button onClick={() => handleSort('price')} className="text-right flex items-center justify-end">Price <SortIcon col="price" /></button>
            <span className="text-left">Why Flagged</span>
            <button onClick={() => handleSort('severity')} className="text-left flex items-center">Sev <SortIcon col="severity" /></button>
            <button onClick={() => handleSort('confidence')} className="text-right flex items-center justify-end">Conf <SortIcon col="confidence" /></button>
            <span className="text-right">Actions</span>
          </div>
        </div>

        {/* Table Rows */}
        <div className="max-h-[500px] overflow-y-auto mobile-table-scroll">
          {sorted.length === 0 ? (
            <div className="p-8 text-center text-[11px] text-text-muted">
              {showReviewed ? 'All reviewed items resolved' : 'No active residue items'}
            </div>
          ) : (
            sorted.map((record) => {
              const isApproved = approvedRecords.has(record.id);
              const isDeleted = deletedRecords.has(record.id);
              
              return (
                <div key={record.id}>
                  <div
                    className={`grid grid-cols-[60px_100px_80px_100px_80px_100px_180px] gap-2 px-4 py-2 border-b border-border-default/50 hover:bg-bg-elevated transition-colors items-center min-w-[700px] ${isApproved ? 'opacity-60' : ''}`}
                    onClick={() => toggleRow(record.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* ID */}
                    <span className="font-mono text-[11px] text-text-primary flex items-center gap-1">
                      {isApproved && <CheckCircle size={10} className="text-success" />}
                      {isDeleted && <XCircle size={10} className="text-danger" />}
                      {record.id}
                    </span>

                    {/* Reference */}
                    <span className={`font-mono text-[11px] truncate ${isApproved ? 'text-success line-through' : 'text-gold-primary'}`}>
                      {record.reference || 'N/A'}
                    </span>

                    {/* Price */}
                    <span className="text-right font-mono text-[11px] text-text-primary">
                      {record.price ? `$${record.price.toLocaleString()}` : '—'}
                    </span>

                    {/* Flag reason */}
                    <div className="flex flex-wrap gap-1">
                      {record.failureFlags?.slice(0, 2).map((flag) => (
                        <span
                          key={flag}
                          className="text-[8px] px-1 py-0.5 rounded"
                          style={{ background: `${FLAG_COLORS[flag] || '#6B7280'}20`, color: FLAG_COLORS[flag] || '#6B7280' }}
                        >
                          {flag}
                        </span>
                      ))}
                    </div>

                    {/* Severity */}
                    <div className="flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          background: record.severity === 'CRITICAL' ? '#EF4444' : record.severity === 'WARNING' ? '#F59E0B' : '#3B82F6',
                        }}
                      />
                      <span className="text-[10px] text-text-secondary">{record.severity}</span>
                    </div>

                    {/* Confidence */}
                    <div className="text-right">
                      <span className={`text-[11px] font-mono font-bold ${(record.confidence || 0) >= 70 ? 'text-success' : 'text-warning'}`}>
                        {record.confidence || 0}%
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1">
                      {!isApproved && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onApprove(record); }}
                          className="p-1.5 rounded hover:bg-success/20 text-success transition-colors tap-target"
                          title="Approve & Publish"
                        >
                          <CheckCircle size={14} />
                        </button>
                      )}
                      {!isApproved && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onEdit(record); }}
                          className="p-1.5 rounded hover:bg-info/20 text-info transition-colors tap-target"
                          title="Edit & Re-run"
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      {!isDeleted && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(record); }}
                          className="p-1.5 rounded hover:bg-danger/20 text-danger transition-colors tap-target"
                          title="Discard"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  <AnimatePresence>
                    {expandedRows.has(record.id) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-bg-elevated/50 border-b border-border-default px-4 py-3 overflow-hidden"
                      >
                        {/* Status banner */}
                        {isApproved && (
                          <div className="bg-success/10 border border-success/30 rounded p-2 mb-2 text-[10px] text-success flex items-center gap-2">
                            <CheckCircle size={12} />
                            Approved by human review — published to inventory
                          </div>
                        )}
                        {isDeleted && (
                          <div className="bg-danger/10 border border-danger/30 rounded p-2 mb-2 text-[10px] text-danger flex items-center gap-2">
                            <XCircle size={12} />
                            Discarded by human review — removed from pipeline
                          </div>
                        )}

                        {/* Raw source */}
                        <div className="mb-2">
                          <span className="text-[9px] text-text-muted uppercase">Original Message</span>
                          <p className="text-[10px] text-text-secondary font-mono break-all mt-0.5 bg-bg-card p-2 rounded">
                            {record.rawMessage}
                          </p>
                        </div>

                        {/* Why flagged explanation */}
                        <div className="mb-2">
                          <span className="text-[9px] text-text-muted uppercase">Why Flagged</span>
                          <div className="mt-0.5 space-y-1">
                            {record.failureFlags?.map((flag) => (
                              <div key={flag} className="flex items-start gap-2">
                                <span
                                  className="w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                                  style={{ background: FLAG_COLORS[flag] || '#6B7280' }}
                                />
                                <span className="text-[10px] text-text-secondary">
                                  <span className="font-semibold" style={{ color: FLAG_COLORS[flag] }}>{flag}</span>
                                  {' — '}
                                  {FLAG_EXPLANATIONS[flag] || 'Manual review required'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Image if available */}
                        {record.imageUrl && (
                          <div className="mb-2">
                            <span className="text-[9px] text-text-muted uppercase flex items-center gap-1">
                              <Camera size={8} /> Image Available
                            </span>
                            <img
                              src={record.imageUrl}
                              alt={record.reference}
                              className="w-24 h-24 object-cover rounded mt-1 border border-border-default"
                              loading="lazy"
                            />
                          </div>
                        )}

                        {/* Auto-resolved flags */}
                        {record.autoResolvedFlags && record.autoResolvedFlags.length > 0 && (
                          <div className="mb-2">
                            <span className="text-[9px] text-success uppercase flex items-center gap-1">
                              <RefreshCw size={8} /> AI Auto-Resolved
                            </span>
                            {record.autoResolvedFlags.map((flag) => (
                              <span key={flag} className="text-[9px] bg-success/10 text-success px-1.5 py-0.5 rounded line-through opacity-70 mr-1">
                                {flag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Action buttons in expanded view */}
                        {!isApproved && !isDeleted && (
                          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border-default">
                            <button
                              onClick={() => onApprove(record)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-success/10 hover:bg-success/20 text-success rounded text-[10px] font-semibold transition-colors"
                            >
                              <CheckCircle size={12} /> Approve & Publish
                            </button>
                            <button
                              onClick={() => onEdit(record)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-info/10 hover:bg-info/20 text-info rounded text-[10px] font-semibold transition-colors"
                            >
                              <Edit3 size={12} /> Edit & Re-run
                            </button>
                            <button
                              onClick={() => onDelete(record)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-danger/10 hover:bg-danger/20 text-danger rounded text-[10px] font-semibold transition-colors"
                            >
                              <Trash2 size={12} /> Discard
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>
    </motion.section>
  );
}
