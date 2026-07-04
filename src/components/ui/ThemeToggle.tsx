/**
 * ThemeToggle — Minimal 3-mode contrast switcher.
 *
 * Luxury (dark+gold) → Contrast (white+clean) → Neutral (gray+balanced)
 * Renders as a subtle pill in the navbar corner.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { Moon, Sun, Contrast } from 'lucide-react';

const MODE_META: Record<ThemeMode, { icon: typeof Moon; label: string }> = {
  luxury:   { icon: Moon,     label: 'Luxury Dark' },
  contrast: { icon: Sun,      label: 'High Contrast' },
  neutral:  { icon: Contrast, label: 'Neutral' },
};

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, cycle } = useTheme();
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.93 }}
      onClick={cycle}
      className={`
        relative flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium
        transition-all duration-300 select-none
        data-[theme='luxury']:bg-wf-card/60 data-[theme='luxury']:text-wf-gold data-[theme='luxury']:border data-[theme='luxury']:border-wf-gold/20
        data-[theme='contrast']:bg-gray-100 data-[theme='contrast']:text-gray-700 data-[theme='contrast']:border data-[theme='contrast']:border-gray-300
        data-[theme='neutral']:bg-white/8 data-[theme='neutral']:text-wf-text-secondary data-[theme='neutral']:border data-[theme='neutral']:border-white/8
        ${className}
      `}
      title={`Current: ${meta.label}. Click to cycle.`}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={mode}
          initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-1.5"
        >
          <Icon size={12} />
          {meta.label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
