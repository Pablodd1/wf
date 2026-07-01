/**
 * WatchFacts Stat Card Component
 * Used for KPIs and summary metrics
 */
import { motion } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WFStatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: 'gold' | 'green' | 'blue' | 'red' | 'white';
  className?: string;
  delay?: number;
}

const colorMap = {
  gold: 'text-[#D4AF37]',
  green: 'text-green-400',
  blue: 'text-blue-400',
  red: 'text-red-400',
  white: 'text-white',
};

export function WFStatCard({
  label,
  value,
  icon,
  color = 'white',
  className,
  delay = 0,
}: WFStatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        'bg-[#16161F] border border-[#1E1E2E] rounded-[14px] p-5 transition-all duration-250',
        'hover:border-[#2A2A3E] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)]',
        className
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
          {label}
        </span>
        {icon && <div className="text-gray-600">{icon}</div>}
      </div>
      <div
        className={cn(
          'text-2xl font-bold font-mono tracking-tight',
          colorMap[color]
        )}
      >
        {value}
      </div>
    </motion.div>
  );
}
