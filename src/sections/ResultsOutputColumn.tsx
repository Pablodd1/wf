import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { BrandBadge } from '@/components/ui/BrandBadge';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import type { ResultCard } from '@/hooks/usePipelineSimulation';
import { confidencePercent } from '@/lib/confidence';

interface ResultsOutputColumnProps {
  cards: ResultCard[];
  normalizedTotal: number;
  residueTotal: number;
}

const cardVariants = {
  initial: { x: 60, opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15, duration: 0.5 },
  },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

const NormalizedCard = memo(function NormalizedCard({ card }: { card: ResultCard }) {
  const { record } = card;
  const confidencePct = confidencePercent(record.confidence);

  return (
    <motion.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      layout
      className="rounded-md p-2.5 cursor-default"
      style={{
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        borderLeft: '3px solid #22C55E',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
      whileHover={{ y: -4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', transition: { duration: 0.3 } }}
    >
      {/* Top Row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={14} className="text-success" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-success">
            NORMALIZED
          </span>
        </div>
        <span className="text-[11px] font-mono font-bold text-success">{confidencePct}%</span>
      </div>

      {/* Reference */}
      <div className="text-[13px] font-mono font-semibold text-text-primary mb-1 truncate">
        {record.reference || 'UNKNOWN'}
      </div>

      {/* Brand Badge */}
      <div className="mb-1.5">
        <BrandBadge brand={record.brand || 'UNKNOWN'} />
      </div>

      {/* Data Row: Price, Condition */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className="text-xs font-semibold text-text-primary">
          ${record.price != null ? record.price.toLocaleString() : 'N/A'}
        </span>
        {record.dialColor && (
          <div className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{
                backgroundColor: record.dialColor.toLowerCase() === 'blue' ? '#3B82F6'
                  : record.dialColor.toLowerCase() === 'black' ? '#1F1F1F'
                  : record.dialColor.toLowerCase() === 'silver' ? '#C0C0C0'
                  : record.dialColor.toLowerCase() === 'green' ? '#22C55E'
                  : record.dialColor.toLowerCase() === 'brown' ? '#8B4513'
                  : record.dialColor.toLowerCase() === 'white' ? '#F5F5F5'
                  : record.dialColor.toLowerCase() === 'grey' || record.dialColor.toLowerCase() === 'gray' ? '#808080'
                  : '#C9A96E',
              }}
            />
            <span className="text-[10px] text-text-secondary">{record.dialColor}</span>
          </div>
        )}
        {record.condition && <ConditionBadge condition={record.condition} />}
      </div>

      {/* Confidence bar */}
      <div className="w-full h-1 rounded-full bg-bg-elevated mb-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-success to-success/50"
          style={{ width: `${confidencePct}%` }}
        />
      </div>

      {/* Bottom row */}
      <button className="text-[10px] text-gold-primary hover:underline cursor-pointer bg-transparent border-none p-0">
        View Details
      </button>
    </motion.div>
  );
});

const ResidueCard = memo(function ResidueCard({ card }: { card: ResultCard }) {
  const { record } = card;
  const flags = record.failureFlags || [];

  return (
    <motion.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      layout
      className="rounded-md p-2.5 cursor-default"
      style={{
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        borderLeft: '3px solid #EF4444',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
      whileHover={{ y: -4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', transition: { duration: 0.3 } }}
    >
      {/* Top Row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-danger" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-danger">
            RESIDUE
          </span>
        </div>
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
          style={{
            backgroundColor: record.severity === 'CRITICAL' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
            color: record.severity === 'CRITICAL' ? '#EF4444' : '#F59E0B',
          }}
        >
          {record.severity || 'WARNING'}
        </span>
      </div>

      {/* Reference */}
      <div className="text-[13px] font-mono font-semibold text-text-primary mb-1 truncate">
        {record.reference || 'UNKNOWN REFERENCE'}
      </div>

      {/* Detected info */}
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] text-text-secondary">
          Brand: <span className="text-text-primary">{record.brand || '?'}</span>
        </span>
        <span className="text-[10px] text-text-secondary">
          Price: <span className="text-text-primary">${record.price != null ? record.price.toLocaleString() : '?'}</span>
        </span>
      </div>

      {/* Failure Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {flags.map((flag) => (
            <span
              key={flag}
              className="text-[9px] font-semibold text-danger px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
            >
              {flag}
            </span>
          ))}
        </div>
      )}

      {/* Review button */}
      <button className="text-[10px] text-text-secondary bg-bg-elevated border border-border-default rounded px-2 py-1 hover:bg-bg-card hover:text-text-primary transition-colors cursor-pointer">
        Review
      </button>
    </motion.div>
  );
});

export const ResultsOutputColumn = memo(function ResultsOutputColumn({
  cards,
  normalizedTotal,
  residueTotal,
}: ResultsOutputColumnProps) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-col overflow-hidden" style={{ minHeight: 520 }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-border-default flex-shrink-0">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
          RESULTS OUTPUT
        </span>
        <span className="text-[10px] text-muted">
          {normalizedTotal.toLocaleString()} norm / {residueTotal.toLocaleString()} res
        </span>
      </div>

      {/* Cards stack */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2" style={{ scrollbarWidth: 'thin' }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {cards.map((card) => (
            card.type === 'normalized'
              ? <NormalizedCard key={card.id} card={card} />
              : <ResidueCard key={card.id} card={card} />
          ))}
        </AnimatePresence>
        {cards.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            Waiting for pipeline output...
          </div>
        )}
      </div>
    </div>
  );
});
