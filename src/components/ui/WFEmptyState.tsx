/**
 * WatchFacts Empty State Component
 */
import { motion } from 'framer-motion';
import { Database } from 'lucide-react';

interface WFEmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function WFEmptyState({
  title = 'No data found',
  description = 'Try adjusting your filters or search criteria',
  icon,
  action,
}: WFEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 px-6 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-[#16161F] border border-[#1E1E2E] flex items-center justify-center mb-5">
        {icon || <Database size={28} className="text-[#2A2A3E]" />}
      </div>
      <h3 className="text-base font-semibold text-gray-300 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-xs">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
