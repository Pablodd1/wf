import { useState, useEffect } from 'react';

export interface EnrichedRef {
  reference: string;
  collection: string;
  model: string;
  case_metal: string;
  production_years: string;
  status: string;
  total_mentions: number;
  buyers: number;
  sellers: number;
  unclear: number;
  buyer_ratio: number;
  seller_ratio: number;
  buyer_seller_ratio: number;
  liquidity_score: number;
  in_catalog: boolean;
  has_images: boolean;
  image_count: number;
}

export function useLiquidityData() {
  const [refs, setRefs] = useState<EnrichedRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/enriched_refs.json')
      .then((r) => r.json())
      .then((data: EnrichedRef[]) => {
        // Sort by liquidity score descending, then by total mentions
        const sorted = data.filter(row => Number.isFinite(row.liquidity_score)
          && Number.isFinite(row.total_mentions)).sort((a, b) => {
          if (b.liquidity_score !== a.liquidity_score) {
            return b.liquidity_score - a.liquidity_score;
          }
          return b.total_mentions - a.total_mentions;
        });
        setRefs(sorted);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load liquidity data:', err);
        setLoading(false);
      });
  }, []);

  // Group by collection
  const byCollection = refs.reduce<Record<string, EnrichedRef[]>>((acc, ref) => {
    const col = ref.collection || 'Other';
    if (!acc[col]) acc[col] = [];
    acc[col].push(ref);
    return acc;
  }, {});

  // Summary stats
  const stats = {
    totalRefs: refs.length,
    totalMentions: refs.reduce((s, r) => s + r.total_mentions, 0),
    totalBuyers: refs.reduce((s, r) => s + r.buyers, 0),
    totalSellers: refs.reduce((s, r) => s + r.sellers, 0),
    inCatalog: refs.filter((r) => r.in_catalog).length,
    avgLiquidity: refs.length > 0 ? Math.round(refs.reduce((s, r) => s + r.liquidity_score, 0) / refs.length) : 0,
  };

  return { refs, byCollection, loading, stats };
}
