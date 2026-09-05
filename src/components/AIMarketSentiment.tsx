import { useMemo } from 'react';
import type { WatchRecord } from '@/types';

interface AIMarketSentimentProps {
  records: WatchRecord[];
}

export function AIMarketSentiment({ records }: AIMarketSentimentProps) {
  const sentiment = useMemo(() => {
    const norm = records.filter((r) => !r.isResidue);
    const total = norm.length || 1;
    const highDemand = norm.filter((r) => r.demandForecast === 'HIGH' || r.demandForecast === 'RISING').length;
    const avgConf = norm.reduce((s, r) => s + (r.confidence || 0), 0) / total;
    const avgVariance = norm.reduce((s, r) => s + Math.abs(r.priceVariance || 0), 0) / total;

    const bullish = (highDemand / total) * 100;
    const score = Math.min(100, Math.round(bullish * 0.5 + (avgConf / 100) * 30 + (1 - avgVariance / 50) * 20));

    let label = 'NEUTRAL';
    let color = '#F59E0B';
    if (score >= 70) { label = 'BULLISH'; color = '#22C55E'; }
    else if (score >= 50) { label = 'MODERATE'; color = '#3B82F6'; }
    else if (score >= 30) { label = 'CAUTIOUS'; color = '#F59E0B'; }
    else { label = 'BEARISH'; color = '#EF4444'; }

    return { score, label, color, bullish: Math.round(bullish), avgConf: Math.round(avgConf) };
  }, [records]);

  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (sentiment.score / 100) * circumference;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">
        Market Sentiment Index
      </h4>
      <div className="flex items-center justify-center py-2">
        <div className="relative w-24 h-24">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="36" fill="none" stroke="#1E1E2E" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="36"
              fill="none"
              stroke={sentiment.color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold font-mono" style={{ color: sentiment.color }}>
              {sentiment.score}
            </span>
            <span className="text-[8px] uppercase tracking-wider text-text-muted">/100</span>
          </div>
        </div>
      </div>
      <div className="text-center mt-1">
        <span
          className="text-xs font-bold uppercase tracking-[0.08em]"
          style={{ color: sentiment.color }}
        >
          {sentiment.label}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex justify-between text-[10px]">
          <span className="text-text-muted">Bullish Demand</span>
          <span className="text-success font-mono">{sentiment.bullish}%</span>
        </div>
        <div className="w-full h-1 bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-success rounded-full" style={{ width: `${sentiment.bullish}%` }} />
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-text-muted">Avg Confidence</span>
          <span className="text-info font-mono">{sentiment.avgConf}%</span>
        </div>
        <div className="w-full h-1 bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-info rounded-full" style={{ width: `${sentiment.avgConf}%` }} />
        </div>
      </div>
    </div>
  );
}
