import { ArrowRight, Bot, Check, Search, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { MarketHeader, LUXFI_URL } from '@/components/MarketHeader';
import { MarketActivityTicker } from '@/components/MarketActivityTicker';
import { useLanguage } from '@/i18n/LanguageContext';

const networkStats = [
  ['25,000+', 'Verified dealers'],
  ['750K+', 'Daily listings'],
  ['600+', 'Private channels'],
  ['4m', 'Average match time'],
] as const;

const workflow = [
  {
    number: '01',
    title: 'Post or browse',
    detail: 'List what you are selling or looking for once. Fi matches it against the full dealer network, not only your own channels.',
  },
  {
    number: '02',
    title: 'Fi matches and negotiates',
    detail: 'Fi surfaces verified counterparties, confirms price and condition, and opens the conversation so the back-and-forth is done before you are needed.',
  },
  {
    number: '03',
    title: 'Close with confidence',
    detail: 'Dealer ratings, independent inspection, and escrow-backed payment support a faster and safer close.',
  },
] as const;

const trustPartners = [
  ['LuxFi', 'Continuous network monitoring and negotiation support.', 'Three introductions included with membership'],
  ['Bennisson', 'Independent virtual or in-person inspection before funds move.', 'First inspection included with membership'],
  ['Dealer Ref Check', 'Counterparty verification from source-backed dealer history.', 'Included with every verified match'],
] as const;

export default function LandingPage() {
  const { t } = useLanguage();

  return (
    <main className="min-h-screen bg-[#f3ecdf] text-[#211b15]">
      <MarketActivityTicker />
      <MarketHeader className="sticky top-0" landing />

      <section className="border-b border-[#3f3324]/15 px-5 py-20 text-center sm:px-8 sm:py-28 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-4xl">
          <p className="mx-auto inline-flex rounded-full bg-[#e8dcc4] px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#735c32]">
            {t('For verified dealers and wholesalers')}
          </p>
          <h1 className="mt-7 font-serif text-[clamp(3rem,7vw,6rem)] leading-[0.98] tracking-[-0.035em]">
            {t("The trading floor for the world's dealer network")}
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-[#574b3e] sm:text-lg">
            {t('Organized, source-backed market intelligence and dealer activity in one workspace, with Fi helping you spend less time scrolling and more time closing.')}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/dealer/workspace" className="inline-flex min-h-12 min-w-48 items-center justify-center gap-2 rounded bg-[#211b15] px-6 text-sm font-semibold text-white hover:bg-[#3a3027]">
              {t('Join the network')} <ArrowRight size={16} />
            </Link>
            <Link to="/trading" className="inline-flex min-h-12 min-w-48 items-center justify-center gap-2 rounded border border-[#3f3324]/25 bg-white/25 px-6 text-sm font-semibold hover:bg-white/60">
              {t('See live Trading Floor')} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-2 border-y border-[#3f3324]/15 py-7 md:grid-cols-4">
          {networkStats.map(([value, label], index) => (
            <div key={label} className={`px-3 py-4 ${index % 2 === 0 ? 'border-r' : ''} border-[#3f3324]/15 md:border-r md:last:border-r-0`}>
              <strong className="block font-serif text-3xl font-normal">{value}</strong>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#766857]">{t(label)}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="meet-fi" className="border-b border-[#3f3324]/15 px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="inline-flex rounded-full bg-[#e8dcc4] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#735c32]">{t('Meet Fi')}</p>
            <h2 className="mt-5 max-w-xl font-serif text-4xl leading-tight sm:text-5xl">{t('Your AI agent, negotiating every match')}</h2>
            <p className="mt-6 max-w-xl text-sm leading-7 text-[#625547]">
              {t('Fi reads WTS and WTB activity, cleans up the data, and opens the negotiation on your behalf. You step in once there is a real deal on the table.')}
            </p>
            <ul className="mt-7 space-y-4 text-sm text-[#4f4438]">
              <li><strong>{t('Finds the match')}</strong> — {t('cross-references price, condition, location, and dealer evidence.')}</li>
              <li><strong>{t('Opens the negotiation')}</strong> — {t('confirms interest, price, and terms before you are pulled in.')}</li>
              <li><strong>{t('Closes with support')}</strong> — {t('hands off to inspection and escrow partners when required.')}</li>
            </ul>
            <a href={LUXFI_URL} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-2 border-b border-[#211b15] pb-1 text-sm font-semibold">
              {t('Hire Fi')} <ArrowRight size={15} />
            </a>
          </div>
          <div className="rounded-lg border border-[#3f3324]/15 bg-[#fbf7ef] p-5 shadow-[0_22px_60px_rgba(74,54,29,0.10)] sm:p-7">
            <div className="flex items-center gap-3 border-b border-[#3f3324]/15 pb-4">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#211b15] text-[#d8b36b]"><Bot size={17} /></span>
              <div><strong className="block text-sm">Fi — {t('negotiation agent')}</strong><span className="text-xs text-[#756a5d]">{t('matching now')}</span></div>
            </div>
            <div className="mt-5 space-y-3 text-sm leading-6">
              <p className="mr-12 rounded bg-[#efe3cb] p-4">{t('Found a source-backed match for your requested reference with a verified dealer.')}</p>
              <p className="ml-12 rounded bg-[#211b15] p-4 text-white">{t('Ask whether the seller can close this week.')}</p>
              <p className="mr-12 rounded bg-[#efe3cb] p-4">{t('The seller confirmed condition and supplied price. Contact details are ready.')}</p>
              <p className="flex items-center gap-2 rounded bg-[#e3eee5] p-4 font-mono text-xs"><Check size={14} /> {t('Matched · terms confirmed')}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#3f3324]/15 px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="font-serif text-4xl sm:text-5xl">{t('From chat noise to a closed trade')}</h2>
            <p className="mt-3 text-sm text-[#756a5d]">{t('Three steps, with most of the work done for you')}</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {workflow.map(item => (
              <article key={item.number} className="min-h-56 rounded border border-[#3f3324]/15 bg-[#f8f2e7] p-7">
                <span className="font-mono text-[10px] text-[#a17d38]">{item.number}</span>
                <h3 className="mt-7 font-serif text-2xl">{t(item.title)}</h3>
                <p className="mt-4 text-sm leading-6 text-[#6a5d4e]">{t(item.detail)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <ShieldCheck className="mx-auto text-[#9a7634]" size={28} />
            <h2 className="mt-4 font-serif text-4xl sm:text-5xl">{t('Built on trust, not just volume')}</h2>
            <p className="mt-3 text-sm text-[#756a5d]">{t('Every match runs through independent security and verification partners')}</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {trustPartners.map(([name, detail, offer]) => (
              <article key={name} className="rounded bg-[#211b15] p-7 text-white">
                <h3 className="font-serif text-2xl">{name}</h3>
                <p className="mt-4 min-h-14 text-sm leading-6 text-white/60">{t(detail)}</p>
                <p className="mt-5 rounded bg-[#4a3a24]/70 px-4 py-3 font-mono text-[10px] text-[#e3c98f]">{t(offer)}</p>
              </article>
            ))}
          </div>

          <section id="membership" className="mx-auto mt-20 max-w-xl rounded-lg border border-[#9a7634]/30 bg-[#faf5ec] p-8 text-center shadow-sm sm:p-10">
            <p className="inline-flex rounded-full bg-[#e8dcc4] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#735c32]">{t('Membership')}</p>
            <p className="mt-5 font-serif text-5xl">$150 <span className="text-sm text-[#756a5d]">/{t('month')}</span></p>
            <ul className="mx-auto mt-7 max-w-md space-y-3 text-left text-sm leading-6 text-[#514539]">
              {[
                'Full access to the Trading Floor and dealer network',
                'Fi negotiation support for WTS and WTB activity',
                'Source-backed dealer ratings and Dealer Ref Check',
                'Priority access to inspection and escrow partners',
              ].map(item => <li key={item} className="flex gap-3"><Check size={16} className="mt-1 shrink-0 text-[#6b8d72]" />{t(item)}</li>)}
            </ul>
            <Link to="/dealer/workspace" className="mt-8 inline-flex min-h-12 items-center justify-center rounded bg-[#211b15] px-7 text-sm font-semibold text-white">{t('Start your membership')}</Link>
          </section>
        </div>
      </section>

      <section className="bg-[#211b15] px-5 py-20 text-center text-white sm:px-8">
        <h2 className="font-serif text-4xl sm:text-5xl">{t('Stop scrolling. Start trading.')}</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-white/55">{t('Join the verified dealer network already trading through Curated Luxury.')}</p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/dealer/workspace" className="inline-flex min-h-12 items-center gap-2 rounded bg-[#b98432] px-7 text-sm font-semibold text-white">{t('Join the network')} <ArrowRight size={16} /></Link>
          <Link to="/price-research" className="inline-flex min-h-12 items-center gap-2 rounded border border-white/20 px-7 text-sm font-semibold text-white"><Search size={15} /> {t('Price Research')}</Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
