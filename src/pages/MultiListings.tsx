import { ChevronLeft, ChevronRight, Download, Layers3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MarketNav } from '@/components/MarketNav';

interface Candidate {
  brand?: string | null;
  reference?: string | null;
  dial_color?: string | null;
  condition?: string | null;
  listing_type?: string | null;
  price_usd?: number | null;
  currency?: string | null;
  raw_line?: string | null;
}

interface BundleRecord {
  source_record_id: string;
  candidate_count: number;
  proposed_candidates: Candidate[];
  review_status: string;
  analyzed_at: string;
  source: { raw_message: string | null; seller_name: string | null; seller_phone: string | null; created_at: string; source: string } | null;
}

export default function MultiListings() {
  const [records, setRecords] = useState<BundleRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin-multilistings?page=${page}&pageSize=${pageSize}`, { credentials: 'include', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load bundles'); return body; })
      .then(body => { setRecords(body.records || []); setTotal(Number(body.total) || 0); setError(''); })
      .catch(caught => { if (caught?.name !== 'AbortError') setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page]);

  function downloadPage() {
    const blob = new Blob([JSON.stringify({ page, pageSize, total, records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `watchfacts-multilistings-page-${page}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <MarketNav />
      <section className="border-b border-white/10 px-5 py-9 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3 text-[#c9a96e]"><Layers3 size={20} /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Administrator review</span></div>
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="font-serif text-4xl sm:text-5xl">Multi-listing separation</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55">Every parent message remains immutable. Candidate watches are reviewed as children first; only an approved split can suppress the parent from price analytics, and duplicate review happens afterward.</p>
            </div>
            <button type="button" onClick={downloadPage} disabled={!records.length} className="flex h-11 items-center justify-center gap-2 border border-white/15 px-4 text-xs font-semibold disabled:opacity-35"><Download size={15} /> Export this page</button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-7 sm:px-8 lg:px-12">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-white/45">
          <span>{loading ? 'Loading review queue...' : `${total.toLocaleString()} bundle sources require separation`}</span>
          <span>Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
        </div>
        {error && <div role="alert" className="border border-red-400/25 bg-red-400/[0.07] px-4 py-3 text-sm text-red-100/75">{error}</div>}
        <div className="space-y-4">
          {records.map(record => (
            <article key={record.source_record_id} className="border border-white/10 bg-[#111118]">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div>
                  <div className="font-mono text-xs text-white/60">{record.source_record_id}</div>
                  <div className="mt-1 text-xs text-white/35">{record.source?.seller_name || 'Unresolved dealer'} · {record.source?.created_at?.split('T')[0] || 'Unknown date'}</div>
                </div>
                <span className="border border-[#c9a96e]/30 px-3 py-1 text-xs text-[#d4b87a]">{record.candidate_count} proposed candidates · {record.review_status}</span>
              </header>
              <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
                <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Raw source message — unchanged</div>
                  <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-white/60">{record.source?.raw_message || 'Raw message unavailable'}</pre>
                </div>
                <div className="divide-y divide-white/10">
                  {(record.proposed_candidates || []).map((candidate, index) => (
                    <div key={`${record.source_record_id}-${index}`} className="p-5">
                      <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-[#c9a96e]">Candidate {index + 1}</span><span className="text-xs text-white/40">{candidate.listing_type || 'Unknown intent'}</span></div>
                      <div className="mt-2 font-semibold">{[candidate.brand, candidate.reference, candidate.dial_color].filter(Boolean).join(' · ') || 'Unresolved watch'}</div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/45"><span>{candidate.condition || 'Condition unspecified'}</span><span>{candidate.price_usd ? `$${Number(candidate.price_usd).toLocaleString()}` : 'Price unresolved'}</span><span>{candidate.currency || 'Currency unresolved'}</span></div>
                      {candidate.raw_line && <div className="mt-3 border-l border-white/15 pl-3 font-mono text-xs text-white/40">{candidate.raw_line}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage(value => Math.max(1, value - 1)); }} className="flex h-10 items-center gap-2 border border-white/15 px-4 text-xs disabled:opacity-35"><ChevronLeft size={15} /> Previous</button>
          <button type="button" disabled={page >= pages || loading} onClick={() => { setLoading(true); setPage(value => Math.min(pages, value + 1)); }} className="flex h-10 items-center gap-2 bg-[#c9a96e] px-4 text-xs font-semibold text-[#08080c] disabled:opacity-35">Next <ChevronRight size={15} /></button>
        </div>
      </section>
    </main>
  );
}
