interface DialColorSwatchProps {
  color: string;
  size?: number;
  showTooltip?: boolean;
  className?: string;
}

export function DialColorSwatch({ color, size = 12, showTooltip = true, className }: DialColorSwatchProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <span
        className="inline-block rounded-full border border-border-default flex-shrink-0"
        style={{
          width: size,
          height: size,
          backgroundColor: color?.toLowerCase() === 'blue' ? '#3B82F6'
            : color?.toLowerCase() === 'black' ? '#1F2937'
            : color?.toLowerCase() === 'white' ? '#F9FAFB'
            : color?.toLowerCase() === 'green' ? '#22C55E'
            : color?.toLowerCase() === 'silver' ? '#9CA3AF'
            : color?.toLowerCase() === 'grey' || color?.toLowerCase() === 'gray' ? '#6B7280'
            : color?.toLowerCase() === 'brown' ? '#92400E'
            : color?.toLowerCase() === 'champagne' ? '#FDE68A'
            : color ?? '#9CA3AF',
        }}
        title={showTooltip ? color : undefined}
      />
      {showTooltip && (
        <span className="text-[10px] text-text-secondary uppercase">{color}</span>
      )}
    </span>
  );
}
