type Observation = {
  id?: string;
  listing_id?: string;
  brand?: string | null;
  model?: string | null;
  reference?: string | null;
  intent?: string | null;
  listing_type?: string | null;
  price_usd?: number | null;
  price_display_verified?: boolean;
  is_bundle?: boolean;
  multi_listing?: boolean;
  parent_listing_id?: string | null;
};

export function marketTickerItems(rows: Observation[]) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const id = row.listing_id || row.id;
    const status = row.intent || row.listing_type;
    const model = [row.brand, row.model, row.reference].filter(Boolean).join(' ');
    if (!id || seen.has(id) || !model || !['WTS', 'WTB'].includes(status || '')
      || row.is_bundle || row.multi_listing || row.parent_listing_id) return [];
    seen.add(id);
    const price = row.price_display_verified === true && typeof row.price_usd === 'number'
      && Number.isFinite(row.price_usd) && row.price_usd > 0
      ? `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(row.price_usd)} USD`
      : 'Price not confirmed';
    return [{ id, model, status, price }];
  }).slice(0, 12);
}
