import { LightNavbar, SimpleFooter } from '@/components/PageShell';

export default function Terms() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-16 px-6 text-center">
          <h1 className="text-3xl md:text-4xl font-light">Terms of Service</h1>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-12 text-gray-600 leading-relaxed space-y-6">
          <p>Welcome to WatchFacts. By accessing or using our platform, you agree to these Terms of Service.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">1. Platform Use</h2>
          <p>WatchFacts provides a marketplace for luxury watch dealers and collectors. All listings are provided by third-party dealers. WatchFacts acts as an intermediary platform and authentication service provider.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">2. Dealer Verification</h2>
          <p>All dealers on the platform are pre-vetted and peer-rated. WatchFacts reserves the right to remove any dealer that violates platform policies or receives consistent negative feedback.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">3. Authentication</h2>
          <p>WatchFacts provides authentication and certification services. However, final verification responsibility lies with the buyer. We recommend professional third-party authentication for purchases exceeding $50,000.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">4. Transactions</h2>
          <p>WatchFacts offers escrow services for secure transactions. Fees are calculated based on transaction value. All prices are listed in USD unless otherwise specified.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">5. Data Privacy</h2>
          <p>Your data is protected under our Privacy Policy. We use industry-standard encryption and security practices.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">6. Limitation of Liability</h2>
          <p>WatchFacts is not liable for disputes between buyers and sellers. Our maximum liability is limited to the authentication fee paid for the specific transaction.</p>
        </section>
      </main>
      <SimpleFooter />
    </div>
  );
}
