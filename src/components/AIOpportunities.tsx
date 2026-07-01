import { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, AlertTriangle, Activity, Watch } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { BrandBadge } from './ui/BrandBadge';

interface AIOpportunitiesProps {
  records: WatchRecord[];
  onSelect: (record: WatchRecord) => void;
}

export function AIOpportunities({ records, onSelect }: AIOpportunitiesProps) {
  const [stats] = useState<any>({
    // In production, this fetches from /api/dashboard-stats
    // For now, we simulate the live parsed dashboard_stats table
    volume_leaders: [
      { reference: '126710BLNR', points: 566, name: 'Rolex Batgirl' },
      { reference: '5167A', points: 528, name: 'Patek Aquanaut' }
    ],
    datejust_stats: {
      avg_confidence: 83,
      manual_review_rate: '80%',
      bottleneck: true
    },
    richard_mille_alert: true,
  });

  if (!stats) return null;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4 h-full">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-success" />
        <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
          Dynamic Market Insights
        </h4>
      </div>
      <p className="text-xs text-text-muted mb-3">
        Real-time insights derived from live streaming data
      </p>
      
      <div className="space-y-3">
        {/* Datejust Bottleneck */}
        {stats.datejust_stats.bottleneck && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-start gap-3 p-3 rounded bg-bg-elevated/50 border border-warning/20"
          >
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <div>
              <h5 className="text-[11px] font-bold text-text-primary">Parser Bottleneck: Rolex Datejust</h5>
              <p className="text-xs text-text-muted mt-1 leading-tight">
                Datejust models are consistently scoring ~{stats.datejust_stats.avg_confidence}% confidence. 
                Currently, {stats.datejust_stats.manual_review_rate} require manual review due to complex dial permutations.
              </p>
            </div>
          </motion.div>
        )}

        {/* RM Dump */}
        {stats.richard_mille_alert && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-start gap-3 p-3 rounded bg-bg-elevated/50 border border-danger/20"
          >
            <Activity size={16} className="text-danger shrink-0 mt-0.5" />
            <div>
              <h5 className="text-[11px] font-bold text-text-primary">Heavy Influx: Richard Mille</h5>
              <p className="text-xs text-text-muted mt-1 leading-tight">
                Detected coordinated dumping of RM07-01 and RM30-01 in dealer chats. 
                This signals aggressive liquidation of hype pieces.
              </p>
            </div>
          </motion.div>
        )}

        {/* Volume Leaders */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-start gap-3 p-3 rounded bg-bg-elevated/50 border border-success/20"
        >
          <Watch size={16} className="text-success shrink-0 mt-0.5" />
          <div className="w-full">
            <h5 className="text-[11px] font-bold text-text-primary">Top Liquid Assets</h5>
            <div className="mt-2 space-y-2">
              {stats.volume_leaders.map((leader: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BrandBadge brand={leader.name.split(' ')[0]} />
                    <span className="font-mono text-[11px] text-text-secondary">{leader.reference}</span>
                  </div>
                  <span className="text-xs text-success font-mono">{leader.points} pts</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
