import { ArrowLeft, ArrowRight, Globe2, MessageCircle, PlusCircle, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { COMMUNITY_GROUPS } from '@/components/Footer';
import { CONTACT_WHATSAPP_URL } from '@/contactWhatsApp';
import { LUXFI_URL } from '@/components/MarketHeader';

const portalLinks = [
  {
    title: 'POST IT',
    description: 'Organize photos and seller details once, then send each item through the moderated publication workflow.',
    to: '/dealer/post',
    icon: PlusCircle,
  },
  {
    title: 'Hire FI',
    description: 'Let FI search the world for the watch or luxury item you need.',
    to: LUXFI_URL,
    external: true,
    icon: Globe2,
  },
  {
    title: 'Reference Check',
    description: 'Review verified counterparties, ratings, market activity, and current inventory.',
    to: '/reference-check',
    icon: Users,
  },
  {
    title: 'Dealer Account',
    description: 'Manage your profile, listings, settings, billing status, and support tickets.',
    to: '/dealer/account/profile',
    icon: ShieldCheck,
  },
];

export default function DealerPortal() {
  return (
    <main className="min-h-screen bg-[#08080c] px-5 py-7 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link to="/trading" className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white">
            <ArrowLeft size={16} /> Curated Luxury
          </Link>
          <nav aria-label="Workspace navigation" className="flex items-center gap-2">
            <Link to="/trading" className="border border-[#c9a96e]/60 px-3 py-2 text-xs font-semibold text-[#e3c98e] transition-colors hover:bg-[#c9a96e] hover:text-black">Trading Floor</Link>
            <Link to="/dealer/account/profile" className="border border-white/15 px-3 py-2 text-xs font-semibold text-white/65 transition-colors hover:border-white/40 hover:text-white">Dealer Account</Link>
          </nav>
        </header>

        <section className="grid gap-4 py-10 md:grid-cols-2" aria-label="Workspace tools">
          {portalLinks.map(({ title, description, to, external, icon: Icon }) => {
            const content = <>
              <div>
                <div className="flex h-10 w-10 items-center justify-center border border-white/15 text-[#c9a96e]"><Icon size={19} /></div>
                <h2 className="mt-7 text-2xl font-semibold">{title}</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/52">{description}</p>
              </div>
              <span className="mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#c9a96e]">Open <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></span>
            </>;
            const className = "group flex min-h-56 flex-col justify-between border border-white/12 bg-[#111118] p-6 transition-colors hover:border-[#c9a96e]/55 sm:p-7";
            return external
              ? <a key={to} href={to} target="_blank" rel="noreferrer" className={className}>{content}</a>
              : <Link key={to} to={to} className={className}>{content}</Link>;
          })}

        </section>

        <section className="border-t border-white/10 py-10" aria-labelledby="community-heading">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex h-10 w-10 items-center justify-center border border-white/15 text-[#c9a96e]"><MessageCircle size={19} /></div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Community and contact</p>
              <h2 id="community-heading" className="mt-2 font-serif text-3xl">Curated Luxury trading groups</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">Contact Curated Luxury or open the appropriate official WhatsApp and Telegram community directly.</p>
            </div>
            <a href={CONTACT_WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#c9a96e] px-5 text-sm font-semibold text-[#c9a96e] transition-colors hover:bg-[#c9a96e] hover:text-[#09090d]">
              <Globe2 size={17} /> Contact us on WhatsApp
            </a>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMMUNITY_GROUPS.map(group => (
              <a key={group.href} href={group.href} target="_blank" rel="noreferrer" className="group border border-white/12 bg-[#111118] p-5 transition-colors hover:border-[#c9a96e]/55">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c9a96e]">{group.network}</div>
                <div className="mt-3 text-base font-semibold text-white">{group.name}</div>
                <div className="mt-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-white/45 group-hover:text-[#c9a96e]">Join group <ArrowRight size={14} /></div>
              </a>
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}
