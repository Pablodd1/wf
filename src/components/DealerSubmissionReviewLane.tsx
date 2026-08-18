import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';

interface SubmissionItem {
  id: string;
  intent: 'WTS' | 'WTB';
  category: 'WATCH' | 'HANDBAG' | 'JEWELRY' | 'ACCESSORY' | 'OTHER';
  raw_message: string;
  claimed_fields: Record<string, string | number | boolean | null>;
  image_urls: string[];
  poster_image_url?: string | null;
  publication_status: string;
  review_status: string;
  bulk_submission_id?: string | null;
  queued_at?: string | null;
  created_at: string;
}

interface Draft {
  title: string;
  brand: string;
  model: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_amount: string;
  currency: string;
  catalog_confirmed: boolean;
  review_notes: string;
}

const draftFor = (item: SubmissionItem): Draft => ({
  title: String(item.claimed_fields.title || ''),
  brand: String(item.claimed_fields.brand || ''),
  model: String(item.claimed_fields.model || ''),
  reference: String(item.claimed_fields.reference || ''),
  dial_color: String(item.claimed_fields.dial_color || ''),
  condition: String(item.claimed_fields.condition || ''),
  price_amount: item.claimed_fields.price_amount == null ? '' : String(item.claimed_fields.price_amount),
  currency: String(item.claimed_fields.currency || ''),
  catalog_confirmed: false,
  review_notes: '',
});

export function DealerSubmissionReviewLane() {
  const [items, setItems] = useState<SubmissionItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/dealer-submission-review?limit=50', { credentials: 'include' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Dealer submission queue is unavailable.');
      const next = (payload.items || []) as SubmissionItem[];
      setItems(next);
      setDrafts(current => Object.fromEntries(next.map(item => [item.id, current[item.id] || draftFor(item)])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dealer submission queue is unavailable.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (item: SubmissionItem, decision: 'APPROVE' | 'REJECT') => {
    const draft = drafts[item.id] || draftFor(item);
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/api/dealer-submission-review', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submission_id: item.id, decision, review_notes: draft.review_notes,
          normalized_fields: {
            title: draft.title, brand: draft.brand, model: draft.model, reference: draft.reference,
            dial_color: draft.dial_color, condition: draft.condition,
            price_amount: draft.price_amount || null, currency: draft.currency,
            catalog_confirmed: item.category === 'WATCH' && draft.catalog_confirmed,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to apply review decision.');
      setItems(current => current.filter(candidate => candidate.id !== item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to apply review decision.');
    } finally { setBusy(null); }
  };

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold text-text-primary">Post an Item review</h2><p className="mt-1 text-xs text-text-muted">Immutable user evidence remains available for review. Publication is held until the shared normalization and release gates pass.</p></div>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-xs text-text-secondary"><RefreshCw size={14} /> Refresh</button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</div>}
    {loading && <div className="flex items-center gap-2 py-8 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" /> Loading dealer submissions...</div>}
    {!loading && items.length === 0 && <div className="rounded-xl border border-border-default p-8 text-center text-sm text-text-muted">No dealer submissions are waiting for review.</div>}
    {items.map(item => {
      const draft = drafts[item.id] || draftFor(item);
      const poster = [item.claimed_fields.poster_name, item.claimed_fields.poster_phone, item.claimed_fields.location].filter(Boolean).join(' · ');
      const set = (patch: Partial<Draft>) => setDrafts(current => ({ ...current, [item.id]: { ...draft, ...patch } }));
      return <article key={item.id} className="rounded-xl border border-border-default bg-bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-gold-primary">{item.intent} · {item.category}</p><p className="mt-1 text-xs text-text-muted">{poster || 'Credential details unavailable'} · Batch {item.bulk_submission_id?.slice(0, 8) || 'legacy'}</p></div><span className="rounded-full border border-amber-400/30 px-2 py-1 text-[10px] text-amber-300">{item.review_status}</span></div>
        <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-xs leading-5 text-text-secondary">{item.raw_message}</pre>
        {item.image_urls?.length > 0 && <div className="mt-4 flex gap-3 overflow-x-auto">{item.image_urls.map(url => <img key={url} src={url} alt="Source item evidence" className="h-28 w-28 shrink-0 rounded-lg border border-border-default object-cover" />)}</div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Title / item" value={draft.title} onChange={value => set({ title: value })} />
          {item.category === 'WATCH' && <><Field label="Brand" value={draft.brand} onChange={value => set({ brand: value })} /><Field label="Model" value={draft.model} onChange={value => set({ model: value })} /><Field label="Reference" value={draft.reference} onChange={value => set({ reference: value })} /><Field label="Dial" value={draft.dial_color} onChange={value => set({ dial_color: value })} /></>}
          <Field label="Condition" value={draft.condition} onChange={value => set({ condition: value })} />
          <Field label="Source price" value={draft.price_amount} onChange={value => set({ price_amount: value })} />
          <Field label="Currency" value={draft.currency} onChange={value => set({ currency: value.toUpperCase() })} />
        </div>
        {item.category === 'WATCH' && <label className="mt-4 flex items-start gap-2 text-xs text-text-secondary"><input type="checkbox" checked={draft.catalog_confirmed} onChange={event => set({ catalog_confirmed: event.target.checked })} /> Catalog identity confirmed. Only catalog-confirmed WTS watches with verified USD can enter Price Research calculations.</label>}
        <textarea value={draft.review_notes} onChange={event => set({ review_notes: event.target.value })} placeholder="Reviewer notes" className="mt-4 min-h-20 w-full rounded-lg border border-border-default bg-bg-secondary p-3 text-sm text-text-primary" />
        <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled aria-disabled="true" title="Publication is held until all shared validation gates pass" className="inline-flex items-center gap-2 rounded-lg bg-gold-primary px-4 py-2 text-xs font-bold text-black opacity-45"><CheckCircle2 size={15} /> Approval held for validation</button><button type="button" disabled={busy === item.id} onClick={() => void decide(item, 'REJECT')} className="inline-flex items-center gap-2 rounded-lg border border-red-400/40 px-4 py-2 text-xs font-bold text-red-300 disabled:opacity-50"><XCircle size={15} /> Reject</button></div>
      </article>;
    })}
  </section>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs text-text-muted"><span className="mb-1 block">{label}</span><input value={value} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-border-default bg-bg-secondary px-3 text-sm text-text-primary" /></label>;
}
