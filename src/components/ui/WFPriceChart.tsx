/**
 * WatchFacts Price Chart Component
 * Recharts-based area/line chart for price trends with dark luxury styling
 */
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChartPoint {
  label: string;
  [key: string]: string | number;
}

interface WFPriceChartProps {
  data: ChartPoint[];
  lines: { key: string; color: string; name: string; type?: 'line' | 'area' }[];
  height?: number;
  showGrid?: boolean;
  className?: string;
  yTickFormatter?: (v: number) => string;
  xTickFormatter?: (v: string) => string;
}

const tooltipStyle = {
  backgroundColor: '#111118',
  border: '1px solid #1E1E2E',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#fff',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};

export function WFPriceChart({
  data,
  lines,
  height = 340,
  showGrid = true,
  className,
  yTickFormatter = (v: number) => `$${(v / 1000).toFixed(0)}k`,
  xTickFormatter = (v: string) => v,
}: WFPriceChartProps) {
  if (!data.length) {
    return (
      <div className={cn('flex items-center justify-center h-[340px] text-gray-500 text-sm', className)}>
        No chart data available
      </div>
    );
  }

  const hasArea = lines.some((l) => l.type === 'area');

  if (hasArea) {
    return (
      <div className={cn('w-full', className)}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />}
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={{ stroke: '#1E1E2E' }}
              tickFormatter={xTickFormatter}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={{ stroke: '#1E1E2E' }}
              tickFormatter={yTickFormatter}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend
              wrapperStyle={{ fontSize: '12px', color: '#9CA3AF', paddingTop: '12px' }}
            />
            {lines.map((line) => (
              <Area
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                fill={line.color}
                fillOpacity={0.1}
                strokeWidth={2}
                name={line.name}
                dot={{ r: 3, fill: line.color, stroke: '#fff', strokeWidth: 1.5 }}
                activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />}
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={{ stroke: '#1E1E2E' }}
            tickFormatter={xTickFormatter}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={{ stroke: '#1E1E2E' }}
            tickFormatter={yTickFormatter}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend
            wrapperStyle={{ fontSize: '12px', color: '#9CA3AF', paddingTop: '12px' }}
          />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              name={line.name}
              dot={{ r: 3, fill: line.color, stroke: '#fff', strokeWidth: 1.5 }}
              activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
