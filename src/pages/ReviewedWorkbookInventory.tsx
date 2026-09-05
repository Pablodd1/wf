import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Search } from 'lucide-react';
import { MarketNav } from '@/components/MarketNav';

type ReviewRecord = {
  id: string;
  source_file: string;
  source_row_number: number;
  source_record_id: string | null;
  posting_date: string | null;
  posted_by: string | null;
  phone_number: string | null;
  raw_message: string | null;
  listing_type: string | null;
  brand_scope: string;
  supplied_brand: string | null;
  model: string | null;
  raw_reference: string | null;
  normalized_reference: string | null;
  catalog_reference: string | null;
  catalog_model: string | null;
  dial_color: string | null;
  catalog_dial: string | null;
  condition: string | null;
  workbook_price_usd: number | null;
  source_price_amount: number | null;
  source_price_text: string | null;
  source_currency: string | null;
  price_evidence_status: string;
  verification_status: string | null;
  display_image_url: string | null;
  image_evidence_type: string | null;
  review_reasons: string[];
};

type BrandSummary = {
  brand: string;
  files: number;
  files_complete: number;
  source_rows: number;
  canonical_listings: number;
  duplicate_rows_held: number;
};

type InventoryResponse = {
  status: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  records: ReviewRecord[];
  summary: {
    files_total: number;
    files_complete: number;
    source_rows: number;
    rows_scanned: number;
    canonical_listings: number;
    duplicate_rows_held: number;
    errors: number;
    reconciled: boolean;
    brands: BrandSummary[];
  };
  error?: string;
};

const GOLD = '#c9a96e';
const GOLD_BRIGHT = '#e4ca91';
const PAGE = '#08080c';
const PANEL = '#101016';
const BORDER = '#2a2932';
const MUTED = '#aaa7b2';
const INK = '#f6f2e8';

function formatNumber(value: number | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
}

function EvidenceImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="h-72 w-full rounded-md object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function priceLabel(record: ReviewRecord) {
  if (record.source_price_text && record.source_currency) {
    return record.source_price_text;
  }
  return '';
}

function evidenceLabel(status: string) {
  if (status === 'SOURCE_EXPLICIT_USD_MATCH') return 'Source-supported USD';
  if (status === 'DATED_FX_PROVENANCE_REQUIRED') return 'FX evidence required';
  if (status === 'EXPLICIT_USD_PRICE_CONFLICT') return 'USD value conflict';
  return 'Currency needs review';
}

