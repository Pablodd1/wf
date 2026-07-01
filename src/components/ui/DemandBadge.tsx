import { ArrowUp, ArrowRight, TrendingUp, TrendingDown, ArrowDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DemandBadgeProps {
  forecast?: string;
  className?: string;
}

const demandConfig: Record<string, { icon: LucideIcon; color: string; arrow: string }> = {
  HIGH: { icon: ArrowUp, color: 'text-success', arrow: '' },
  RISING: { icon: TrendingUp, color: 'text-purple', arrow: '' },
  STABLE: { icon: ArrowRight, color: 'text-info', arrow: '' },
  LOW: { icon: ArrowDown, color: 'text-warning', arrow: '' },
  DECLINING: { icon: TrendingDown, color: 'text-danger', arrow: '' },
};

export function DemandBadge({ forecast, className }: DemandBadgeProps) {
  const safeForecast = forecast ?? 'STABLE';
  const config = demandConfig[safeForecast] ?? demandConfig.STABLE;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-bold',
        config.color,
        className
      )}
    >
      <Icon size={12} />
      {forecast}
    </span>
  );
}
