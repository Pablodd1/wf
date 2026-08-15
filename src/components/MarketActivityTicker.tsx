import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

const RELEASED_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith'];
const REFRESH_INTERVAL_MS = 45_000;

type ActivityRecord = {
  brand?: string | null;
  reference?: string | null;
  listing_type?: string | null;
  seller_name?: string | null;
  seller_rating_evidence_status?: string | null;
  seller_review_count?: number | null;
  price_usd?: number | null;
};

function activityText(record: ActivityRecord) {
  const brand = String(record.brand || '').trim();
  const reference = String(record.reference || '').trim();
  const identity = [brand, reference].filter(Boolean).join(' ');
  const intent = String(record.listing_type || '').toUpperCase() === 'WTB' ? 'buyer request' : 'listed';
  const price = Number(record.price_usd);
  const priceLabel = Number.isFinite(price) && price > 0
    ? ` · $${Math.round(price).toLocaleString('en-US')} USD`
    : '';
  const rated = record.seller_rating_evidence_status === 'SOURCE_SUPPLIED'
    || record.seller_rating_evidence_status === 'SOURCE_FEEDBACK_COUNT';
  const dealerLabel = rated && Number(record.seller_review_count) > 0
    ? ` · rated dealer (${Number(record.seller_review_count).toLocaleString('en-US')})`
    : '';
  return `${identity || 'New market item'} · ${intent}${priceLabel}${dealerLabel}`;
}

export function MarketActivityTicker() {
  const { t } = useLanguage();
  const initialBrandIndex = useMemo(() => Math.floor(Date.now() / REFRESH_INTERVAL_MS) % RELEASED_BRANDS.length, []);
  const [brandIndex, setBrandIndex] = useState(initialBrandIndex);
  const [activity, setActivity] = useState('Loading verified market activity…');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const brand = RELEASED_BRANDS[brandIndex];

    fetch(`/api/reviewed-market-inventory?brand=${encodeURIComponent(brand)}&pageSize=1&pagination=cursor`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('market activity unavailable')))
      .then(payload => {
        const record = Array.isArray(payload?.records) ? payload.records[0] : null;
        if (active && record) setActivity(activityText(record));
      })
      .catch(() => undefined);

    const timer = window.setTimeout(() => {
      if (active) setBrandIndex(index => (index + 1) % RELEASED_BRANDS.length);
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [brandIndex]);

  return (
    <div className="overflow-hidden bg-[#211b15] py-2 text-[#d8b36b]" aria-label={t('Live market activity')} aria-live="polite">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 overflow-hidden whitespace-nowrap px-4 font-mono text-[10px] uppercase tracking-[0.08em]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
        <span className="truncate">{activity}</span>
      </div>
    </div>
  );
}

export { activityText, RELEASED_BRANDS, REFRESH_INTERVAL_MS };
