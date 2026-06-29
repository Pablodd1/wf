import { LightNavbar, SimpleFooter } from '@/components/PageShell';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-16 px-6 text-center">
          <h1 className="text-3xl md:text-4xl font-light">Privacy Policy</h1>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-12 text-gray-600 leading-relaxed space-y-6">
          <p>WatchFacts is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your information.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">1. Information We Collect</h2>
          <p>We collect information you provide directly (name, email, phone), transaction data, and usage analytics. For dealers, we collect business verification documents and peer ratings.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">2. How We Use Your Data</h2>
          <p>Your data is used to provide platform services, process transactions, verify identities, and improve user experience. We never sell your personal information to third parties.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">3. Blockchain Certification</h2>
          <p>WatchFacts uses blockchain technology to create immutable certification records. These records contain watch specifications and transaction history, not personal identification data.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">4. Data Security</h2>
          <p>We implement industry-standard security measures including SSL encryption, secure data storage, and regular security audits. All payment processing is handled by PCI-compliant providers.</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-8">5. Your Rights</h2>
          <p>You have the right to access, correct, or delete your personal data. Contact us at corp@watchfacts.com for data-related requests.</p>
        </section>
      </main>
      <SimpleFooter />
    </div>
  );
}
