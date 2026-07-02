/**
 * LuxuryPriceResearchHeader — Premium header block for Price Research page
 * Dark glassmorphism with gold accents
 * Visual-only enhancement
 */
import { motion } from 'framer-motion';
import { TrendingUp, Sparkles } from 'lucide-react';

interface LuxuryPriceResearchHeaderProps {
  brandCount?: number;
  subtitle?: string;
}

export function LuxuryPriceResearchHeader({
  brandCount,
  subtitle = 'Analyze market trends, detect outliers, and get accurate valuations for any watch reference.',
}: LuxuryPriceResearchHeaderProps) {
  return (
    <div className="text-center mb-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="header-block-luxury"
      >
        <div className="inline-flex items-center gap-2.5 mb-4 px-4 py-2 rounded-full bg-[#D4AF37]/8 border border-[#D4AF37]/15">
          <TrendingUp size={14} className="text-[#D4AF37]" />
          <span className="text-[11px] text-[#D4AF37] font-semibold uppercase tracking-[0.12em]">
            Market Intelligence
          </span>
        </div>

        <div className="flex items-center justify-center gap-3 mb-4">
          <img
            src="/watchfacts-logo-white.png"
            alt="WatchFacts"
            className="h-9 w-auto object-contain"
            style={{ filter: 'drop-shadow(0 0 8px rgba(212,175,55,0.2))' }}
          />
          <div className="h-6 w-px bg-[#D4AF37]/20" />
          <h1 className="text-2xl font-light text-white tracking-wide">
            Price <span>Research</span>
          </h1>
        </div>

        <p className="text-sm text-white/40 max-w-xl mx-auto leading-relaxed">
          {subtitle}
        </p>

        {brandCount && brandCount > 0 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Sparkles size={12} className="text-[#D4AF37]/60" />
            <span className="text-[11px] text-white/30 font-medium">
              <span className="text-[#D4AF37]/80 font-semibold">{brandCount}</span> brands indexed
            </span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
