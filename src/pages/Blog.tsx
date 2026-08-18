import { ArrowRight, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { MarketNav } from '../components/MarketNav';

const sources = [
  ['Patek Philippe: how cases are made', 'https://www.patek.com/en/manufacture/quality-and-fine-workmanship/cases'],
  ['Patek Philippe: hand finishing', 'https://www.patek.com/en/manufacture/artisans-of-time/hand-finishing'],
  ['Foundation Haute Horlogerie: watches that made history', 'https://www.hautehorlogerie.org/en/watches-and-culture/library/10-watches-that-have-made-history'],
  ['British Museum: Peter Henlein', 'https://www.britishmuseum.org/collection/term/AUTH237501'],
  ['Breguet: the first known wristwatch', 'https://www.breguet.com/en/breguet-house/1801-1823/order-first-watch-designed-be-worn-wrist'],
  ['Christie’s: the Grandmaster Chime auction record', 'https://www.christies.com/en/stories/luc-pettavino-founder-of-only-watch-ca7f2d7c73d2484e9709ef9f4466bf30'],
  ['Patek Philippe: Grandmaster Chime', 'https://www.patek.com/collection/grand-complications/6300gr-001'],
] as const;

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <section className="border-t border-[#ded8cd] py-10 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a7127]">{eyebrow}</p>
    <h2 className="mt-3 max-w-3xl font-serif text-3xl leading-tight text-[#171717] sm:text-4xl">{title}</h2>
    <div className="mt-6 max-w-4xl space-y-5 text-[15px] leading-8 text-[#554d43]">{children}</div>
  </section>;
}

