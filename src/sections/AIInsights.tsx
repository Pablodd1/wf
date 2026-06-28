import { motion } from 'framer-motion';
import { Brain, Zap } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { AIPriceChart } from '@/components/AIPriceChart';
import { AIDemandChart } from '@/components/AIDemandChart';
import { AIBrandChart } from '@/components/AIBrandChart';
import { AIOpportunities } from '@/components/AIOpportunities';
import { AIAnomalies } from '@/components/AIAnomalies';
import { AIMarketSentiment } from '@/components/AIMarketSentiment';

interface AIInsightsProps {
  records: WatchRecord[];
  onSelectRecord: (record: WatchRecord) => void;
  totalProcessed?: number;
  normalizedCount?: number;
  residueCount?: number;
  accuracyRate?: number;
}

export function AIInsights({ 
  records, 
  onSelectRecord,
  totalProcessed,
  normalizedCount,
  residueCount,
  accuracyRate
}: AIInsightsProps) {
  const normalCount = normalizedCount ?? records.filter((r) => !r.isResidue).length;
  const resCount = residueCount ?? records.filter((r) => r.isResidue).length;
  const avgConf = accuracyRate ?? (records.filter((r) => !r.isResidue).length > 0
    ? Math.round(records.filter((r) => !r.isResidue).reduce((s, r) => s + r.confidence, 0) / records.filter((r) => !r.isResidue).length)
    : 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="px-5 mt-8 mb-8"
    >
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <Brain size={16} className="text-purple" />
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">
          AI Intelligence Center
        </h2>
        <div className="flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1 text-[10px] text-text-muted">
            <Zap size={10} className="text-purple" />
            {normalCount.toLocaleString()} analyzed
          </span>
          <span className="text-[10px] text-text-muted">·</span>
          <span className="text-[10px] text-text-muted">Avg Conf: {avgConf}%</span>
          <span className="text-[10px] text-text-muted">·</span>
          <span className="text-[10px] text-danger">{resCount.toLocaleString()} flagged</span>
        </div>
      </div>

      {/* AI Grid: 2 columns on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Row 1: Price prediction + Demand */}
        <AIPriceChart records={records} />
        <AIDemandChart records={records} />

        {/* Row 2: Brand chart + Market sentiment */}
        <AIBrandChart records={records} />
        <AIMarketSentiment records={records} />

        {/* Row 3: Opportunities + Anomalies */}
        <AIOpportunities records={records} onSelect={onSelectRecord} />
        <AIAnomalies records={records} onSelect={onSelectRecord} />
      </div>

      {/* Model info footer */}
      <div className="mt-4 flex items-center justify-center gap-6 text-[10px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-purple" />
          XGBoost Price Prediction
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          LSTM Demand Forecast
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warning" />
          3-Class Outcome Classification
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
          Anomaly Detection
        </span>
      </div>
    </motion.section>
  );
}
