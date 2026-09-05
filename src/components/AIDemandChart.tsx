import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { WatchRecord } from '@/types';

interface DemandData {
  name: string;
  count: number;
  color: string;
  avgConfidence: number;
}

interface AIDemandChartProps {
  records: WatchRecord[];
}

const COLORS: Record<string, string> = {
  HIGH: '#22C55E',
  RISING: '#3B82F6',
  STABLE: '#F59E0B',
  LOW: '#6B7280',
  DECLINING: '#EF4444',
};

export function AIDemandChart({ records }: AIDemandChartProps) {
  const data = useMemo<DemandData[]>(() => {
    const groups: Record<string, { count: number; confSum: number }> = {};
    records.forEach((r) => {
      const f = r.demandForecast || 'STABLE';
      if (!groups[f]) groups[f] = { count: 0, confSum: 0 };
      groups[f].count++;
      groups[f].confSum += r.confidence || 0;
    });
    return Object.entries(groups).map(([name, v]) => ({
      name,
      count: v.count,
      color: COLORS[name] || '#6B7280',
      avgConfidence: v.count > 0 ? Math.round(v.confSum / v.count) : 0,
    }));
  }, [records]);

  if (data.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-1">
        LSTM Demand Forecast
      </h4>
      <p className="text-[10px] text-text-muted mb-3">
        30-day demand trajectory from time-series analysis
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
          <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
          <Tooltip
            contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }}
            itemStyle={{ color: '#FFFFFF' }}
            formatter={(value: number) => [`${value} watches`, 'Count']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
