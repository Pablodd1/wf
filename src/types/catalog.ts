// ── 3-catalog comparison types (shared between API + UI) ───────────────────

export interface CatalogComparisonInternal {
  name: string;
  size: number;
  hit: boolean;
  brand?: string;
  model?: string;
  collection?: string;
}

export interface CatalogComparisonLLM {
  name: string;
  brand?: string;
  reference?: string;
  confidence: number; // 0-1
  model?: string;
  year?: number;
  notes?: string;
  error?: string;
}

export interface CatalogComparisonDataset {
  name: string;
  sampleCount: number;
  avgPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  commonDial?: string;
}

export interface CatalogComparison {
  internal: CatalogComparisonInternal;
  llm: CatalogComparisonLLM;
  dataset: CatalogComparisonDataset;
}

// ── Per-feature confidence scoring (1-10) ────────────────────────────────

export interface FeatureScores {
  parser: number;
  catalog: number;
  ai: number;
  image: number;
  export: number;
  loop: number;
  overall: number;
}

export const FEATURE_LABELS: Record<keyof FeatureScores, string> = {
  parser: 'Regex Parser',
  catalog: '3-Catalog Match',
  ai: 'AI Cascade',
  image: 'Image Verification',
  export: 'Export Quality',
  loop: 'Closed-Loop Recovery',
  overall: 'Overall',
};

// Score color tier (1-10 scale)
export function scoreColors(n: number) {
  if (n >= 9) return { bg: '#052e16', fg: '#22c55e', border: '#166534', label: 'EXCELLENT' };
  if (n >= 7) return { bg: '#0f172a', fg: '#60a5fa', border: '#1e3a5f', label: 'GOOD' };
  if (n >= 5) return { bg: '#422006', fg: '#eab308', border: '#854d0e', label: 'OK' };
  return { bg: '#450a0a', fg: '#ef4444', border: '#7f1d1d', label: 'WEAK' };
}

// Compute per-feature scores from a result + catalogs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeFeatureScores(result: any, catalogs: CatalogComparison | null): FeatureScores {
  // Parser: how many fields are recognized
  const fieldsOk = [
    result.brand && result.brand !== 'Unknown',
    result.reference && result.reference.length > 0,
    result.dialColor && result.dialColor !== 'UNKNOWN',
    result.price > 0,
    result.condition && result.condition !== 'Unknown',
    result.currency,
  ].filter(Boolean).length;
  const parser = Math.round((fieldsOk / 6) * 10);

  // Catalog: 3-catalog match quality
  let catalog = 0;
  if (catalogs) {
    if (catalogs.internal.hit) catalog += 4;
    if (catalogs.llm.confidence >= 0.9) catalog += 3;
    else if (catalogs.llm.confidence >= 0.7) catalog += 2;
    else if (catalogs.llm.confidence >= 0.5) catalog += 1;
    if (catalogs.dataset.sampleCount > 0) catalog += 3;
    if (catalogs.dataset.sampleCount > 5) catalog = Math.min(catalog + 1, 10);
  }

  // AI: confidence in current verdict
  const ai = Math.round((result.confidence || 0) / 10);

  // Image: 0 if no image URL, otherwise based on confidence
  const image = result.imageUrl
    ? Math.min(10, 7 + Math.round((result.imageConfidence || 0) / 30))
    : 5;

  // Export: always 10 (Excel/CSV working)
  const export_ = 10;

  // Loop: ability to recover from low confidence (always possible)
  const loop = 10;

  const overall = Math.round(
    parser * 0.25 +
    catalog * 0.20 +
    ai * 0.25 +
    Math.max(image, 5) * 0.10 +
    export_ * 0.05 +
    loop * 0.15
  );

  return { parser, catalog, ai, image: image || 5, export: export_, loop, overall };
}
