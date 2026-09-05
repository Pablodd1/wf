import { cn } from '@/lib/utils';

interface StatusPillProps {
  status?: 'online' | 'offline' | 'warning';
  label?: string;
  className?: string;
}

const statusConfig = {
  online: { dot: '#22C55E', text: 'SYSTEM ONLINE' },
  offline: { dot: '#EF4444', text: 'SYSTEM OFFLINE' },
  warning: { dot: '#F59E0B', text: 'SYSTEM WARNING' },
};

export function StatusPill({ status = 'online', label, className }: StatusPillProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wider',
        'bg-[rgba(34,197,94,0.15)] text-text-secondary',
        className
      )}
    >
      <span
        className="inline-block rounded-full animate-pulse-glow"
        style={{
          width: 8,
          height: 8,
          backgroundColor: config.dot,
          boxShadow: `0 0 0 0 rgba(${status === 'online' ? '34,197,94' : status === 'warning' ? '245,158,11' : '239,68,68'}, 0.4)`,
        }}
      />
      {label ?? config.text}
    </span>
  );
}
