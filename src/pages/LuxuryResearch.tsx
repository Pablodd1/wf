import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { MarketNav } from '@/components/MarketNav';
import { ListingDealerEvidence } from '@/components/ListingDealerEvidence';

type BrandCoverage = { brand: string; listing_count: number };
type CategoryCoverage = {
  category: 'HANDBAG' | 'JEWELRY' | 'ACCESSORY';
  listing_count: number;
  wts_with_price: number;
  wts_without_price: number;
  wtb_activity: number;
  brands: BrandCoverage[];
};
type CoverageResponse = { success: boolean; total_luxury_item_count: number; luxury_categories: CategoryCoverage[] };
type LuxuryObservation = {
  id: string;
  item_category: 'HANDBAG' | 'JEWELRY' | 'ACCESSORY';
  brand?: string | null;
  model?: string | null;
  luxury_item_name?: string | null;
  luxury_item_type?: string | null;
  source_item_description?: string | null;
  maker_evidence_status?: string | null;
  condition?: string | null;
  listing_type?: string | null;
  listing_date?: string | null;
  price_usd?: number | null;
  source_price_amount?: number | null;
  source_currency?: string | null;
  seller_name?: string | null;
  seller_phone?: string | null;
  contact_publication_approved?: boolean;
  seller_rating?: number | null;
  seller_review_count?: number | null;
  seller_rating_evidence_status?: 'SOURCE_SUPPLIED' | 'SOURCE_FEEDBACK_COUNT' | 'UNAVAILABLE';
  seller_group_count?: number | null;
  dealer_profile_path?: string | null;
  location?: string | null;
  raw_message?: string | null;
  thumbnail_url?: string | null;
  has_images?: boolean;
};

const CATEGORY_META = {
  HANDBAG: { label: 'Handbags & purses', item: 'handbags' },
  JEWELRY: { label: 'Jewelry', item: 'jewelry' },
  ACCESSORY: { label: 'Accessories', item: 'accessories' },
} as const;

