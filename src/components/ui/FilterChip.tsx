import { cn } from '@/lib/utils';

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}

export function FilterChip({ label, active, onClick, className }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 cursor-pointer',
        active
          ? 'bg-[rgba(201,169,110,0.15)] border border-gold-primary text-gold-primary'
          : 'bg-bg-card border border-border-default text-text-muted hover:bg-bg-elevated hover:border-border-hover',
        className
      )}
    >
      {label}
    </button>
  );
}
