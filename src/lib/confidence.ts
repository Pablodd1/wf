export function confidencePercent(value: number | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.max(0, Math.round(percent)));
}
