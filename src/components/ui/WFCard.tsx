/**
 * WatchFacts Card Component
 * Dark luxury card with gold hover accent
 */
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WFCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  hover?: 'default' | 'gold' | 'none';
  padding?: 'sm' | 'md' | 'lg';
}

const hoverStyles = {
  default: 'hover:border-[#2A2A3E] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)]',
  gold: 'hover:border-[#D4AF37]/25 hover:shadow-[0_0_20px_rgba(212,175,55,0.08)]',
  none: '',
};

const paddingStyles = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export const WFCard = forwardRef<HTMLDivElement, WFCardProps>(
  ({ children, hover = 'default', padding = 'md', className, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
        className={cn(
          'bg-[#16161F] border border-[#1E1E2E] rounded-[14px] transition-all duration-250',
          hoverStyles[hover],
          paddingStyles[padding],
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

WFCard.displayName = 'WFCard';