export default function ReviewedWorkbookInventory() {
  const [payload, setPayload] = useState<InventoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [brand, setBrand] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [reference, setReference] = useState('');
  const [sourceFileInput, setSourceFileInput] = useState('');
  const [sourceFile, setSourceFile] = useState('');
  const [imagesOnly, setImagesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: '48' });
    if (brand) params.set('brand', brand);
    if (reference) params.set('reference', reference);
    if (sourceFile) params.set('sourceFile', sourceFile);
    if (imagesOnly) params.set('images', 'true');
    fetch(`/api/reviewed-workbook-inventory?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json() as InventoryResponse;
        if (!response.ok || result.status !== 'ok') {
          throw new Error(result.error || 'Source review is unavailable');
        }
        setPayload(result);
      })
      .catch(caught => {
        if ((caught as Error).name !== 'AbortError') {
          setError((caught as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [brand, imagesOnly, page, reference, sourceFile]);

  const summary = payload?.summary;
  const rows = payload?.records || [];
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(Number(payload?.total || 0) / Number(payload?.pageSize || 48))),
    [payload],
  );

  return (
    <main className="min-h-screen" style={{ background: PAGE, color: INK }}>
      <MarketNav />
      <section className="border-b" style={{ borderColor: BORDER, background: PANEL }}>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
            Source evidence
          </p>
          <h1 className="mt-2 font-serif text-3xl sm:text-4xl" style={{ color: GOLD_BRIGHT }}>
            Reviewed Workbook Inventory
          </h1>
          <p className="mt-3 max-w-4xl text-sm leading-6" style={{ color: MUTED }}>
            Exact owner-supplied workbook rows for client review. Duplicate copies are held,
            images appear only when the exact row supplies a seller image, and Price Research
            remains limited to source-supported price and currency evidence.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['Files', `${formatNumber(summary?.files_complete)} / ${formatNumber(summary?.files_total)}`],
              ['Source rows', formatNumber(summary?.source_rows)],
              ['Scanned', formatNumber(summary?.rows_scanned)],
              ['Canonical listings', formatNumber(summary?.canonical_listings)],
              ['Duplicates held', formatNumber(summary?.duplicate_rows_held)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-4" style={{ borderColor: BORDER, background: PAGE }}>
                <div className="text-[11px] uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</div>
                <div className="mt-2 text-xl font-semibold" style={{ color: INK }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-3 rounded-md border p-4 lg:grid-cols-[1fr_1fr_1fr_auto]" style={{ borderColor: BORDER, background: PANEL }}>
          <select
            value={brand}
            onChange={event => {
              setLoading(true);
              setError('');
              setBrand(event.target.value);
              setPage(1);
            }}
            className="h-11 rounded-md border px-3 text-sm"
            style={{ borderColor: BORDER, background: PAGE, color: INK }}
          >
            <option value="">All imported brands</option>
            {(summary?.brands || []).map(item => (
              <option key={item.brand} value={item.brand}>
                {item.brand} · {formatNumber(item.canonical_listings)}
              </option>
            ))}
          </select>
          <form
            className="relative"
            onSubmit={event => {
              event.preventDefault();
              setLoading(true);
              setError('');
              setReference(referenceInput.trim());
              setPage(1);
            }}
          >
            <Search size={16} className="absolute left-3 top-3.5" style={{ color: MUTED }} />
            <input
              value={referenceInput}
              onChange={event => setReferenceInput(event.target.value)}
              placeholder="Exact reference"
              className="h-11 w-full rounded-md border pl-10 pr-3 text-sm"
              style={{ borderColor: BORDER, background: PAGE, color: INK }}
            />
          </form>
          <form
            className="relative"
            onSubmit={event => {
              event.preventDefault();
              setLoading(true);
              setError('');
              setSourceFile(sourceFileInput.trim());
              setPage(1);
            }}
          >
            <Search size={16} className="absolute left-3 top-3.5" style={{ color: MUTED }} />
            <input
              value={sourceFileInput}
              onChange={event => setSourceFileInput(event.target.value)}
              placeholder="Exact source workbook"
              className="h-11 w-full rounded-md border pl-10 pr-3 text-sm"
              style={{ borderColor: BORDER, background: PAGE, color: INK }}
            />
          </form>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError('');
              setImagesOnly(value => !value);
              setPage(1);
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold"
            style={{
              borderColor: imagesOnly ? GOLD : BORDER,
              background: imagesOnly ? GOLD : PAGE,
              color: imagesOnly ? PAGE : INK,
            }}
          >
            <ImageIcon size={16} /> Images only
          </button>
        </div>

        <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm" style={{ color: MUTED }}>
          <span>
            {formatNumber(payload?.total)} canonical source-review listings
            {summary?.reconciled ? ' · imported rows reconcile exactly' : ''}
          </span>
          {error && <span className="text-red-300">{error}</span>}
        </div>

        {loading ? (
          <div className="py-20 text-center" style={{ color: MUTED }}>Loading source evidence…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border py-20 text-center" style={{ borderColor: BORDER, color: MUTED }}>
            No imported source-review rows match these filters.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(record => {
              const title = [
                record.brand_scope,
                record.normalized_reference || record.raw_reference,
                record.dial_color,
              ].filter(Boolean).join(' · ');
              return (
                <article key={record.id} className="flex flex-col rounded-md border p-5" style={{ borderColor: BORDER, background: PANEL }}>
                  {record.display_image_url && (
                    <EvidenceImage src={record.display_image_url} alt={title || record.brand_scope} />
                  )}
                  <div className={record.display_image_url ? 'mt-4' : ''}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: GOLD }}>
                      {record.listing_type || 'Listing'}{record.condition ? ` · ${record.condition}` : ''}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold">{title || record.brand_scope}</h2>
                    {priceLabel(record) && (
                      <div className="mt-2 text-base font-semibold" style={{ color: GOLD_BRIGHT }}>
                        {priceLabel(record)}
                      </div>
                    )}
                    <div className="mt-1 text-xs" style={{ color: MUTED }}>
                      {evidenceLabel(record.price_evidence_status)}
                    </div>
                  </div>

                  {(record.posted_by || record.phone_number || record.posting_date) && (
                    <div className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: BORDER, background: PAGE }}>
                      {record.posted_by && <div>Posted by: {record.posted_by}</div>}
                      {record.phone_number && <div className="mt-1">Contact: {record.phone_number}</div>}
                      {formatDate(record.posting_date) && <div className="mt-1" style={{ color: MUTED }}>{formatDate(record.posting_date)}</div>}
                    </div>
                  )}

                  {record.raw_message && (
                    <blockquote className="mt-4 whitespace-pre-wrap rounded-md border p-3 text-sm leading-6" style={{ borderColor: BORDER, background: PAGE, color: INK }}>
                      {record.raw_message}
                    </blockquote>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.1em]" style={{ color: MUTED }}>
                    {(record.review_reasons || []).slice(0, 4).map(reason => (
                      <span key={reason} className="rounded border px-2 py-1" style={{ borderColor: BORDER }}>
                        {reason.replaceAll('_', ' ')}
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto pt-5 text-xs" style={{ color: MUTED }}>
                    <div>{record.source_file} · row {formatNumber(record.source_row_number)}</div>
                    {record.source_record_id && <div className="mt-1 break-all">Source {record.source_record_id}</div>}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setLoading(true);
              setError('');
              setPage(value => Math.max(1, value - 1));
            }}
            className="h-10 rounded-md border px-4 text-sm disabled:opacity-35"
            style={{ borderColor: BORDER }}
          >
            Previous
          </button>
          <span className="text-sm" style={{ color: MUTED }}>Page {page} of {pageCount}</span>
          <button
            type="button"
            disabled={!payload?.hasMore}
            onClick={() => {
              setLoading(true);
              setError('');
              setPage(value => value + 1);
            }}
            className="h-10 rounded-md border px-4 text-sm disabled:opacity-35"
            style={{ borderColor: BORDER }}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
