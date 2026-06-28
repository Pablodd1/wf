import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const RATES: Record<string, number> = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

export function toUSD(amount: number, currency: string): number {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

export function formatPrice(value: number): string {
  if (!value || value <= 0) return '—';
  return `$${value.toLocaleString()}`;
}

export function formatNumber(value: number): string {
  if (value === undefined || value === null) return '—';
  return value.toLocaleString();
}

export function confidenceColor(pct: number): string {
  if (pct >= 85) return '#22C55E';
  if (pct >= 70) return '#F59E0B';
  if (pct >= 50) return '#F97316';
  return '#EF4444';
}

export function confidenceLabel(pct: number): string {
  if (pct >= 85) return 'APPROVED';
  if (pct >= 70) return 'REVIEW';
  if (pct >= 50) return 'HUMAN';
  return 'RECYCLE';
}

export function verdictColor(verdict: string): string {
  const map: Record<string, string> = {
    APPROVED: '#22C55E',
    REVIEW: '#F59E0B',
    HUMAN: '#F97316',
    RECYCLE: '#EF4444',
  };
  return map[verdict] || '#6B7280';
}

export function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
