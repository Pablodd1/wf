import { ArrowLeft, CheckCircle2, ExternalLink, Send, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const CATEGORIES = [
  ['WATCH', 'Watch'], ['HANDBAG', 'Handbag'], ['JEWELRY', 'Jewelry'],
  ['ACCESSORY', 'Other accessory'], ['OTHER', 'Other luxury item'],
] as const;
const CURRENCIES = ['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD', 'USDT'];
const LUXURY_APP_URL = 'https://luxuryapp-wf.vercel.app/';

interface Submission {
  id: string;
  intent: 'WTS' | 'WTB';
  category: string;
  claimed_fields: { brand?: string; model?: string; reference?: string; title?: string };
  review_status: string;
  created_at: string;
}

export default function DealerSubmitListing() {
  const [postingMode, setPostingMode] = useState<'watchfacts' | 'luxury-app'>('watchfacts');
  const [intent, setIntent] = useState<'WTS' | 'WTB'>('WTS');
  const [category, setCategory] = useState('WATCH');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/dealer-submissions', { credentials: 'include' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load submissions')))
      .then(payload => setSubmissions(payload.submissions || []))
      .catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true); setError(''); setMessage('');
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch('/api/dealer-submissions', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, intent, category }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit listing.');
      setMessage('Saved for review. It is not public until WatchFacts verifies the evidence.');
      formElement.reset();
      setSubmissions(current => [{ id: result.submission.id, intent, category, claimed_fields: {}, review_status: result.submission.review_status, created_at: result.submission.created_at }, ...current]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit listing.');
    } finally { setSaving(false); }
  }

  const isWatch = category === 'WATCH';
  return (
    <main className="min-h-screen bg-[#08080c] px-5 py-7 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link to="/dealer" className="flex items-center gap-2 text-sm text-white/60 hover:text-white"><ArrowLeft size={16} /> Dealer workspace</Link>
          <span className="flex items-center gap-2 text-xs text-[#c9a96e]"><ShieldCheck size={15} /> Credential required</span>
        </header>

        <nav aria-label="Posting applications" className="mt-7 grid grid-cols-2 gap-2 border-b border-white/10 pb-4 sm:flex">
          <button
            type="button"
            onClick={() => setPostingMode('watchfacts')}
            aria-pressed={postingMode === 'watchfacts'}
            className={`h-11 border px-5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${postingMode === 'watchfacts' ? 'border-[#c9a96e] bg-[#c9a96e] text-[#09090d]' : 'border-white/15 text-white/65 hover:border-white/35 hover:text-white'}`}
          >
            WatchFacts form
          </button>
          <button
            type="button"
            onClick={() => setPostingMode('luxury-app')}
            aria-pressed={postingMode === 'luxury-app'}
            className={`h-11 border px-5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${postingMode === 'luxury-app' ? 'border-[#c9a96e] bg-[#c9a96e] text-[#09090d]' : 'border-white/15 text-white/65 hover:border-white/35 hover:text-white'}`}
          >
            Luxury App
          </button>
        </nav>

        {postingMode === 'watchfacts' ? (
          <section className="grid gap-10 py-9 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Moderated submission</p>
            <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Post an offer or request.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/55">Enter the original message exactly as written. Claimed fields help reviewers; they never replace the preserved source evidence.</p>

            <form onSubmit={submit} className="mt-8 space-y-6">
              <fieldset>
                <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/45">I want to</legend>
                <div className="grid grid-cols-2 gap-2">
                  <Choice active={intent === 'WTS'} onClick={() => setIntent('WTS')}>Sell / offer</Choice>
                  <Choice active={intent === 'WTB'} onClick={() => setIntent('WTB')}>Buy / looking for</Choice>
                </div>
              </fieldset>

              <label className="block text-xs text-white/60">Category
                <select name="category" value={category} onChange={event => setCategory(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white">
                  {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="brand" label="Brand" required={isWatch} />
                <Field name="model" label="Model" required={isWatch} />
                <Field name="reference" label="Reference" required={isWatch} />
                <Field name="dial_color" label="Dial color" required={isWatch} />
                <Field name="condition" label="Condition" />
                <Field name="location" label="Location" />
              </div>
              {!isWatch && <Field name="title" label="Item title" required />}

              {intent === 'WTS' && (
                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <Field name="price_amount" label="Original asking price" type="number" required={isWatch} />
                  <label className="block text-xs text-white/60">Currency
                    <select name="currency" required={isWatch} defaultValue="USD" className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white">
                      {CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}
                    </select>
                  </label>
                </div>
              )}

              <label className="block text-xs text-white/60">Original listing or request message
                <textarea name="raw_message" required minLength={3} maxLength={10000} rows={7} className="mt-2 w-full resize-y border border-white/15 bg-[#111118] px-3 py-3 text-sm leading-6 text-white outline-none focus:border-[#c9a96e]" />
              </label>
              {error && <p role="alert" className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
              {message && <p role="status" className="flex items-center gap-2 border-l-2 border-emerald-400 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"><CheckCircle2 size={15} /> {message}</p>}
              <button disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 bg-[#c9a96e] text-sm font-semibold text-[#09090d] disabled:opacity-60"><Send size={16} /> {saving ? 'Saving...' : 'Submit for review'}</button>
            </form>
          </div>

          <aside>
            <h2 className="text-lg font-semibold">Your recent submissions</h2>
            <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
              {submissions.length === 0 && <p className="py-5 text-sm text-white/40">No submissions yet.</p>}
              {submissions.map(item => (
                <div key={item.id} className="py-4">
                  <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-[#c9a96e]">{item.intent} / {item.category}</span><span className="text-white/35">{item.review_status.replaceAll('_', ' ')}</span></div>
                  <p className="mt-2 text-sm text-white/70">{[item.claimed_fields.brand, item.claimed_fields.model, item.claimed_fields.reference, item.claimed_fields.title].filter(Boolean).join(' ') || 'Submission received'}</p>
                  <p className="mt-1 text-[11px] text-white/30">{new Date(item.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </aside>
          </section>
        ) : (
          <section className="py-9">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Luxury App</p>
                <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Post an item.</h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/55">Use the connected Luxury App without leaving WatchFacts.</p>
              </div>
              <a href={LUXURY_APP_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 border border-white/20 px-4 text-xs font-semibold text-white/75 transition-colors hover:border-[#c9a96e] hover:text-white">
                Open full page <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
            <iframe
              src={LUXURY_APP_URL}
              title="Luxury App posting experience"
              className="min-h-[820px] w-full border border-white/12 bg-white"
              allow="camera; microphone; clipboard-write"
            />
          </section>
        )}
      </div>
    </main>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`h-11 border text-sm font-semibold ${active ? 'border-[#c9a96e] bg-[#c9a96e] text-[#09090d]' : 'border-white/15 bg-[#111118] text-white/65'}`}>{children}</button>;
}

function Field({ name, label, required = false, type = 'text' }: { name: string; label: string; required?: boolean; type?: string }) {
  return <label className="block text-xs text-white/60">{label}<input name={name} type={type} required={required} min={type === 'number' ? '0.01' : undefined} step={type === 'number' ? 'any' : undefined} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" /></label>;
}
