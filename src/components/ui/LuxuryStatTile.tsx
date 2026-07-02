/**
 * LuxuryStatTile — Premium stat display tile for Price Research
 * Glassmorphism, gold accents
 * Visual-only enhancement
 */
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface LuxuryStatTileProps {
  label: string;
  value: string;
  color?: string;
  icon?: ReactNode;
  delay?: number;
}

export function LuxuryStatTile({ label, value, color = '#D4AF37', icon, delay = 0 }: LuxuryStatTileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="stat-tile-luxury"
    >
      <div className="stat-label">{label}</div>
      <div className="stat-value flex items-center justify-center gap-1.5" style={{ color }}>
        {icon}
        {value}
      </div>
    </motion.div>
  );
}
