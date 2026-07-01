/**
 * ConfidenceTierBadge — Displays the 4-tier confidence protocol label.
 *
 * 100% = Green  (AUTO_APPROVE)
 *  90% = Yellow (REVIEW_SUGGESTED)
 *  80% = Orange (MUST_REVIEW)
 * <80% = Red    (MANUAL_INTERVENTION)
 */
interface ConfidenceTierBadgeProps {
  score: number;
  action?: string;
  gapCount?: number;
  size?: 'sm' | 'md' | 'lg';
}

const TIER_CONFIG = {
  AUTO_APPROVE: { label: 'AUTO', color: '#22C55E', bg: 'rgba(34, 197, 94, 0.12)' },
  REVIEW_SUGGESTED: { label: 'REVIEW', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.12)' },
  MUST_REVIEW: { label: 'MUST CHECK', color: '#F97316', bg: 'rgba(249, 115, 22, 0.12)' },
  MANUAL_INTERVENTION: { label: 'MANUAL', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
};

function getTier(score: number) {
  if (score >= 95) return TIER_CONFIG.AUTO_APPROVE;
  if (score >= 85) return TIER_CONFIG.REVIEW_SUGGESTED;
  if (score >= 70) return TIER_CONFIG.MUST_REVIEW;
  return TIER_CONFIG.MANUAL_INTERVENTION;
}

export function ConfidenceTierBadge({ score, action, gapCount, size = 'sm' }: ConfidenceTierBadgeProps) {
  const tier = action && TIER_CONFIG[action as keyof typeof TIER_CONFIG]
    ? TIER_CONFIG[action as keyof typeof TIER_CONFIG]
    : getTier(score);

  const sizeClasses = {
    sm: 'text-[8px] px-1.5 py-0.5',
    md: 'text-[10px] px-2 py-1',
    lg: 'text-xs px-2.5 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded uppercase tracking-wider whitespace-nowrap ${sizeClasses[size]}`}
      style={{ color: tier.color, backgroundColor: tier.bg }}
      title={`Confidence: ${score}% • ${gapCount ?? 0} gaps`}
    >
      {tier.label}
      <span className="font-mono">{score}%</span>
    </span>
  );
}
