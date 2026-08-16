import { ExternalLink, MessageCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LUXFI_URL, VIRTUAL_AUTHENTICATOR_URL } from './MarketHeader';
import { useLanguage } from '@/i18n/LanguageContext';

export const CONTACT_WHATSAPP_URL = 'https://api.whatsapp.com/send?phone=17869569201&text=Hello,%20I%20would%20like%20more%20information%20about%20your%20services.';
export const CONTACT_EMAIL = 'Aduenas@watchfacts.com';

export const COMMUNITY_GROUPS = [
  { name: 'Curated Luxury | B2B Watch Trading Chat', network: 'WhatsApp', href: 'https://chat.whatsapp.com/JEaK91DatRkLZFKMaJZYIH?mode=gi_t' },
  { name: 'Curated Luxury | Community discussion/announcements', network: 'WhatsApp', href: 'https://chat.whatsapp.com/CHLWqKgzO2Y1sdarNTAcEO?mode=gi_t' },
  { name: 'Curated Luxury | System Calls', network: 'WhatsApp', href: 'https://chat.whatsapp.com/EfL3QcrCVe1F7wKMGjS9WQ' },
  { name: 'Curated Luxury | International Group', network: 'WhatsApp', href: 'https://chat.whatsapp.com/B8qiBT6JZYyGoNg3CAX5Kw?mode=gi_t' },
  { name: 'Curated Luxury | Signed Estate and Branded Jewelry', network: 'WhatsApp', href: 'https://chat.whatsapp.com/DPhtxCrrxES5kyHeO7SmCb?mode=gi_t' },
  { name: 'Curated Luxury (Rolex US Only Sales)', network: 'Telegram', href: 'https://t.me/watchfactsUS' },
] as const;

const MARKET_LINKS = [
  ['Trading Floor', '/trading'],
  ['Price Research', '/price-research'],
  ['Luxury Item Research', '/luxury-research'],
  ['Reference Check', '/reference-check'],
  ['POST IT', '/dealer/post'],
  ['Workspace', '/dealer/workspace'],
  ['Account', '/dealer/account/profile'],
  ['Blog', '/blog'],
] as const;

export const DEALER_GLOSSARY = [
  {
    title: 'Buying & Selling Terms',
    terms: [
      ['WTB', 'Want to Buy'], ['WTS', 'Want to Sell'], ['WTT', 'Want to Trade'],
      ['FS', 'For Sale'], ['OBO', 'Or Best Offer'], ['BIN', 'Buy It Now'], ['PM for Price', 'Price on Request'],
    ],
  },
  {
    title: 'Condition & Packaging',
    terms: [
      ['BNIB', 'Brand New in Box'], ['LNIB', 'Like New in Box'], ['NIB', 'New in Box'],
      ['NOS', 'New Old Stock (Unworn but from an older production batch)'], ['U', 'Used'],
      ['MINT', 'Excellent condition, nearly new'], ['Unpolished', 'Factory-original case, never polished'],
      ['Full Set', 'Watch comes with original box, papers, and accessories'], ['B&P', 'Box and Papers included'],
    ],
  },
  {
    title: 'Pricing & Payment',
    terms: [['PP', 'PayPal'], ['T/T', 'Bank Wire Transfer (Telegraphic Transfer)']],
  },
  {
    title: 'Watch Specifications & Market Terms',
    terms: [
      ['Ref', 'Reference number'], ['DLC', 'Diamond-Like Carbon (Black-coated watches)'],
      ['PVD', 'Physical Vapor Deposition (Coated watches)'],
      ['OEM', 'Original Equipment Manufacturer (Factory-original parts)'],
      ['FRANKEN', 'A watch with mixed, non-matching parts'], ['HYPE', 'High-demand, sought-after model'],
    ],
  },
  {
    title: 'Deal Communication',
    terms: [['DIBS', 'Claiming first right to buy'], ['SPF', 'Sold Pending Funds'], ['LO', 'Low Offer']],
  },
] as const;

