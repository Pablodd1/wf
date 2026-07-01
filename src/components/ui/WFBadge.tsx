/**
 * WatchFacts Badge Component
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type BadgeVariant = 'gold' | 'green' | 'blue' | 'red' | 'amber' | 'gray';

interface WFBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  gold: 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/25',
  green: 'bg-green-500/10 text-green-400 border-green-500/25',
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/25',
  red: 'bg-red-500/10 text-red-400 border-red-500/25',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  gray: 'bg-gray-500/10 text-gray-400 border-gray-500/25',
};

export function WFBadge({ children, variant = 'gold', icon, className }: WFBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-[3px] text-[11px] font-semibold uppercase tracking-[0.04em] rounded-full border',
        variantStyles[variant],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
