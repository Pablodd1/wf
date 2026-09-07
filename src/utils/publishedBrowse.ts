export const canaryBrowseEnabled = import.meta.env.VITE_USE_CANARY_V2 === 'true'
  || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

export interface PublishedBrowse {
  success: boolean;
  snapshot_id: string;
  brands: { brand: string; listing_count: number; model_count: number; reference_count: number }[];
  models: { model: string; reference_count: number; listing_count: number; image_url?: string | null }[];
  references: { reference: string; model: string | null; listing_count: number; image_url?: string | null; wts_count?: number; wtb_count?: number }[];
  availableCountries?: string[];
  availableRegions?: string[];
}

export async function loadPublishedBrowse(surface: 'trading_floor' | 'price_research', brand: string, model: string, signal: AbortSignal, snapshot?: string) {
  const params = new URLSearchParams({ surface });
  if (brand) params.set('brand', brand);
  if (model) params.set('model', model);
  if (snapshot) params.set('snapshot', snapshot);
  const response = await fetch(`/api/canary/browse?${params}`, { signal });
  const payload = await response.json() as PublishedBrowse;
  if (!response.ok || !payload.success) throw new Error('Published watch options are temporarily unavailable');
  return payload;
}