export default function LuxuryResearch() {
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<keyof typeof CATEGORY_META>('HANDBAG');
  const [brandInput, setBrandInput] = useState('');
  const [typeInput, setTypeInput] = useState('');
  const [query, setQuery] = useState('');
  const [observations, setObservations] = useState<LuxuryObservation[]>([]);
  const [observationsError, setObservationsError] = useState('');
  const [loadingObservations, setLoadingObservations] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/live-release-summary', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Luxury item coverage is temporarily unavailable.');
        return response.json();
      })
      .then(setCoverage)
      .catch(reason => { if (reason?.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      item: CATEGORY_META[selectedCategory].item,
      pageSize: '25',
      pagination: 'cursor',
    });
    if (query) params.set('q', query);
    if (cursor) params.set('cursor', cursor);
    setLoadingObservations(true);
    setObservationsError('');
    fetch(`/api/reviewed-market-inventory?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Reviewed luxury observations are temporarily unavailable.');
        return response.json();
      })
      .then(result => {
        setObservations(Array.isArray(result.records) ? result.records : []);
        setNextCursor(result.nextCursor || null);
      })
      .catch(reason => { if (reason?.name !== 'AbortError') setObservationsError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingObservations(false); });
    return () => controller.abort();
  }, [cursor, query, selectedCategory]);

  const applyObservationFilters = (event: FormEvent) => {
    event.preventDefault();
    setCursor(null);
    setCursorHistory([]);
    setQuery([brandInput, typeInput].map(value => value.trim()).filter(Boolean).join(' '));
  };

  return (
    <main className="min-h-screen bg-[#f3ecdf] text-[#211b15]">
      <MarketNav />
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7127]">Curated Luxury market evidence</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Luxury Item Research</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#675b4d]">
          Research explicitly classified handbags, jewelry, and accessories by item type and source-supplied brand. This lane is separate from watch reference Price Research: WTB demand and no-price activity are counted, but neither is used as a sale price.
        </p>
        {error && <div className="mt-8 border border-[#a33]/30 bg-white/50 p-5 text-sm text-[#8c2929]">{error}</div>}
        {!coverage && !error && <p className="mt-8 text-sm text-[#675b4d]">Loading reviewed luxury inventory…</p>}
        {coverage && (
          <>
            <p className="mt-8 text-sm font-semibold">{coverage.total_luxury_item_count.toLocaleString()} explicitly classified luxury-item observations</p>
            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              {coverage.luxury_categories.map(category => {
                const meta = CATEGORY_META[category.category];
                return (
                  <article key={category.category} className="border border-[#3f3324]/15 bg-white/45 p-6">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9a7127]">{category.category}</p>
                    <h2 className="mt-2 font-serif text-2xl">{meta.label}</h2>
                    <p className="mt-2 text-3xl font-semibold">{category.listing_count.toLocaleString()}</p>
                    <dl className="mt-5 grid grid-cols-3 gap-3 text-xs">
                      <div><dt className="text-[#675b4d]">WTS priced</dt><dd className="mt-1 font-semibold">{category.wts_with_price.toLocaleString()}</dd></div>
                      <div><dt className="text-[#675b4d]">WTS no price</dt><dd className="mt-1 font-semibold">{category.wts_without_price.toLocaleString()}</dd></div>
                      <div><dt className="text-[#675b4d]">WTB</dt><dd className="mt-1 font-semibold">{category.wtb_activity.toLocaleString()}</dd></div>
                    </dl>
                    <Link to={`/trading?item=${meta.item}`} className="mt-6 inline-flex min-h-11 items-center border border-[#9a7127] px-4 text-sm font-semibold text-[#735c32]">View {meta.label}</Link>
                    {category.brands.length > 0 && (
                      <div className="mt-6 border-t border-[#3f3324]/10 pt-4">
                        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#675b4d]">Source-supplied brands</h3>
                        <ul className="mt-3 space-y-2 text-sm">
                          {category.brands.slice(0, 8).map(brand => (
                            <li key={brand.brand} className="flex justify-between gap-3"><span>{brand.brand}</span><span>{brand.listing_count.toLocaleString()}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="mt-8 border border-[#3f3324]/15 bg-white/35 p-5 text-xs leading-6 text-[#675b4d]">
              Ambiguous and unclassified source rows are withheld. Luxury-item prices are source observations, not appraisals or watch-reference comparables.
            </div>

            <section className="mt-12" aria-labelledby="luxury-observations-title">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7127]">Reviewed source observations</p>
              <h2 id="luxury-observations-title" className="mt-2 font-serif text-3xl">Item name, maker, type, and market activity</h2>
              <form onSubmit={applyObservationFilters} className="mt-5 grid gap-3 border border-[#3f3324]/15 bg-white/35 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
                <label className="text-xs text-[#675b4d]">Category
                  <select value={selectedCategory} onChange={event => { setSelectedCategory(event.target.value as keyof typeof CATEGORY_META); setCursor(null); setCursorHistory([]); }} className="mt-2 h-11 w-full border border-[#3f3324]/20 bg-white px-3 text-sm text-[#211b15]">
                    {Object.entries(CATEGORY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[#675b4d]">Brand or maker
                  <input value={brandInput} onChange={event => setBrandInput(event.target.value)} placeholder="Hermes, Cartier…" className="mt-2 h-11 w-full border border-[#3f3324]/20 bg-white px-3 text-sm text-[#211b15]" />
                </label>
                <label className="text-xs text-[#675b4d]">Item name or type
                  <input value={typeInput} onChange={event => setTypeInput(event.target.value)} placeholder="Birkin, necklace, wallet…" className="mt-2 h-11 w-full border border-[#3f3324]/20 bg-white px-3 text-sm text-[#211b15]" />
                </label>
                <button type="submit" className="min-h-11 self-end bg-[#9a7127] px-5 text-sm font-semibold text-white">Research</button>
              </form>
              {observationsError && <div className="mt-4 border border-[#a33]/30 bg-white/50 p-4 text-sm text-[#8c2929]">{observationsError}</div>}
              {loadingObservations && <p className="mt-4 text-sm text-[#675b4d]">Loading reviewed observations…</p>}
              {!loadingObservations && !observationsError && (
                <div className="mt-5 overflow-x-auto border border-[#3f3324]/15 bg-white/45">
                  <table className="min-w-[1050px] w-full border-collapse text-left text-xs">
                    <thead className="bg-[#e8ddca] text-[#675b4d]"><tr>
                      {['Image', 'Type', 'Brand / maker', 'Item name / style', 'Condition', 'Intent', 'Price evidence', 'Date', 'Seller', 'Location', 'Raw source evidence'].map(label => <th key={label} className="border-b border-[#3f3324]/15 px-4 py-3 font-semibold">{label}</th>)}
                    </tr></thead>
                    <tbody>{observations.map(row => <tr key={row.id} className="align-top odd:bg-white/30">
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{row.has_images && row.thumbnail_url ? <img src={row.thumbnail_url} alt="" className="h-14 w-14 rounded object-cover" /> : null}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{row.luxury_item_type || CATEGORY_META[row.item_category]?.label || row.item_category}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3 font-semibold">{row.brand || 'Maker pending review'}{row.maker_evidence_status === 'MISSING_REVIEW_REQUIRED' && <div className="mt-1 text-[10px] font-normal text-[#8c6b32]">Not inferred</div>}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3"><div className="font-semibold">{row.luxury_item_name || row.model || 'Identity pending review'}</div>{row.source_item_description && row.source_item_description !== row.luxury_item_name && <div className="mt-1 max-w-[260px] text-[10px] leading-4 text-[#675b4d]">{row.source_item_description}</div>}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{row.condition || 'Not supplied'}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{row.listing_type || 'Unspecified'}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{formatLuxuryPrice(row)}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{row.listing_date ? new Date(row.listing_date).toLocaleDateString() : 'Not supplied'}</td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3"><ListingDealerEvidence sellerName={row.seller_name} sellerPhone={row.seller_phone} contactPublicationApproved={row.contact_publication_approved === true} rating={row.seller_rating} reviewCount={row.seller_review_count} ratingEvidenceStatus={row.seller_rating_evidence_status} groupCount={row.seller_group_count} profilePath={row.dealer_profile_path} /></td>
                      <td className="border-b border-[#3f3324]/10 px-4 py-3">{row.location || 'Not supplied'}</td>
                      <td className="max-w-[310px] border-b border-[#3f3324]/10 px-4 py-3 leading-5">{row.raw_message || 'Not supplied'}</td>
                    </tr>)}</tbody>
                  </table>
                  {observations.length === 0 && <p className="p-6 text-sm text-[#675b4d]">No reviewed observations match these filters.</p>}
                </div>
              )}
              <nav className="mt-5 flex items-center justify-between gap-3" aria-label="Luxury observations pages">
                <button type="button" disabled={cursorHistory.length === 0 || loadingObservations} onClick={() => { const previous = cursorHistory[cursorHistory.length - 1] ?? null; setCursorHistory(history => history.slice(0, -1)); setCursor(previous); }} className="min-h-11 border border-[#9a7127] px-5 text-sm font-semibold text-[#735c32] disabled:opacity-40">Previous</button>
                <span className="text-xs text-[#675b4d]">{observations.length.toLocaleString()} reviewed observations on this page</span>
                <button type="button" disabled={!nextCursor || loadingObservations} onClick={() => { setCursorHistory(history => [...history, cursor]); setCursor(nextCursor); }} className="min-h-11 bg-[#9a7127] px-5 text-sm font-semibold text-white disabled:opacity-40">Next</button>
              </nav>
              <p className="mt-5 text-xs leading-6 text-[#675b4d]">No average or appraisal is generated unless at least two verified WTS observations share the same category, source-backed maker and item type, and carry dated currency evidence.</p>
            </section>
          </>
        )}
      </section>
      <Footer />
    </main>
  );
}

function formatLuxuryPrice(row: LuxuryObservation) {
  const usd = Number(row.price_usd);
  if (Number.isFinite(usd) && usd > 0) return `${usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} USD`;
  const source = Number(row.source_price_amount);
  if (Number.isFinite(source) && source > 0) return `${source.toLocaleString()} ${row.source_currency || 'currency unconfirmed'}`;
  return 'Price not supplied';
}
