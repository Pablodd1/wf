/**
 * CLIENT-SIDE PIPELINE INTEGRATION
 * Hooks into the existing useWatchData flow to apply:
 * - Master catalog lookup
 * - Multi-stage normalization
 * - IQR outlier flagging
 * - Currency conversion
 */

import {
  runPipeline,
  applyIQRFiltering,
} from './pipeline';
import { lookupReference, getCatalogStats } from './masterCatalog';

export interface EnrichedWatchRecord {
  id: string;
  brand: string;
  reference: string;
  family: string;
  dialColor: string;
  condition: string;
  year: number | null;
  priceUSD: number;
  originalPrice: number;
  currency: string;
  hasBox: boolean;
  hasPapers: boolean;
  materials: string[];
  confidence: number;
  flags: string[];
  source: string;
  // IQR
  isOutlier: boolean;
  outlierReason?: string;
  // Catalog
  catalogVerified: boolean;
  catalogEntry?: {
    standardDials: string[];
    avgPriceUSD: number;
    count: number;
  };
  // Image verification
  imageVerdict?: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  imageDiscrepancies?: string[];
}

/** Enrich raw records with full pipeline processing */
export async function enrichRecords(
  rawRecords: Array<{
    id: string;
    sourceLine: string;
    brand: string;
    reference: string;
    dialColor: string;
    condition: string;
    price: number;
    currency: string;
    priceUSD: number;
    year?: number | null;
    imageUrl?: string | null;
  }>
): Promise<EnrichedWatchRecord[]> {
  // Step 1: Run pipeline on each record
  const pipelineResults = await Promise.all(
    rawRecords.map(async (r) => {
      const normalized = await runPipeline(r.sourceLine || '');
      return { raw: r, normalized };
    })
  );

  // Step 2: Apply IQR filtering per reference+dial group
  const forIqr = pipelineResults.map((p) => ({
    reference: p.normalized.reference,
    dialColor: p.normalized.dialColor,
    price: p.normalized.priceUSD || 0,
    record: p,
  }));

  const { outliers } = applyIQRFiltering(forIqr, 2);
  const outlierSet = new Set(outliers.map((o) => o.record.raw.id));

  // Step 3: Build enriched records
  const enriched: EnrichedWatchRecord[] = [];
  for (const { raw, normalized } of pipelineResults) {
    const isOutlier = outlierSet.has(raw.id);

    // Catalog lookup
    let catalogEntry = null;
    try {
      const entry = await lookupReference(normalized.reference);
      if (entry) {
        const totalPrices = entry.standardDials.flatMap((d) =>
          Array(d.count).fill(d.avgPriceUSD)
        );
        catalogEntry = {
          standardDials: entry.standardDials.map((d) => d.color),
          avgPriceUSD: totalPrices.length > 0
            ? Math.round(totalPrices.reduce((a, b) => a + b, 0) / totalPrices.length)
            : 0,
          count: entry.standardDials.reduce((s, d) => s + d.count, 0),
        };
      }
    } catch { /* ignore */ }

    enriched.push({
      id: raw.id,
      brand: normalized.brand,
      reference: normalized.reference,
      family: normalized.family,
      dialColor: normalized.dialColor,
      condition: normalized.condition,
      year: normalized.year,
      priceUSD: normalized.priceUSD || raw.priceUSD || 0,
      originalPrice: normalized.originalPrice || raw.price || 0,
      currency: normalized.currency || raw.currency || '',
      hasBox: normalized.hasBox,
      hasPapers: normalized.hasPapers,
      materials: normalized.materials,
      confidence: normalized.confidence,
      flags: [...normalized.flags, ...(isOutlier ? ['IQR_OUTLIER'] : [])],
      source: normalized.source,
      isOutlier,
      outlierReason: isOutlier ? 'Price is statistical outlier for this reference+dial' : undefined,
      catalogVerified: !!catalogEntry,
      catalogEntry: catalogEntry || undefined,
    });
  }

  return enriched;
}

/** Quick catalog stats for UI */
export async function getPipelineStats(): Promise<{
  catalogBrands: number;
  catalogReferences: number;
  catalogDialVariants: number;
}> {
  const stats = await getCatalogStats();
  return {
    catalogBrands: stats.brands,
    catalogReferences: stats.references,
    catalogDialVariants: stats.dialVariants,
  };
}

/** Verify image against text extraction */
export async function verifyImage(
  imageUrl: string,
  textParsed: {
    brand?: string;
    reference?: string;
    dialColor?: string;
  }
): Promise<{
  verdict: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  severity: 'INFO' | 'CRITICAL';
  reason: string;
  discrepancies: string[];
}> {
  try {
    const res = await fetch('/api/verify-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, ...textParsed }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        verdict: 'UNVERIFIED',
        severity: 'INFO',
        reason: data.error || 'Verification service unavailable',
        discrepancies: [],
      };
    }
    return {
      verdict: data.verdict,
      severity: data.severity,
      reason: data.reason,
      discrepancies: data.discrepancies || [],
    };
  } catch (e: any) {
    return {
      verdict: 'UNVERIFIED',
      severity: 'INFO',
      reason: e.message,
      discrepancies: [],
    };
  }
}
