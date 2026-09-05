import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MarketHeader } from './MarketHeader';
import { MarketTickerBanner } from './MarketTickerBanner';

export function MarketNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [role, setRole] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(result => setRole(String(result?.user?.role || '')))
      .catch(error => { if (error?.name !== 'AbortError') setRole(''); });
    return () => controller.abort();
  }, []);

  const links = role === 'admin' ? [{ to: '/admin', label: 'Admin Panel' }] : [];

  return (
    <div className="bg-[#f3ecdf] text-[#211b15]">
      <MarketTickerBanner />
      <MarketHeader compact />
      <nav className="border-b border-[#3f3324]/15" aria-label="Dealer navigation">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 overflow-x-auto px-4 py-2 text-xs sm:gap-6 sm:px-6 lg:px-8 xl:px-10">
          <div>
            {location.pathname !== '/trading' && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 rounded border border-[#3f3324]/15 bg-white/30 px-3 py-1 text-xs font-medium text-[#735c32] transition-colors hover:bg-white/70 hover:text-[#211b15]"
                aria-label="Go Back"
              >
                <ArrowLeft size={14} /> Go Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {links.map(link => {
              const active = location.pathname.startsWith(link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  aria-current={active ? 'page' : undefined}
                  className="shrink-0 border-b py-1.5 transition-colors"
                  style={{ borderColor: active ? '#9a7127' : 'transparent', color: active ? '#735c32' : '#675b4d' }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
