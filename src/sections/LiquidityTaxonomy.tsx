import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingDown, Activity, ChevronDown, ChevronRight, Flame, AlertTriangle, BarChart3 } from 'lucide-react';
import { useLiquidityData } from '@/hooks/useLiquidityData';

function getMarketSignal(buyers: number, sellers: number, ratio: number) {
  if (buyers > sellers * 1.5) return { label: 'HOT DEMAND', color: '#EF4444', icon: Flame };
  if (ratio > 0.8) return { label: 'BALANCED', color: '#22C55E', icon: Activity };
  if (ratio > 0.3) return { label: 'SUPPLY HEAVY', color: '#F59E0B', icon: TrendingDown };
  return { label: 'OVERSUPPLY', color: '#6B7280', icon: AlertTriangle };
}

function LiquidityBar({ buyers, sellers, total }: { buyers: number; sellers: number; total: number }) {
  const buyerPct = total > 0 ? (buyers / total) * 100 : 0;
  const sellerPct = total > 0 ? (sellers / total) * 100 : 0;
  return (
    <div className="w-full h-3 bg-[#1E1E2E] rounded-full overflow-hidden flex">
      <div
        className="h-full bg-[#3B82F6] transition-all duration-500"
        style={{ width: `${buyerPct}%` }}
        title={`Buyers: ${buyers}`}
      />
      <div
        className="h-full bg-[#C9A96E] transition-all duration-500"
        style={{ width: `${sellerPct}%` }}
        title={`Sellers: ${sellers}`}
      />
    </div>
  );
}

