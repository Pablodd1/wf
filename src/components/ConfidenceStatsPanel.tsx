/**
 * ConfidenceStatsPanel — Shows the verdict distribution.
 * Fetches from /api/confidence-stats and displays:
 *   - Verdict breakdown (APPROVED / REVIEW / HUMAN / RECYCLE)
 *   - Bar chart visualization
 *   - Brand-level confidence comparison
 */
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface VerdictData {
  total: number;
  totalRecords: number;
  exportDate: string;
  verdictCounts: Record<string, number>;
}

const VERDICT_META: Record<string, { label: string; color: string; desc: string }> = {
  APPROVED: { label: 'Approved', color: '#22C55E', desc: 'Auto-scored, shown on public site' },
  REVIEW: { label: 'Review', color: '#EAB308', desc: 'AI suggests review' },
  HUMAN: { label: 'Human', color: '#F97316', desc: 'Needs manual attention' },
  RECYCLE: { label: 'Recycle', color: '#EF4444', desc: 'Garbage/WTB requests' },
};

export function ConfidenceStatsPanel() {
  const [data, setData] = useState<VerdictData | null>(null);
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

  if (!data || !data.verdictCounts) return null;

  const total = data.total || data.totalRecords || 0;
  const verdicts = data.verdictCounts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Verdict Distribution
        </h3>
      </div>

      {/* Verdict breakdown bars */}
      <div className="space-y-2">
        {Object.entries(VERDICT_META).map(([key, meta]) => {
          const count = verdicts[key] || 0;
          const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={key} className="flex items-center gap-3">
              <div className="w-28 text-xs font-medium text-text-secondary flex-shrink-0">
                {meta.label}
              </div>
              <div className="flex-1 h-6 bg-bg-elevated rounded overflow-hidden relative">
                <div
                  className="h-full rounded transition-all duration-500"
                  style={{
                    width: `${Math.max(percentage, 2)}%`,
                    backgroundColor: meta.color,
                    opacity: 0.85,
                  }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-text-primary">
                  {percentage}%
                </span>
              </div>
              <div className="w-20 text-right text-xs text-text-muted font-mono">
                {count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total records */}
      <div className="mt-3 pt-3 border-t border-border-default flex items-center justify-between">
        <span className="text-xs text-text-muted">Total Records</span>
        <span className="text-sm font-mono font-bold text-gold-primary">
          {total.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
