import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

const RELEASED_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith'];
const LUXURY_CATEGORIES = ['handbags', 'jewelry', 'accessories'];
const REFRESH_INTERVAL_MS = 90_000;

type ActivityRecord = {
  id?: string | null;
  brand?: string | null;
  model?: string | null;
  reference?: string | null;
  luxury_item_name?: string | null;
  luxury_item_type?: string | null;
  listing_type?: string | null;
  listing_date?: string | null;
  created_at?: string | null;
  seller_rating_evidence_status?: string | null;
  seller_review_count?: number | null;
  price_usd?: number | null;
};

function compactText(value: unknown, maxLength = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function activityText(record: ActivityRecord) {
  const brand = compactText(record.brand, 32);
  const reference = compactText(record.reference, 32);
  const itemName = compactText(record.luxury_item_name || record.model || record.luxury_item_type, 54);
  const identity = [brand, reference || itemName].filter(Boolean).join(' ');
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

function activityTimestamp(record: ActivityRecord) {
  const timestamp = Date.parse(String(record.listing_date || record.created_at || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function activitySources() {
  const watches = RELEASED_BRANDS.map(brand =>
    `/api/reviewed-market-inventory?brand=${encodeURIComponent(brand)}&item=watches&pageSize=1&pagination=cursor`,
  );
  const luxury = LUXURY_CATEGORIES.map(item =>
    `/api/reviewed-market-inventory?item=${encodeURIComponent(item)}&pageSize=1&pagination=cursor`,
  );
  return [...watches, ...luxury];
}

export function MarketActivityTicker() {
  const { t } = useLanguage();
  const sources = useMemo(activitySources, []);
  const [records, setRecords] = useState<ActivityRecord[]>([]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const settled = await Promise.allSettled(sources.map(source =>
        fetch(source, { signal, headers: { Accept: 'application/json' } })
          .then(response => response.ok ? response.json() : Promise.reject(new Error('market activity unavailable'))),
      ));
      if (!active || signal.aborted) return;

      const deduped = new Map<string, ActivityRecord>();
      settled.forEach(result => {
        if (result.status !== 'fulfilled') return;
        const record = Array.isArray(result.value?.records) ? result.value.records[0] : null;
        const id = String(record?.id || '').trim();
        if (id) deduped.set(id, record);
      });
      const nextRecords = [...deduped.values()].sort((left, right) =>
        activityTimestamp(right) - activityTimestamp(left),
      );
      if (nextRecords.length > 0) setRecords(nextRecords);
    };

    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [sources]);

  const activities = records.length > 0
    ? records.map(record => ({ id: String(record.id), text: activityText(record) }))
    : [{ id: 'loading', text: 'Loading current watch and luxury-item activity…' }];
  const tickerStyle = {
    '--market-ticker-duration': `${Math.max(36, activities.length * 8)}s`,
  } as CSSProperties;

  const activityGroup = (duplicate = false) => (
    <div className="flex shrink-0 items-center" aria-hidden={duplicate || undefined}>
      {activities.map(activity => (
        <span key={`${duplicate ? 'duplicate-' : ''}${activity.id}`} className="flex shrink-0 items-center gap-3 px-5 sm:px-8">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
          <span>{activity.text}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="market-activity-viewport overflow-hidden bg-[#211b15] py-1.5 text-[#d8b36b]" aria-label={t('Live market activity')}>
      <span className="sr-only" aria-live="polite">
        {records.length > 0 ? `${records.length} current market updates loaded.` : 'Loading current market activity.'}
      </span>
      <div
        className="market-activity-track flex w-max whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.08em] sm:text-[10px]"
        style={tickerStyle}
        data-testid="market-activity-track"
      >
        {activityGroup()}
        {activityGroup(true)}
      </div>
    </div>
  );
}

export { activityText, activitySources, RELEASED_BRANDS, LUXURY_CATEGORIES, REFRESH_INTERVAL_MS };