export function LiquidityTaxonomy() {
  const { byCollection, loading, stats } = useLiquidityData();
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set(['Nautilus', 'Aquanaut']));
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [sortBy, setSortBy] = useState<'liquidity' | 'mentions' | 'ratio'>('liquidity');

  const toggleCollection = (col: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const filteredCollections = useMemo(() => {
    const entries = Object.entries(byCollection)
      .map(([name, refs]) => {
        const filtered = refs.filter((r) => r.liquidity_score >= minLiquidity);
        const sorted = [...filtered].sort((a, b) => {
          if (sortBy === 'liquidity') return b.liquidity_score - a.liquidity_score;
          if (sortBy === 'mentions') return b.total_mentions - a.total_mentions;
          return b.buyer_seller_ratio - a.buyer_seller_ratio;
        });
        return [name, sorted] as [string, typeof refs];
      })
      .filter(([, refs]) => refs.length > 0)
      .sort((a, b) => b[1].length - a[1].length);
    return entries;
  }, [byCollection, minLiquidity, sortBy]);

  if (loading) {
    return (
      <section className="px-5 mt-8">
        <div className="bg-bg-card border border-border-default rounded-md p-8 text-center text-text-muted text-sm">
          Loading liquidity data...
        </div>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-5 mt-8 mb-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 size={16} className="text-gold-primary" />
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">
            Liquidity & Taxonomy
          </h2>
          <span className="text-[10px] text-text-muted">
            {stats.totalRefs} refs · {stats.totalMentions.toLocaleString()} mentions
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-bg-elevated border border-border-default rounded px-2 py-1 text-[11px] text-text-primary"
          >
            <option value="liquidity">Sort: Liquidity</option>
            <option value="mentions">Sort: Mentions</option>
            <option value="ratio">Sort: B/S Ratio</option>
          </select>
          {/* Min Liquidity */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">Min:</span>
            <input
              type="range"
              min={0}
              max={100}
              value={minLiquidity}
              onChange={(e) => setMinLiquidity(Number(e.target.value))}
              className="w-20 accent-gold-primary"
            />
            <span className="text-[10px] font-mono text-gold-primary w-6">{minLiquidity}</span>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Refs', value: stats.totalRefs, color: 'text-text-primary' },
          { label: 'Buyers (WTB)', value: stats.totalBuyers.toLocaleString(), color: 'text-info' },
          { label: 'Sellers (Avail)', value: stats.totalSellers.toLocaleString(), color: 'text-gold-primary' },
          { label: 'Avg Liquidity', value: `${stats.avgLiquidity}/100`, color: 'text-success' },
        ].map((s) => (
          <div key={s.label} className="bg-bg-card border border-border-default rounded-md p-3 text-center">
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-[9px] uppercase tracking-wider text-text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[10px]">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3B82F6]" />Buyer Demand</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#C9A96E]" />Seller Supply</span>
        <span className="flex items-center gap-1"><Flame size={10} className="text-danger" />Hot Demand</span>
        <span className="flex items-center gap-1"><Activity size={10} className="text-success" />Balanced</span>
        <span className="flex items-center gap-1"><TrendingDown size={10} className="text-warning" />Supply Heavy</span>
      </div>

      {/* Collection Trees */}
      <div className="space-y-2">
        {filteredCollections.map(([collection, refs]) => (
          <div key={collection} className="bg-bg-card border border-border-default rounded-md overflow-hidden">
            {/* Collection Header */}
            <button
              onClick={() => toggleCollection(collection)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-elevated transition-colors"
            >
              <div className="flex items-center gap-2">
                {expandedCollections.has(collection) ? (
                  <ChevronDown size={14} className="text-gold-primary" />
                ) : (
                  <ChevronRight size={14} className="text-text-muted" />
                )}
                <span className="text-sm font-semibold text-text-primary">{collection}</span>
                <span className="text-[10px] bg-gold-primary/10 text-gold-primary px-1.5 py-0.5 rounded">{refs.length} refs</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text-muted">
                <span>B: {refs.reduce((s, r) => s + r.buyers, 0)}</span>
                <span>S: {refs.reduce((s, r) => s + r.sellers, 0)}</span>
              </div>
            </button>

            {/* Reference Rows */}
            <AnimatePresence>
              {expandedCollections.has(collection) && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border-default">
                    {refs.slice(0, 50).map((ref) => {
                      const signal = getMarketSignal(ref.buyers, ref.sellers, ref.buyer_seller_ratio);
                      const SignalIcon = signal.icon;
                      return (
                        <div
                          key={ref.reference}
                          className="flex items-center gap-3 px-4 py-2 border-b border-border-default/50 hover:bg-bg-elevated transition-colors"
                        >
                          {/* Reference */}
                          <div className="w-24 shrink-0">
                            <span className="font-mono text-xs font-semibold text-text-primary">{ref.reference}</span>
                          </div>

                          {/* B/S Bar */}
                          <div className="flex-1 min-w-0">
                            <LiquidityBar
                              buyers={ref.buyers}
                              sellers={ref.sellers}
                              total={ref.total_mentions}
                            />
                            <div className="flex justify-between text-[9px] text-text-muted mt-0.5">
                              <span>{ref.buyers} buyers</span>
                              <span>{ref.total_mentions} total</span>
                              <span>{ref.sellers} sellers</span>
                            </div>
                          </div>

                          {/* Signal */}
                          <div className="w-20 shrink-0 flex items-center gap-1">
                            <SignalIcon size={10} style={{ color: signal.color }} />
                            <span className="text-[9px] font-semibold" style={{ color: signal.color }}>
                              {signal.label}
                            </span>
                          </div>

                          {/* Liquidity Score */}
                          <div className="w-14 shrink-0 text-right">
                            <div
                              className="text-xs font-bold font-mono"
                              style={{
                                color: ref.liquidity_score >= 80 ? '#22C55E' : ref.liquidity_score >= 50 ? '#F59E0B' : '#6B7280',
                              }}
                            >
                              {ref.liquidity_score}
                            </div>
                            <div className="text-[8px] text-text-muted">liquidity</div>
                          </div>

                          {/* B/S Ratio */}
                          <div className="w-12 shrink-0 text-right">
                            <div className="text-xs font-mono text-text-primary">
                              {ref.buyer_seller_ratio.toFixed(2)}
                            </div>
                            <div className="text-[8px] text-text-muted">B/S</div>
                          </div>

                          {/* Catalog */}
                          <div className="w-8 shrink-0 text-center">
                            {ref.in_catalog ? (
                              <span className="text-[9px] text-success bg-success/10 px-1 rounded">CAT</span>
                            ) : (
                              <span className="text-[9px] text-text-muted">-</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {refs.length > 50 && (
                      <div className="text-center py-2 text-[10px] text-text-muted">
                        +{refs.length - 50} more references (use filters)
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </motion.section>
  );
}
