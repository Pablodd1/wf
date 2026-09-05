import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ChevronDown, Check, Pencil, Trash2 } from 'lucide-react';
import type { WatchRecord, FailureFlag } from '@/types';
import { BrandBadge } from './ui/BrandBadge';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ResidueBinProps {
  records: WatchRecord[];
  expanded: boolean;
  onToggle: () => void;
  onApprove: (record: WatchRecord) => void;
  onEdit: (record: WatchRecord) => void;
  onDelete: (record: WatchRecord) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GROUP_ORDER: FailureFlag[] = [
  'YEAR_MISSING',
  'DIAL_UNKNOWN',
  'INCOMPLETE_REFERENCE',
  'BOXPAPERS_UNKNOWN',
  'LOW_SELLER_RATING',
  'PRICE_OUTLIER',
  'BRAND_UNCERTAIN',
  'CURRENCY_MISMATCH',
];

const GROUP_META: Record<
  FailureFlag,
  { label: string; color: string; dim: string; borderColor: string }
> = {
  YEAR_MISSING: {
    label: 'YEAR MISSING',
    color: 'text-warning',
    dim: 'bg-warning-dim',
    borderColor: 'border-l-warning',
  },
  DIAL_UNKNOWN: {
    label: 'DIAL UNKNOWN',
    color: 'text-info',
    dim: 'bg-info-dim',
    borderColor: 'border-l-info',
  },
  INCOMPLETE_REFERENCE: {
    label: 'INCOMPLETE REFERENCE',
    color: 'text-[#F97316]',
    dim: 'bg-[rgba(249,115,22,0.15)]',
    borderColor: 'border-l-[#F97316]',
  },
  BOXPAPERS_UNKNOWN: {
    label: 'BOX/PAPERS UNKNOWN',
    color: 'text-text-muted',
    dim: 'bg-[rgba(107,114,128,0.15)]',
    borderColor: 'border-l-text-muted',
  },
  LOW_SELLER_RATING: {
    label: 'LOW SELLER RATING',
    color: 'text-purple',
    dim: 'bg-purple-dim',
    borderColor: 'border-l-purple',
  },
  PRICE_OUTLIER: {
    label: 'PRICE OUTLIER',
    color: 'text-danger',
    dim: 'bg-danger-dim',
    borderColor: 'border-l-danger',
  },
  BRAND_UNCERTAIN: {
    label: 'BRAND UNCERTAIN',
    color: 'text-warning',
    dim: 'bg-warning-dim',
    borderColor: 'border-l-warning',
  },
  CURRENCY_MISMATCH: {
    label: 'CURRENCY MISMATCH',
    color: 'text-info',
    dim: 'bg-info-dim',
    borderColor: 'border-l-info',
  },
};

const FLAG_CHIP_COLOR: Record<string, string> = {
  YEAR_MISSING: 'bg-warning-dim text-warning',
  DIAL_UNKNOWN: 'bg-info-dim text-info',
  INCOMPLETE_REFERENCE: 'bg-[rgba(249,115,22,0.15)] text-[#F97316]',
  BOXPAPERS_UNKNOWN: 'bg-[rgba(107,114,128,0.15)] text-text-muted',
  LOW_SELLER_RATING: 'bg-purple-dim text-purple',
  PRICE_OUTLIER: 'bg-danger-dim text-danger',
  BRAND_UNCERTAIN: 'bg-warning-dim text-warning',
  CURRENCY_MISMATCH: 'bg-info-dim text-info',
};

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function getPrimaryFlag(record: WatchRecord): FailureFlag {
  const flags = record.failureFlags;
  if (!flags || flags.length === 0) return 'YEAR_MISSING';
  for (const f of GROUP_ORDER) {
    if (flags.includes(f)) return f;
  }
  return flags[0];
}

function getCardBorderClass(flag: FailureFlag): string {
  return GROUP_META[flag]?.borderColor ?? 'border-l-text-muted';
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface ResidueItemCardProps {
  record: WatchRecord;
  groupFlag: FailureFlag;
  index: number;
  onApprove: (record: WatchRecord) => void;
  onEdit: (record: WatchRecord) => void;
  onDelete: (record: WatchRecord) => void;
}

const ResidueItemCard = memo(function ResidueItemCard({
  record,
  groupFlag,
  index,
  onApprove,
  onEdit,
  onDelete,
}: ResidueItemCardProps) {
  const borderClass = getCardBorderClass(groupFlag);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: index * 0.03,
        duration: 0.3,
        ease: [0, 0, 0.2, 1] as [number, number, number, number],
      }}
      className={`bg-bg-card border border-border-default ${borderClass} border-l-2 rounded-md p-3`}
    >
      {/* Source Line */}
      <p className="font-mono text-[11px] text-text-secondary line-clamp-2 leading-relaxed mb-2">
        {record.rawMessage}
      </p>

      {/* Detected Info */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {record.brand && <BrandBadge brand={record.brand} className="scale-90 origin-left" />}
        {record.price > 0 && (
          <span className="text-[11px] font-mono text-text-secondary">
            ${record.price.toLocaleString()}
          </span>
        )}
        {record.reference && (
          <span className="text-[11px] font-mono text-text-muted">{record.reference}</span>
        )}
      </div>

      {/* Failure Flags */}
      <div className="flex flex-wrap gap-1 mb-2">
        {record.failureFlags.map((flag) => (
          <span
            key={flag}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold ${FLAG_CHIP_COLOR[flag] ?? 'bg-danger-dim text-danger'}`}
          >
            {flag}
          </span>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={() => onApprove(record)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-success-dim text-success hover:bg-success hover:text-bg-primary transition-colors cursor-pointer"
          title="Approve & Publish"
        >
          <Check size={12} />
          Approve
        </button>
        <button
          onClick={() => onEdit(record)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-bg-elevated text-text-secondary border border-border-default hover:bg-[rgba(201,169,110,0.15)] hover:text-gold-primary transition-colors cursor-pointer"
          title="Edit Record"
        >
          <Pencil size={12} />
          Edit
        </button>
        <button
          onClick={() => onDelete(record)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-danger-dim text-danger hover:bg-danger hover:text-white transition-colors cursor-pointer"
          title="Delete Record"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

function ResidueBinInner({
  records,
  expanded,
  onToggle,
  onApprove,
  onEdit,
  onDelete,
}: ResidueBinProps) {
  const residueRecords = useMemo(() => records.filter((r) => r.isResidue), [records]);

  const grouped = useMemo(() => {
    const map = new Map<FailureFlag, WatchRecord[]>();
    for (const flag of GROUP_ORDER) {
      map.set(flag, []);
    }
    for (const r of residueRecords) {
      const primary = getPrimaryFlag(r);
      const existing = map.get(primary);
      if (existing) {
        existing.push(r);
      } else {
        map.set(primary, [r]);
      }
    }
    return map;
  }, [residueRecords]);

  return (
    <section className="px-5 mt-8 mb-8">
      {/* Toggle Bar */}
      <button
        onClick={onToggle}
        className="w-full h-11 bg-bg-card border border-border-default rounded-md px-4 flex items-center justify-between hover:border-border-hover transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-warning" />
          <span className="text-sm font-bold uppercase text-warning">RESIDUE BIN</span>
          <span className="text-[10px] font-semibold text-warning bg-warning-dim rounded-full px-2 py-0.5">
            {residueRecords.length} items
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted hidden sm:inline">
            {expanded ? 'Collapse' : 'Expand'}
          </span>
          <ChevronDown
            size={16}
            className={`text-muted transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
            className="overflow-hidden"
          >
            <div className="bg-bg-card border border-t-0 border-border-default rounded-b-md p-4">
              {residueRecords.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">No residue records to review</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {GROUP_ORDER.map((flag, groupIdx) => {
                    const items = grouped.get(flag) ?? [];
                    if (items.length === 0) return null;

                    const meta = GROUP_META[flag];

                    return (
                      <motion.div
                        key={flag}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          delay: groupIdx * 0.05,
                          duration: 0.3,
                          ease: [0, 0, 0.2, 1] as [number, number, number, number],
                        }}
                      >
                        {/* Group Header */}
                        <div className="flex items-center justify-between mb-2 px-1">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: flag === 'YEAR_MISSING' ? '#F59E0B' : flag === 'DIAL_UNKNOWN' ? '#3B82F6' : flag === 'INCOMPLETE_REFERENCE' ? '#F97316' : flag === 'BOXPAPERS_UNKNOWN' ? '#6B7280' : flag === 'LOW_SELLER_RATING' ? '#8B5CF6' : flag === 'BRAND_UNCERTAIN' ? '#F59E0B' : flag === 'CURRENCY_MISMATCH' ? '#3B82F6' : '#EF4444' }} />
                            <span className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>
                              {meta.label}
                            </span>
                            <span className="text-[10px] font-semibold text-text-muted bg-bg-elevated rounded-full px-2 py-0.5">
                              {items.length}
                            </span>
                          </div>
                        </div>

                        {/* Group Items */}
                        <div className="flex flex-col gap-2">
                          {items.map((record, itemIdx) => (
                            <ResidueItemCard
                              key={record.id}
                              record={record}
                              groupFlag={flag}
                              index={itemIdx}
                              onApprove={onApprove}
                              onEdit={onEdit}
                              onDelete={onDelete}
                            />
                          ))}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed subtitle */}
      <AnimatePresence>
        {!expanded && residueRecords.length > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-text-muted mt-2 px-1"
          >
            {residueRecords.length} items need review
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}

export const ResidueBin = memo(ResidueBinInner);
