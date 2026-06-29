/**
 * Pricing / Membership Page
 */
import { Link } from 'react-router-dom';
import { Check, Star, Zap, Shield } from 'lucide-react';
import { LightNavbar, SimpleFooter } from '@/components/PageShell';

const PLANS = [
  {
    name: 'Dealer Basic',
    price: '$49',
    period: '/month',
    description: 'For individual dealers starting out',
    features: ['Up to 50 listings/month', 'Basic search & filters', 'Email support', 'Community access', 'Standard analytics'],
    cta: 'Get Started',
    popular: false,
  },
  {
    name: 'Dealer Pro',
    price: '$99',
    period: '/month',
    description: 'For professional dealers and small shops',
    features: ['Unlimited listings', 'Advanced search & filters', 'Priority support', 'Price research tools', 'Outlier detection', 'AI gap filling', 'Priority listing placement', 'API access'],
    cta: 'Start Pro Trial',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large dealer networks and platforms',
    features: ['Everything in Pro', 'White-label options', 'Dedicated account manager', 'Custom integrations', 'Green API webhook', 'AI Vision matching', 'Bulk operations', 'SLA guarantee'],
    cta: 'Contact Sales',
    popular: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <LightNavbar />
      <main className="pt-[60px]">
        {/* Hero */}
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-20 px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-light mb-4">Membership Plans</h1>
          <p className="text-xl text-white/80 max-w-2xl mx-auto">Join 29,000+ global dealers on the most trusted luxury watch platform</p>
        </section>

        {/* Plans */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="grid md:grid-cols-3 gap-8">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`relative rounded-2xl border ${plan.popular ? 'border-[#3B5BFE] shadow-lg shadow-blue-500/10' : 'border-gray-200'} p-8 flex flex-col`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#3B5BFE] text-white text-xs font-semibold rounded-full flex items-center gap-1">
                    <Star size={12} /> Most Popular
                  </div>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
                <div className="mt-4 mb-6">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-500">{plan.period}</span>
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                      <Check size={16} className="text-green-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button className={`w-full py-3 rounded-lg font-medium transition-colors ${plan.popular ? 'bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white' : 'border border-gray-200 hover:bg-gray-50 text-gray-700'}`}>
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="bg-gray-50 py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-semibold text-gray-900 text-center mb-12">Why Dealers Choose WatchFacts</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { icon: Zap, title: '2.39M+ Listings', desc: 'The largest verified luxury watch database in the world' },
                { icon: Shield, title: 'Blockchain Certified', desc: 'Every watch gets a digital passport proving authenticity' },
                { icon: Star, title: '29K+ Dealers', desc: 'Peer-rated, pre-vetted global dealer network' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="text-center">
                  <Icon size={32} className="mx-auto text-[#3B5BFE] mb-3" />
                  <h3 className="font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SimpleFooter />
    </div>
  );
}
