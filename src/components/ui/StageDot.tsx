import { cn } from '@/lib/utils';

interface StageDotProps {
  color: string;
  state: 'inactive' | 'active' | 'completed' | 'failed';
  size?: number;
}

export function StageDot({ color, state, size = 8 }: StageDotProps) {
  return (
    <span
      className={cn(
        'inline-block rounded-full flex-shrink-0 transition-all duration-200',
        state === 'inactive' && 'bg-bg-elevated border border-border-default',
        state === 'active' && 'animate-pulse-glow',
        state === 'completed' && '',
        state === 'failed' && 'bg-danger'
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: state === 'inactive' ? undefined : state === 'failed' ? '#EF4444' : color,
        boxShadow: state === 'active' ? `0 0 8px ${color}4D` : undefined,
        transform: state === 'active' ? 'scale(1.2)' : 'scale(1)',
      }}
    />
  );
}
