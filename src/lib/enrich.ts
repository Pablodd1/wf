/**
 * Client for /api/enrich — structured watch enrichment.
 * Returns catalog data, market prices (chrono24/watchcharts), and official URLs.
 */

export interface EnrichmentData {
  reference: string | null;
  catalog: {
    model: string | null;
    collection: string | null;
    caseMetal: string | null;
    productionYears: string | null;
    status: string | null;
    liquidityScore: number | null;
    buyerRatio: number | null;
    sellerRatio: number | null;
  } | null;
  market: {
    chrono24: {
      source: string;
      url: string;
      listingCount: number | null;
      priceRange: { low: number; high: number; median: number } | null;
      imageUrl: string | null;
    } | null;
    watchcharts: {
      source: string;
      url: string | null;
      priceRange: { low: number; high: number } | null;
    } | null;
    ddgTopResult: {
      title: string;
      url: string;
      snippet: string;
    } | null;
  };
  officialUrl: string | null;
  confidenceBoost: number;
}

export interface EnrichResponse {
  success: boolean;
  enrichment: EnrichmentData | null;
  error?: string;
}

export async function enrichWatch(reference: string, brand?: string): Promise<EnrichResponse> {
  try {
    const params = new URLSearchParams();
    if (reference) params.set('reference', reference);
    if (brand) params.set('brand', brand);
    const res = await fetch(`/api/enrich?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      return { success: false, enrichment: null, error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (e: any) {
    return { success: false, enrichment: null, error: e.message };
  }
}
