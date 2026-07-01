import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { WatchRecord } from '@/types';

interface BrandData {
  brand: string;
  count: number;
  avgPrice: number;
  avgConfidence: number;
  color: string;
}

interface AIBrandChartProps {
  records: WatchRecord[];
}

const BRAND_COLORS: Record<string, string> = {
  'PATEK PHILIPPE': '#C9A96E',
  'ROLEX': '#22C55E',
  'AUDEMARS PIGUET': '#3B82F6',
  'RICHARD MILLE': '#EF4444',
  'VACHERON CONSTANTIN': '#8B5CF6',
  'F.P.JOURNE': '#14B8A6',
  'CARTIER': '#F59E0B',
};

export function AIBrandChart({ records }: AIBrandChartProps) {
  const data = useMemo<BrandData[]>(() => {
    const groups: Record<string, { count: number; priceSum: number; confSum: number }> = {};
    records.forEach((r) => {
      const b = r.brand || 'Other';
      if (!groups[b]) groups[b] = { count: 0, priceSum: 0, confSum: 0 };
      groups[b].count++;
      groups[b].priceSum += r.price || 0;
      groups[b].confSum += r.confidence || 0;
    });
    return Object.entries(groups)
      .map(([brand, v]) => ({
        brand: brand.length > 15 ? brand.split(' ')[0] : brand,
        count: v.count,
        avgPrice: Math.round(v.priceSum / v.count),
        avgConfidence: Math.round(v.confSum / v.count),
        color: BRAND_COLORS[brand] || '#6B7280',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [records]);

  if (data.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-1">
        Brand Performance
      </h4>
      <p className="text-xs text-text-muted mb-3">
        Inventory distribution by brand with avg confidence
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
          <YAxis type="category" dataKey="brand" tick={{ fontSize: 9, fill: '#9CA3AF' }} stroke="#1E1E2E" width={80} />
          <Tooltip
            contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }}
            itemStyle={{ color: '#FFFFFF' }}
            formatter={(value: number) => [`${value} watches`, 'Count']}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
