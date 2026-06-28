import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { BrandBadge } from './ui/BrandBadge';

interface AIAnomaliesProps {
  records: WatchRecord[];
  onSelect: (record: WatchRecord) => void;
}

interface Anomaly {
  record: WatchRecord;
  type: 'PRICE_SPIKE' | 'PRICE_DROP' | 'HIGH_VARIANCE';
  severity: 'critical' | 'warning';
  message: string;
}

export function AIAnomalies({ records, onSelect }: AIAnomaliesProps) {
  const anomalies = useMemo<Anomaly[]>(() => {
    const result: Anomaly[] = [];
    records.forEach((r) => {
      const mlPrice = r.mlPredictedPrice ?? 0;
      const priceVar = r.priceVariance ?? 0;
      if (!r.isResidue && r.price > 0 && mlPrice > 0) {
        const variance = Math.abs(priceVar);
        if (r.price > 2000000 && priceVar > 15) {
          result.push({
            record: r,
            type: 'PRICE_SPIKE',
            severity: 'critical',
            message: `Price $${r.price.toLocaleString()} is ${priceVar.toFixed(1)}% above ML prediction`,
          });
        } else if (r.price > 500000 && variance > 25) {
          result.push({
            record: r,
            type: 'HIGH_VARIANCE',
            severity: 'warning',
            message: `${priceVar > 0 ? '+' : ''}${priceVar.toFixed(1)}% variance from predicted $${mlPrice.toLocaleString()}`,
          });
        }
      }
      if (r.isResidue && r.failureFlags?.includes('PRICE_OUTLIER')) {
        result.push({
          record: r,
          type: 'PRICE_SPIKE',
          severity: 'critical',
          message: `Flagged as price outlier: $${r.price.toLocaleString()}`,
        });
      }
    });
    return result.sort((a, _b) => (a.severity === 'critical' ? -1 : 1)).slice(0, 8);
  }, [records]);

  const criticalCount = anomalies.filter((a) => a.severity === 'critical').length;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={14} className={criticalCount > 0 ? 'text-danger' : 'text-warning'} />
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
            AI Anomaly Detection
          </h4>
        </div>
        {criticalCount > 0 && (
          <span className="text-[10px] font-bold text-danger bg-danger-dim rounded-full px-2 py-0.5">
            {criticalCount} critical
          </span>
        )}
      </div>
      <p className="text-[10px] text-text-muted mb-3">
        XGBoost outlier detection — flags records with significant price deviations
      </p>

      <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
        <AnimatePresence>
          {anomalies.length === 0 ? (
            <p className="text-[11px] text-text-muted text-center py-4">No anomalies detected</p>
          ) : (
            anomalies.map((a, i) => (
              <motion.div
                key={`${a.record.id}-${a.type}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => onSelect(a.record)}
                className={`flex items-start gap-2 p-2 rounded cursor-pointer transition-colors hover:bg-bg-elevated border-l-2 ${
                  a.severity === 'critical' ? 'border-l-danger bg-danger-dim/30' : 'border-l-warning bg-warning-dim/20'
                }`}
              >
                {a.type === 'PRICE_SPIKE' ? (
                  <TrendingUp size={12} className="text-danger mt-0.5 shrink-0" />
                ) : a.type === 'PRICE_DROP' ? (
                  <TrendingDown size={12} className="text-success mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle size={12} className="text-warning mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <BrandBadge brand={a.record.brand} />
                    <span className="font-mono text-[10px] text-text-primary truncate">
                      {a.record.reference}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary mt-0.5 leading-relaxed">
                    {a.message}
                  </p>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
