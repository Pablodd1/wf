import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, ArrowUpRight, Star } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { BrandBadge } from './ui/BrandBadge';
import { ConfidenceRing } from './ui/ConfidenceRing';

interface AIOpportunitiesProps {
  records: WatchRecord[];
  onSelect: (record: WatchRecord) => void;
}

export function AIOpportunities({ records, onSelect }: AIOpportunitiesProps) {
  const opportunities = useMemo(() => {
    return records
      .filter((r) => !r.isResidue && r.confidence >= 70)
      .map((r) => {
        const demandScore = r.demandForecast === 'HIGH' ? 3 : r.demandForecast === 'RISING' ? 2 : r.demandForecast === 'STABLE' ? 1 : 0;
        const score = (r.confidence / 100) * 40 + demandScore * 20 + (r.sellerRating / 5) * 20 + (r.marketComparables / 15) * 20;
        return { record: r, score: Math.round(score) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [records]);

  if (opportunities.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-success" />
        <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
          AI Top Opportunities
        </h4>
      </div>
      <p className="text-[10px] text-text-muted mb-3">
        Highest composite score: confidence + demand + seller rating + market depth
      </p>
      <div className="space-y-2">
        {opportunities.map(({ record, score }, i) => (
          <motion.div
            key={record.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            onClick={() => onSelect(record)}
            className="flex items-center gap-3 p-2 rounded hover:bg-bg-elevated cursor-pointer transition-colors group"
          >
            <span className="text-xs font-mono font-bold text-gold-primary w-6">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <BrandBadge brand={record.brand} />
                <span className="font-mono text-[11px] font-semibold text-text-primary truncate">
                  {record.reference}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
                <span>{record.demandForecast}</span>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Star size={8} className="text-gold-primary fill-gold-primary" />
                  {record.sellerRating.toFixed(1)}
                </span>
                <span>·</span>
                <span>{record.marketComparables} comps</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ConfidenceRing percentage={record.confidence} size={28} />
              <div className="text-right">
                <span className="text-[11px] font-mono font-bold text-success">{score}</span>
                <span className="text-[9px] text-text-muted block">score</span>
              </div>
              <ArrowUpRight
                size={12}
                className="text-text-muted opacity-0 group-hover:opacity-100 group-hover:text-gold-primary transition-all"
              />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
