/**
 * ConfidenceStatsPanel — Shows the 4-tier confidence protocol distribution.
 * Fetches from /api/confidence-stats and displays:
 *   - Tier breakdown (Auto-approve / Review / Must Review / Manual)
 *   - Bar chart visualization
 *   - Brand-level confidence comparison
 */
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface ConfidenceData {
  total: number;
  tiers: Record<string, number>;
  distribution: Record<string, { count: number; percentage: number }>;
  brandStats: Array<{ brand: string; count: number; avgConfidence: number }>;
  demo?: boolean;
}

const TIER_META = {
  AUTO_APPROVE: { label: 'Auto-Approve', color: '#22C55E', desc: 'All fields matched from catalog' },
  REVIEW_SUGGESTED: { label: 'Review Suggested', color: '#EAB308', desc: '1 gap — AI can fill' },
  MUST_REVIEW: { label: 'Must Review', color: '#F97316', desc: '2 gaps — human attention needed' },
  MANUAL_INTERVENTION: { label: 'Manual', color: '#EF4444', desc: '3+ gaps — AI cannot resolve' },
};

export function ConfidenceStatsPanel() {
  const [data, setData] = useState<ConfidenceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/confidence-stats`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-gold-primary" size={24} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Confidence Protocol
        </h3>
        {data.demo && (
          <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">DEMO DATA</span>
        )}
      </div>

      {/* Tier breakdown bars */}
      <div className="space-y-2">
        {Object.entries(TIER_META).map(([key, meta]) => {
          const dist = data.distribution[key] || { count: 0, percentage: 0 };
          return (
            <div key={key} className="flex items-center gap-3">
              <div className="w-28 text-xs font-medium text-text-secondary flex-shrink-0">
                {meta.label}
              </div>
              <div className="flex-1 h-6 bg-bg-elevated rounded overflow-hidden relative">
                <div
                  className="h-full rounded transition-all duration-500"
                  style={{
                    width: `${Math.max(dist.percentage, 2)}%`,
                    backgroundColor: meta.color,
                    opacity: 0.85,
                  }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-text-primary">
                  {dist.percentage}%
                </span>
              </div>
              <div className="w-20 text-right text-xs text-text-muted font-mono">
                {dist.count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Brand-level confidence */}
      {data.brandStats && data.brandStats.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border-default">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            Brand Confidence
          </h4>
          <div className="space-y-1">
            {data.brandStats.slice(0, 6).map((brand) => (
              <div key={brand.brand} className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">{brand.brand}</span>
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">{brand.count.toLocaleString()} records</span>
                  <span
                    className="font-mono font-bold px-1.5 rounded"
                    style={{
                      color: brand.avgConfidence >= 85 ? '#22C55E' : brand.avgConfidence >= 70 ? '#EAB308' : '#EF4444',
                    }}
                  >
                    {brand.avgConfidence}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Total records */}
      <div className="mt-3 pt-3 border-t border-border-default flex items-center justify-between">
        <span className="text-xs text-text-muted">Total Records</span>
        <span className="text-sm font-mono font-bold text-gold-primary">
          {data.total.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
