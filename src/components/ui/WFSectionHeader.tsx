/**
 * WatchFacts Section Header Component
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WFSectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function WFSectionHeader({ title, icon, action, className }: WFSectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-5', className)}>
      <div className="flex items-center gap-2.5">
        {icon && <div className="text-[#D4AF37]">{icon}</div>}
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-gray-400">
          {title}
        </h2>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
