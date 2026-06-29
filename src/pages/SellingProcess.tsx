import { LightNavbar, SimpleFooter } from '@/components/PageShell';

export default function SellingProcess() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-20 px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-light mb-4">Selling Process</h1>
          <p className="text-xl text-white/80">How to Sell Through WatchFacts</p>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-16 space-y-12">
          {[
            { step: '01', title: 'List Your Watch', desc: 'Create a detailed listing with high-resolution photos, complete specifications, and your asking price. Include box, papers, and service history for maximum buyer confidence.' },
            { step: '02', title: 'Get Verified', desc: 'All sellers are peer-rated and verified. Build your reputation through successful transactions. WatchFacts certification adds credibility to your listing.' },
            { step: '03', title: 'Connect with Buyers', desc: 'Your listing reaches 29,000+ global dealers and collectors. Buyers can contact you directly through our secure messaging system.' },
            { step: '04', title: 'Secure Transaction', desc: 'Use WatchFacts escrow service for secure payment. Funds are held until the buyer receives and authenticates the watch.' },
            { step: '05', title: 'Ship with Confidence', desc: 'Ship fully insured with tracking. WatchFacts provides standardized shipping guidelines and insurance recommendations for high-value timepieces.' },
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
