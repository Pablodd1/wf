/**
 * GlassCard — Frosted glass panel with gold accents.
 * Used as base container for watch cards, stats, panels, CTAs.
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface GlassCardProps {
  hover?: boolean;
  animate?: boolean;
  delay?: number;
  variant?: 'default' | 'elevated' | 'bordered';
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function GlassCard({
  hover = false,
  animate: animateProp = false,
  delay = 0,
  variant = 'default',
  className = '',
  children,
  onClick,
  style,
}: GlassCardProps) {
  const baseClasses = [
    'relative overflow-hidden rounded-2xl',
    'bg-gradient-to-br from-wf-card/80 to-wf-card/40',
    'backdrop-blur-xl border border-wf-border/50',
    'transition-all duration-400 ease-out',
    hover && 'cursor-pointer hover:border-wf-gold/30 hover:shadow-glass-hover hover:-translate-y-1',
    variant === 'elevated' && 'shadow-glass',
    variant === 'bordered' && 'border-wf-border-hover shadow-glass',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const animationProps = animateProp
    ? {
        initial: { opacity: 0, y: 30, scale: 0.98 },
        whileInView: { opacity: 1, y: 0, scale: 1 },
        viewport: { once: true, margin: '-40px' },
        transition: { duration: 0.6, delay: delay / 1000, ease: [0.16, 1, 0.3, 1] },
      }
    : {};

  return (
    <motion.div
      className={baseClasses}
      {...animationProps}
      onClick={onClick}
      style={style}
    >
      {/* Gold shimmer overlay on hover */}
      {hover && (
        <div className="absolute inset-0 bg-gold-shimmer bg-[length:200%_100%] opacity-0 group-hover:opacity-100 transition-opacity duration-600 pointer-events-none" />
      )}

      {/* Top highlight line */}
      <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-wf-gold/20 to-transparent" />

      {children}
    </motion.div>
  );
}
