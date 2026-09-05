import { cn } from '@/lib/utils';

interface ConditionBadgeProps {
  condition: string;
  className?: string;
}

const conditionStyles: Record<string, string> = {
  New: 'bg-[rgba(34,197,94,0.15)] text-success',
  Used: 'bg-[rgba(245,158,11,0.15)] text-warning',
  'Like New': 'bg-[rgba(59,130,246,0.15)] text-info',
  Naked: 'bg-[rgba(20,184,166,0.15)] text-teal',
};

export function ConditionBadge({ condition, className }: ConditionBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase leading-none',
        conditionStyles[condition] || 'bg-bg-elevated text-text-muted',
        className
      )}
    >
      {condition}
    </span>
  );
}