export function Footer() {
  const { t } = useLanguage();
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  useEffect(() => {
    if (!glossaryOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setGlossaryOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [glossaryOpen]);
  return (
    <footer className="border-t border-white/10 bg-[#08080c] px-5 py-12 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 border-b border-white/10 pb-10 lg:grid-cols-[0.8fr_1.2fr]">
          <section aria-labelledby="footer-contact-heading">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c9a96e]">{t('Contact')}</p>
            <h2 id="footer-contact-heading" className="mt-3 font-serif text-3xl">{t('Contact Curated Luxury')}</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/52">{t('Questions, partnerships, listing support, or new opportunities.')}</p>
            <a href={CONTACT_WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#25D366] px-5 text-sm font-bold text-[#07130a]">
              <MessageCircle size={17} /> {t('Contact us on WhatsApp')}
            </a>
          </section>

          <section aria-labelledby="footer-groups-heading">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c9a96e]">{t('Community')}</p>
            <h2 id="footer-groups-heading" className="mt-3 font-serif text-3xl">{t('Join Our Chats')}</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">{t('Be part of our vibrant community by joining our WhatsApp and Telegram groups.')}</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {COMMUNITY_GROUPS.map(group => (
                <a key={group.href} href={group.href} target="_blank" rel="noreferrer" className="group flex min-h-20 items-center justify-between gap-4 border border-white/12 bg-[#111118] px-4 py-3 transition-colors hover:border-[#c9a96e]/60">
                  <span><span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#c9a96e]">{group.network}</span><span className="mt-1 block text-sm leading-5 text-white/78">{group.name}</span></span>
                  <ExternalLink size={14} className="shrink-0 text-white/32 group-hover:text-[#c9a96e]" />
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-8 py-9 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-14 w-auto max-w-[230px] object-contain object-left" />
            <p className="mt-3 max-w-sm text-xs leading-5 text-white/38">{t('Curated Luxury marketplace intelligence for exceptional objects.')}</p>
          </div>
          <nav aria-label="Marketplace links" className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-white/55">
            {MARKET_LINKS.map(([label, to]) => <Link key={to} to={to} className="transition-colors hover:text-white">{t(label)}</Link>)}
            <a href={LUXFI_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-white">{t('HIRE FI')} <ExternalLink size={12} /></a>
            <a href={VIRTUAL_AUTHENTICATOR_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-white">VIRTUAL AUTHENTICATOR <ExternalLink size={12} /></a>
          </nav>
          <div className="flex flex-col items-start gap-3 text-sm">
            <Link to="/cl-login" className="text-[#c9a96e] transition-colors hover:text-white">CL Login</Link>
            <button type="button" onClick={() => setGlossaryOpen(true)} className="text-left text-white/50 transition-colors hover:text-white">{t('Glossary')}</button>
            <Link to="/info/company" className="text-white/50 transition-colors hover:text-white">{t('Company')}</Link>
            <Link to="/info/community" className="text-white/50 transition-colors hover:text-white">{t('Community')}</Link>
            <Link to="/privacy" className="text-white/50 transition-colors hover:text-white">{t('Privacy')}</Link>
          </div>
        </div>
        <div className="border-t border-white/10 pt-5 text-center text-[11px] text-white/30">© 2026 Curated Luxury. All Rights Reserved.</div>
      </div>
      {glossaryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => setGlossaryOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="dealer-glossary-title" onMouseDown={event => event.stopPropagation()} className="relative max-h-[88vh] w-full max-w-4xl overflow-y-auto border border-white/15 bg-[#101016] p-6 shadow-2xl sm:p-9">
            <button type="button" aria-label="Close glossary" onClick={() => setGlossaryOpen(false)} className="absolute right-4 top-4 grid h-11 w-11 place-items-center border border-white/15 text-white/60 transition-colors hover:border-[#c9a96e] hover:text-white"><X size={20} /></button>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c9a96e]">Curated Luxury terminology</p>
            <h2 id="dealer-glossary-title" className="mt-3 pr-14 font-serif text-3xl sm:text-4xl">Social Media Watch Dealer Glossary</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-2">
              {DEALER_GLOSSARY.map(section => (
                <section key={section.title} className="border-t border-white/10 pt-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#d4b87a]">{section.title}</h3>
                  <dl className="mt-4 space-y-3">
                    {section.terms.map(([term, meaning]) => (
                      <div key={term} className="grid gap-1 text-sm sm:grid-cols-[110px_1fr] sm:gap-4">
                        <dt className="font-semibold text-white">{term}</dt>
                        <dd className="leading-6 text-white/55">{meaning}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
    </footer>
  );
}
