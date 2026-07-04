/**
 * SectionReveal — Staggered entrance animation wrapper.
 * Wrap any page section to get fade-up + stagger children on scroll.
 *
 * Props:
 *   stagger  — delay between children (seconds)
 *   className
 *   children — wrapped content (each direct child gets animated)
 */

import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';

interface SectionRevealProps extends HTMLMotionProps<'div'> {
  stagger?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
}

export function SectionReveal({
  stagger = 0.1,
  direction = 'up',
  className = '',
  children,
  ...rest
}: SectionRevealProps) {
  const directionMap = {
    up: { y: 40 },
    down: { y: -40 },
    left: { x: -40 },
    right: { x: 40 },
  };

  return (
    <motion.div
      initial={{ opacity: 0, ...directionMap[direction] }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * StaggerChildren — wraps children with staggered entrance delay.
 * Use inside SectionReveal for cascading animations.
 */
interface StaggerChildrenProps {
  children: React.ReactNode;
  baseDelay?: number;
  stagger?: number;
}

export function StaggerChildren({
  children,
  baseDelay = 0,
  stagger = 0.08,
}: StaggerChildrenProps) {
  if (!Array.isArray(children)) {
    return <>{children}</>;
  }

  return (
    <>
      {children.map((child, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{
            duration: 0.5,
            delay: baseDelay + index * stagger,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {child}
        </motion.div>
      ))}
    </>
  );
}
