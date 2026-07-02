/**
 * LuxuryDialBadge — Dial color badge with swatch
 * Premium glassmorphism version for Price Research
 */
interface LuxuryDialBadgeProps {
  color: string;
  count?: number;
  isMore?: boolean;
}

const DCC: Record<string, string> = {
  'White': '#E5E7EB', 'Black': '#1F2937', 'Blue': '#3B5BFE',
  'Green': '#10B981', 'Silver': '#9CA3AF', 'Champagne': '#D4AF37',
  'Grey': '#6B7280', 'Gray': '#6B7280', 'Red': '#EF4444',
  'Brown': '#92400E', 'Purple': '#8B5CF6', 'Orange': '#F97316',
  'Yellow': '#F59E0B', 'Pink': '#EC4899', 'Ivory': '#FEF3C7',
  'Mother of Pearl': '#E0E7FF', 'Unknown': '#D1D5DB',
};

function getDialColor(d: string): string {
  return DCC[d] || `hsl(${[...d].reduce((s, c) => s + c.charCodeAt(0), 0) % 360}, 60%, 50%)`;
}

export function LuxuryDialBadge({ color, count, isMore }: LuxuryDialBadgeProps) {
  if (isMore) {
    return (
      <span className="dial-badge-luxury border-[#D4AF37]/20 text-white/40">
        +{color}
      </span>
    );
  }

  return (
    <span className="dial-badge-luxury">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: getDialColor(color) }}
      />
      {color}
      {count !== undefined && (
        <span className="text-white/30 ml-0.5">({count})</span>
      )}
    </span>
  );
}