export default function Blog() {
  return <main className="min-h-screen bg-[#f3ecdf] text-[#171717]">
    <MarketNav />
    <header className="border-b border-[#ded8cd] bg-[#fbf7ef]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9a7127]">Curated Luxury Journal · Horology</p>
        <h1 className="mt-4 max-w-4xl font-serif text-5xl leading-[1.03] sm:text-7xl">Inside the mechanical watch</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#665c4f]">How hundreds of components turn stored energy into measured time, where portable watches began, and why one Patek Philippe reached CHF 31 million.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/price-research" className="inline-flex min-h-11 items-center gap-2 bg-[#9a7127] px-5 text-sm font-semibold text-white">Research a reference <ArrowRight size={15} /></Link>
          <Link to="/trading" className="inline-flex min-h-11 items-center gap-2 border border-[#9a7127] px-5 text-sm font-semibold text-[#7b5719]">Explore the Trading Floor</Link>
        </div>
      </div>
    </header>
    <article className="mx-auto max-w-6xl px-5">
      <Section eyebrow="Making time" title="How a mechanical watch is made">
        <p>A fine mechanical watch begins as an engineering system, not as a case and dial. Designers define the movement architecture, energy reserve, frequency, functions, tolerances and serviceability. Engineers model the gear train and prototype the mechanisms before production drawings and tooling are released.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ['1 · The movement', 'A mainplate supports bridges, wheels and pinions. The barrel stores energy in its mainspring; the going train transmits it; the escapement releases it in controlled impulses; and the balance with its hairspring establishes the oscillating rate. Synthetic ruby jewels reduce friction at critical pivots.'],
            ['2 · Manufacturing', 'Brass, steel and precious-metal parts are cut, stamped, turned and milled to tight tolerances. Teeth, pinions, screw threads and jewel seats must align closely enough that minute errors do not multiply across the train.'],
            ['3 · Finishing', 'Components are deburred, straight-grained, circular-grained, polished or beveled. Finishing is visual, but it also removes machining residue, protects surfaces and prevents microscopic interference. Some work requires binocular microscopes.'],
            ['4 · Dial and exterior', 'Dials may be lacquered, galvanized, enamelled, engraved or gem-set. A case begins as a metal blank, then undergoes repeated stamping, machining, hand preparation and polishing. Patek says one case can involve nearly 20 specialists and about 50 operations.'],
            ['5 · Assembly and regulation', 'A watchmaker cleans and assembles the movement, applies minute amounts of specific lubricants, checks engagement, installs the dial and hands, and regulates the balance in several positions. Complicated movements require further functional adjustment.'],
            ['6 · Casing and tests', 'The movement is cased, the crown and seals are fitted, and the complete watch is tested for rate, amplitude, power reserve and every stated function. Water-resistant pieces also undergo pressure testing before final inspection.'],
          ].map(([heading, copy]) => <div key={heading} className="border border-[#ded8cd] bg-[#fbf7ef] p-5"><h3 className="font-semibold text-[#211b15]">{heading}</h3><p className="mt-2 text-sm leading-7">{copy}</p></div>)}
        </div>
        <p>The result is a controlled energy chain: the wearer or rotor winds the mainspring; the barrel releases torque; gears divide that motion; the escapement meters it; the balance supplies the rhythm; and the motion works translate those ratios into hours, minutes, seconds and complications.</p>
      </Section>
      <Section eyebrow="Origins" title="What was the first watch? The answer depends on the definition">
        <p>There is no single uncontested “first watch.” Portable spring-driven timekeepers emerged in Europe around the turn of the sixteenth century, and surviving evidence is incomplete. The British Museum identifies Nuremberg craftsman Peter Henlein as the first man known to have made a watch, around 1510. Early portable pieces were bulky, commonly displayed only the hour, and were far less precise than modern watches.</p>
        <p>A major precision advance followed the balance spring in the late seventeenth century. The Foundation Haute Horlogerie explains that retrofitting it could reduce typical daily variation from roughly half an hour toward about a minute, helping transform the portable watch from a mechanical curiosity into a more credible timekeeper.</p>
        <p>The first documented watch designed specifically for the wrist came later. Breguet records an order placed on 8 June 1810 for Caroline Murat, Queen of Naples. Watch No. 2639 was an ultra-thin oval repeating watch mounted on a wristlet of hair and gold thread, delivered in 1812.</p>
      </Section>
      <Section eyebrow="Auction record" title="The most expensive watch sold at auction—and why it reached CHF 31 million">
        <p>As of August 2026, the auction record remains the unique stainless-steel Patek Philippe Grandmaster Chime Ref. 6300A-010, sold by Christie’s at Only Watch in Geneva on 9 November 2019 for CHF 31,000,000. The result was a charity-auction price, not a conventional retail valuation.</p>
        <p>Its value combined several forces: a unique execution for Only Watch; exceptionally rare steel for a Patek Philippe grand complication; a reversible double-sided case; and 20 complications, including five acoustic functions, grande and petite sonnerie, minute repeater, an alarm that strikes its programmed time, and a date repeater. Patek describes the alarm and date repeater as patented world exclusives.</p>
        <p>Only Watch raises funds for Duchenne muscular dystrophy research, creating an emotional and philanthropic bidding context. Rarity, technical complexity, manufacture prestige, one-off specification, documented provenance and charity competition converged in one lot. CHF 31 million is therefore a historic market event—not a general price guide for other examples.</p>
      </Section>
      <Section eyebrow="Reading the market" title="Why reference, dial, condition and evidence matter">
        <p>Two watches with the same family name can differ materially in reference, metal, dial, year, condition and completeness. Curated Luxury Price Research separates WTS asking-price evidence from WTB demand, identifies exact reference and dial cohorts, removes same-seller repost duplication, and marks statistical outliers.</p>
        <p>Historical charts describe dated observations. Three-month outlook dots are estimates: validated only when the time series passes the release tests, otherwise presented as an indicative median baseline with an uncertainty band. Neither is an appraisal, a guaranteed transaction price or investment advice.</p>
      </Section>
      <section className="border-t border-[#ded8cd] py-10 sm:py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a7127]">Primary and specialist sources</p>
        <h2 className="mt-3 font-serif text-3xl">Continue reading</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">{sources.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noreferrer" className="flex min-h-16 items-center justify-between gap-4 border border-[#ded8cd] bg-[#fbf7ef] px-4 py-3 text-sm font-semibold text-[#554d43] hover:border-[#9a7127]"><span>{label}</span><ExternalLink size={15} className="shrink-0 text-[#9a7127]" /></a>)}</div>
        <p className="mt-6 text-xs leading-6 text-[#776d60]">Published 12 August 2026. Historical claims distinguish documented evidence from debated attribution. Auction records can change; the cited result is current as of publication.</p>
      </section>
    </article>
    <Footer />
  </main>;
}
