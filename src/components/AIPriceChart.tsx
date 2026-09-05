import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { WatchRecord } from '@/types';

interface DataPoint {
  x: number;
  y: number;
  brand: string;
  reference: string;
  variance: number;
}

interface AIPriceChartProps {
  records: WatchRecord[];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DataPoint }> }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-bg-elevated border border-border-hover rounded-md p-3 shadow-elevated text-xs">
      <p className="font-mono font-semibold text-text-primary">{d.reference}</p>
      <p className="text-text-secondary">{d.brand}</p>
      <p className="text-gold-primary mt-1">Actual: ${d.x.toLocaleString()}</p>
      <p className="text-purple">Predicted: ${d.y.toLocaleString()}</p>
      <p className={`mt-1 ${Math.abs(d.variance) <= 10 ? 'text-success' : Math.abs(d.variance) <= 20 ? 'text-warning' : 'text-danger'}`}>
        Variance: {d.variance > 0 ? '+' : ''}{d.variance.toFixed(1)}%
      </p>
    </div>
  );
}

export function AIPriceChart({ records }: AIPriceChartProps) {
  const data = useMemo<DataPoint[]>(() => {
    return records
      .filter((r) => r.price > 0 && r.mlPredictedPrice > 0)
      .map((r) => ({
        x: r.price,
        y: r.mlPredictedPrice,
        brand: r.brand,
        reference: r.reference,
        variance: r.priceVariance,
      }));
  }, [records]);

  const maxVal = useMemo(() => {
    let m = 100000;
    for (const d of data) { if (d.x > m) m = d.x; if (d.y > m) m = d.y; }
    return m * 1.1;
  }, [data]);

  if (data.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-1">
        ML Price Prediction Accuracy
      </h4>
      <p className="text-[10px] text-text-muted mb-3">
        XGBoost model — Predicted vs Actual (USD). Points on diagonal = perfect prediction.
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
          <XAxis
            type="number"
            dataKey="x"
            name="Actual"
            domain={[0, maxVal]}
            tick={{ fontSize: 10, fill: '#6B7280' }}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            stroke="#1E1E2E"
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Predicted"
            domain={[0, maxVal]}
            tick={{ fontSize: 10, fill: '#6B7280' }}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            stroke="#1E1E2E"
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine stroke="#C9A96E" strokeDasharray="4 4" segment={[{ x: 0, y: 0 }, { x: maxVal, y: maxVal }]} />
          <Scatter
            data={data}
            fill="#8B5CF6"
            fillOpacity={0.7}
            stroke="#8B5CF6"
            strokeWidth={1}
            r={4}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
