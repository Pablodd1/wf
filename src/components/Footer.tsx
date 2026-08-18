import { ExternalLink, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LUXFI_URL } from './MarketHeader';

export const CONTACT_WHATSAPP_URL = 'https://api.whatsapp.com/send?phone=17869569201&text=Hello,%20I%20would%20like%20more%20information%20about%20your%20services.';
export const CONTACT_EMAIL = 'support@watchfacts.com';

export const COMMUNITY_GROUPS = [
  { name: 'Curated Luxury | B2B Watch Trading Chat', network: 'WHATSAPP', href: 'https://chat.whatsapp.com/JEaK91DatRkLZFKMaJZYIH?mode=gi_t' },
  { name: 'Curated Luxury | Community discussion/announcements', network: 'WHATSAPP', href: 'https://chat.whatsapp.com/CHLWqKgzO2Y1sdarNTAcEO?mode=gi_t' },
  { name: 'Curated Luxury | System Calls', network: 'WHATSAPP', href: 'https://chat.whatsapp.com/EfL3QcrCVe1F7wKMGjS9WQ' },
  { name: 'Curated Luxury | International Group', network: 'WHATSAPP', href: 'https://chat.whatsapp.com/B8qiBT6JZYyGoNg3CAX5Kw?mode=gi_t' },
  { name: 'Curated Luxury | Signed Estate and Branded Jewelry', network: 'WHATSAPP', href: 'https://chat.whatsapp.com/DPhtxCrrxES5kyHeO7SmCb?mode=gi_t' },
  { name: 'Curated Luxury (Rolex US Only Sales)', network: 'TELEGRAM', href: 'https://t.me/watchfactsUS' },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#08080C] px-5 py-14 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        {/* Top Split: Contact & Community */}
        <div className="grid gap-12 border-b border-white/10 pb-14 lg:grid-cols-[0.75fr_1.25fr]">
          {/* Left: Contact */}
          <section aria-labelledby="footer-contact-heading">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#C9A96E]">CONTACT</p>
            <h2 id="footer-contact-heading" className="mt-3 font-serif text-3xl font-normal sm:text-4xl text-white">
              Contact Curated Luxury
            </h2>
            <p className="mt-3.5 max-w-md text-sm leading-relaxed text-white/60">
              Questions, partnerships, listing support, or new opportunities.
            </p>
            <a
              href={CONTACT_WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-sm bg-[#00D757] px-6 text-sm font-bold text-white transition hover:bg-[#00c34f]"
            >
              <MessageCircle size={17} /> Contact us on WhatsApp
            </a>
          </section>

          {/* Right: Join Our Chats */}
          <section aria-labelledby="footer-groups-heading">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#C9A96E]">COMMUNITY</p>
            <h2 id="footer-groups-heading" className="mt-3 font-serif text-3xl font-normal sm:text-4xl text-white">
              Join Our Chats
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Be part of our vibrant community by joining our WhatsApp and Telegram groups.
            </p>
            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {COMMUNITY_GROUPS.map(group => (
                <a
                  key={group.name}
                  href={group.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex min-h-[72px] items-center justify-between gap-4 border border-white/15 bg-[#0C0C12] p-4 transition-colors hover:border-[#C9A96E]/60"
                >
                  <div>
                    <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#C9A96E]">
                      {group.network}
                    </span>
                    <span className="mt-1 block text-xs font-medium text-white/90 group-hover:text-white">
                      {group.name}
                    </span>
                  </div>
                  <ExternalLink size={14} className="shrink-0 text-white/30 group-hover:text-[#C9A96E]" />
                </a>
              ))}
            </div>
          </section>
        </div>

        {/* Bottom Split: Brand Info & 3 Navigation Columns */}
        <div className="grid gap-10 pt-12 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-10 w-auto max-w-[210px] object-contain object-left" />
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-white/45">
              Curated Luxury marketplace intelligence for exceptional objects.
            </p>
          </div>

          <nav aria-label="Trading & Research" className="flex flex-col gap-2.5 text-xs text-white/60">
            <Link to="/trading" className="transition-colors hover:text-white">Trading Floor</Link>
            <Link to="/price-research" className="transition-colors hover:text-white">Luxury Item Research</Link>
            <Link to="/dealer/post" className="transition-colors hover:text-white">POST IT</Link>
            <Link to="/dealer/account/profile" className="transition-colors hover:text-white">Account</Link>
            <a href={LUXFI_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-white">
              HIRE FI <ExternalLink size={11} />
            </a>
          </nav>

          <nav aria-label="Market Intelligence" className="flex flex-col gap-2.5 text-xs text-white/60">
            <Link to="/price-research" className="transition-colors hover:text-white">Price Research</Link>
            <Link to="/dealers" className="transition-colors hover:text-white">Reference Check</Link>
            <Link to="/dealer/workspace" className="transition-colors hover:text-white">Workspace</Link>
            <Link to="/insight" className="transition-colors hover:text-white">Blog</Link>
            <a href={LUXFI_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-white">
              VIRTUAL AUTHENTICATOR <ExternalLink size={11} />
            </a>
          </nav>

          <nav aria-label="Company & Access" className="flex flex-col gap-2.5 text-xs text-white/60">
            <Link to="/cl-login" className="font-semibold text-[#C9A96E] transition-colors hover:text-white">CL Login</Link>
            <Link to="/info/glossary" className="transition-colors hover:text-white">Glossary</Link>
            <Link to="/info/company" className="transition-colors hover:text-white">Company</Link>
            <Link to="/info/community" className="transition-colors hover:text-white">Community</Link>
            <Link to="/info/privacy" className="transition-colors hover:text-white">Privacy</Link>
          </nav>
        </div>

        <div className="mt-12 text-center text-xs text-white/35">
          © 2026 Curated Luxury. All Rights Reserved.
        </div>
      </div>
    </footer>
  );
}
