import { Link } from 'react-router-dom';
import { ExternalLink, Mail, Phone, MapPin } from 'lucide-react';

const footerLinks = {
  platform: [
    { label: 'Trading Floor', href: 'https://watchfacts.com/wf-home' },
    { label: 'Reports', href: 'https://watchfacts.com/reports' },
    { label: 'Partners', href: 'https://watchfacts.com/partners' },
    { label: 'Hire Fi', href: 'https://watchfacts.com/lux-fi' },
    { label: 'Dealer Login', href: 'https://watchfacts.com/login' },
  ],
  resources: [
    { label: 'Blog', to: '/blog' },
    { label: 'Price Research', to: '/analytics' },
    { label: 'Data Export', to: '/export' },
    { label: 'Health Monitor', to: '/health' },
    { label: 'Settings', to: '/settings' },
  ],
  company: [
    { label: 'WatchFacts.com', href: 'https://watchfacts.com' },
    { label: 'Privacy Policy', href: 'https://watchfacts.com/privacy' },
    { label: 'Terms of Service', href: 'https://watchfacts.com/terms' },
    { label: 'Contact', href: 'mailto:support@watchfacts.com' },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-[#1E1E2E] bg-[#111118] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="flex items-center gap-2 group">
              <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-7 w-auto object-contain group-hover:opacity-90 transition-opacity" />
            </Link>
            <p className="text-xs text-gray-500 leading-relaxed max-w-[240px]">
              Own the Rare. Backed by Blockchain. The world&apos;s most trusted luxury watch trading platform with AI-powered data normalization.
            </p>
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Mail size={12} />
                <span>support@watchfacts.com</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <MapPin size={12} />
                <span>Global HQ</span>
              </div>
            </div>
          </div>

          {/* Platform */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Platform</h3>
            <ul className="space-y-2.5">
              {footerLinks.platform.map(link => (
                <li key={link.label}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors group">
                    <span>{link.label}</span>
                    <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#D4AF37]" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Resources</h3>
            <ul className="space-y-2.5">
              {footerLinks.resources.map(link => (
                <li key={link.label}>
                  <Link to={link.to}
                    className="text-xs text-gray-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-4">Company</h3>
            <ul className="space-y-2.5">
              {footerLinks.company.map(link => (
                <li key={link.label}>
                  {link.href.startsWith('http') || link.href.startsWith('mailto') ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors group">
                      <span>{link.label}</span>
                      <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#D4AF37]" />
                    </a>
                  ) : (
                    <Link to={link.href} className="text-xs text-gray-400 hover:text-white transition-colors">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-[#1E1E2E] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[10px] text-gray-600">
            © 2026 WatchFacts. All rights reserved. Own the Rare. Backed by Blockchain.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-gray-600">2,392,784 listings normalized</span>
            <span className="text-[10px] text-[#D4AF37]">Parser v3.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
