import { cn } from '@/lib/utils';

interface BrandBadgeProps {
  brand: string;
  className?: string;
}

export function BrandBadge({ brand, className }: BrandBadgeProps) {
  const isPP = brand?.toUpperCase() === 'PATEK PHILIPPE';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-[0.06em] font-mono leading-none',
        isPP
          ? 'bg-gold-primary text-bg-primary'
          : 'bg-[#2A2A3E] text-text-secondary',
        className
      )}
    >
      {brand}
    </span>
  );
}
