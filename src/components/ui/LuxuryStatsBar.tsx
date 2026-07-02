/**
 * LuxuryStatsBar — Premium Stats Bar for Trading Floor
 * Glassmorphism, gold accents, premium data display
 * Visual-only enhancement of the existing StatsBar
 */
import { motion } from 'framer-motion';
import { Shield, Award, TrendingUp, Zap, Database } from 'lucide-react';

interface LuxuryStatsBarProps {
  total: number;
  loaded: number;
  hasMore: boolean;
  loadAllMode: boolean;
  onLoadAll: () => void;
  onBackToPaginated: () => void;
}

export function LuxuryStatsBar({
  total, loaded, hasMore, loadAllMode, onLoadAll, onBackToPaginated,
}: LuxuryStatsBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="glass-nav border-b border-[#D4AF37]/8"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-5 overflow-x-auto hide-scrollbar">
        {/* Total Listings */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="icon-gold-wrapper" style={{ width: 28, height: 28 }}>
            <Database size={12} />
          </div>
          <div className="leading-none">
            <div className="stat-number-luxury text-sm">{total.toLocaleString()}</div>
            <div className="text-[9px] text-white/30 uppercase tracking-[0.08em] font-medium mt-0.5">Total Listings</div>
          </div>
        </div>

        <div className="w-px h-7 bg-white/5 flex-shrink-0" />

        {/* Global Dealers */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="icon-gold-wrapper" style={{ width: 28, height: 28 }}>
            <Award size={12} />
          </div>
          <div className="leading-none">
            <div className="stat-number-luxury text-sm">29,512+</div>
            <div className="text-[9px] text-white/30 uppercase tracking-[0.08em] font-medium mt-0.5">Global Dealers</div>
          </div>
        </div>

        <div className="w-px h-7 bg-white/5 flex-shrink-0" />

        {/* Live Market */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/8 flex items-center justify-center">
            <TrendingUp size={13} className="text-emerald-400" />
          </div>
          <span className="text-[11px] text-emerald-400/60 font-medium">Live Market Data</span>
        </div>

        <div className="flex-1 min-w-4" />

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {loadAllMode ? (
            <>
              <div className="text-[11px] text-[#D4AF37]/80 font-semibold whitespace-nowrap font-mono">
                {loaded.toLocaleString()} of {total.toLocaleString()} loaded
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onBackToPaginated}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/50 text-[11px] font-semibold rounded-full transition-all whitespace-nowrap border border-white/8 hover:border-white/20"
              >
                Back to Paginated
              </motion.button>
            </>
          ) : (
            <>
              <div className="text-[11px] text-white/25 whitespace-nowrap">
                Showing <span className="font-semibold text-white/50 font-mono">{loaded}</span> loaded
              </div>
              {hasMore && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onLoadAll}
                  className="btn-luxury text-[11px] py-2 px-5"
                >
                  <Zap size={13} /> Load All
                </motion.button>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
