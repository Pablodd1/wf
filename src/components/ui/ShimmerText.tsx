/**
 * ShimmerText — Gold gradient text with shimmer animation.
 * Used for prices, brand names, section headings.
 *
 * Props:
 *   as       — HTML element (span, h1, h2, h3, p)
 *   size     — 'sm' | 'md' | 'lg' | 'xl' | '2xl'
 *   shimmer  — enable shimmer sweep animation
 *   className
 *   children
 */

import { motion } from 'framer-motion';

const SIZE_CLASSES: Record<string, string> = {
  sm: 'text-sm font-medium',
  md: 'text-base font-semibold',
  lg: 'text-lg font-bold',
  xl: 'text-2xl font-bold',
  '2xl': 'text-4xl md:text-5xl font-bold',
};

interface ShimmerTextProps {
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  shimmer?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function ShimmerText({
  as: Tag = 'span',
  size = 'md',
  shimmer = false,
  className = '',
  children,
}: ShimmerTextProps) {
  const baseClasses = [
    'bg-clip-text text-transparent',
    'bg-gradient-to-r from-wf-gold via-wf-gold-light to-wf-gold',
    SIZE_CLASSES[size] || SIZE_CLASSES.md,
    shimmer && 'animate-shimmer bg-[length:200%_100%]',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={baseClasses}>
      {children}
    </Tag>
  );
}
