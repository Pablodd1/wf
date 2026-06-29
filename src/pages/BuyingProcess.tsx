/**
 * Buying Process Page
 */
import { Link } from 'react-router-dom';
import { LightNavbar, SimpleFooter } from '@/components/PageShell';

export default function BuyingProcess() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-20 px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-light mb-4">Buying Process</h1>
          <p className="text-xl text-white/80">How to Purchase Through WatchFacts</p>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-16 space-y-12">
          {[
            { step: '01', title: 'Search & Discover', desc: 'Browse 125,000+ fresh listings from 11,000+ pre-vetted global dealers. Use our advanced search filters to find the exact timepiece you want by brand, reference, dial color, condition, and price range.' },
            { step: '02', title: 'Verify & Inspect', desc: 'Every listing includes detailed condition reports, high-resolution images, and dealer ratings. Our blockchain-certified digital passport provides verified provenance and authenticity documentation.' },
            { step: '03', title: 'Connect with Dealer', desc: 'Contact the dealer directly through our secure messaging system. All dealers are peer-rated and pre-vetted. Check availability, negotiate terms, and arrange payment securely.' },
            { step: '04', title: 'Secure Transaction', desc: 'Complete your purchase with confidence. Our escrow service protects both buyers and sellers. Funds are released only after inspection and authentication are completed.' },
            { step: '05', title: 'Receive & Authenticate', desc: 'Your watch arrives with a WatchFacts certification report. Each piece undergoes expert inspection including condition assessment, authenticity verification, and market valuation.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-6">
              <div className="text-5xl font-light text-[#3B5BFE]/30 shrink-0">{step}</div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
                <p className="text-gray-600 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
      <SimpleFooter />
    </div>
  );
}
