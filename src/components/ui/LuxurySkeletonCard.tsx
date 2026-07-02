/**
 * LuxurySkeletonCard — Premium loading skeleton for Trading Floor
 * Gold-tinted shimmer for luxury feel
 */
import { motion } from 'framer-motion';

interface LuxurySkeletonCardProps {
  index: number;
}

export function LuxurySkeletonCard({ index }: LuxurySkeletonCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="luxury-card overflow-hidden"
    >
      <div className="aspect-square shimmer-luxury" />
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <div className="h-3 shimmer-luxury rounded w-1/4" />
          <div className="h-3 shimmer-luxury rounded w-1/5" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-4 shimmer-luxury rounded-full w-24" />
        </div>
        <div className="h-4 shimmer-luxury rounded w-3/4" />
        <div className="h-3 shimmer-luxury rounded w-1/2" />
        <div className="flex items-center justify-between pt-1">
          <div className="space-y-1">
            <div className="h-2 shimmer-luxury rounded w-12" />
            <div className="h-5 shimmer-luxury rounded w-20" />
          </div>
          <div className="h-3 shimmer-luxury rounded w-16" />
        </div>
        <div className="h-8 shimmer-luxury rounded-full w-full mt-1" />
      </div>
    </motion.div>
  );
}
