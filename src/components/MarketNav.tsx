import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MarketHeader } from './MarketHeader';

const PUBLIC_LINKS = [
  { to: '/dealer-login', label: 'Dealer Login' },
];

export function MarketNav() {
  const location = useLocation();
  const [role, setRole] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(result => setRole(String(result?.user?.role || '')))
      .catch(error => { if (error?.name !== 'AbortError') setRole(''); });
    return () => controller.abort();
  }, []);

  const links = [
    ...PUBLIC_LINKS,
    ...(role === 'admin' ? [{ to: '/dashboard', label: 'Dashboard' }] : []),
  ];

  return (
    <div className="bg-[#09090d] text-white">
      <MarketHeader compact />
      {links.length > 0 && (
        <nav className="border-b border-white/10" aria-label="Dealer navigation">
          <div className="mx-auto flex max-w-7xl items-center justify-end gap-4 overflow-x-auto px-4 py-2 text-xs sm:gap-6 sm:px-6 lg:px-8">
            {links.map(link => {
              const active = location.pathname.startsWith(link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  aria-current={active ? 'page' : undefined}
                  className="shrink-0 border-b py-1.5 transition-colors"
                  style={{ borderColor: active ? '#c9a96e' : 'transparent', color: active ? '#d4b87a' : '#a8a8b3' }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
