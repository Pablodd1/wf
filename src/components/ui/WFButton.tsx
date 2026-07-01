/**
 * WatchFacts Button Component
 * Part of the design system — supports variants, sizes, loading state
 */
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'blue' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface WFButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[#D4AF37] text-[#0A0A0F] hover:bg-[#E5C158] hover:shadow-[0_0_16px_rgba(212,175,55,0.25)] active:scale-[0.98]',
  secondary:
    'bg-transparent text-gray-400 border border-[#1E1E2E] hover:border-[#2A2A3E] hover:text-white hover:bg-[#1A1A24] active:scale-[0.98]',
  ghost:
    'bg-transparent text-gray-400 hover:text-white hover:bg-[#1A1A24] active:scale-[0.98]',
  blue:
    'bg-[#3B5BFE] text-white hover:bg-[#4A6AFF] hover:shadow-[0_0_16px_rgba(59,91,254,0.25)] active:scale-[0.98]',
  danger:
    'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:text-red-300 active:scale-[0.98]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[11px] gap-1.5',
  md: 'px-4 py-2 text-[13px] gap-2',
  lg: 'px-6 py-3 text-sm gap-2.5',
};

export const WFButton = forwardRef<HTMLButtonElement, WFButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      children,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        whileHover={isDisabled ? undefined : { y: -1 }}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.15 }}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center rounded-[10px] font-medium transition-all duration-200 whitespace-nowrap cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 size={size === 'sm' ? 12 : size === 'lg' ? 18 : 14} className="animate-spin" />
        ) : (
          icon
        )}
        {children}
      </motion.button>
    );
  }
);

WFButton.displayName = 'WFButton';
