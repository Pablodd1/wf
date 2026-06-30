/**
 * Dealer Navbar — Light mode, for logged-in dealers
 * Matches watchfacts.com trading floor navbar exactly
 */
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { LogOut } from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Trading', path: '/trading' },
  { label: 'Price Research', path: '/price-research' },
  { label: 'Reference Check', path: '/reference-check' },
  { label: 'Dealer Directory', path: '#' },
  { label: 'Escrow', path: '#' },
  { label: 'Hire Fi', path: 'https://watchfacts.com/lux-fi', external: true },
];

export function DealerNavbar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 h-[56px] bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shadow-sm">
      {/* Logo */}
      <Link to="/trading" className="flex items-center shrink-0">
        <img src="/watchfacts-logo-hd.png" alt="WatchFacts" className="h-[32px] w-auto" />
      </Link>

      {/* Navigation */}
      <nav className="hidden md:flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          const baseClasses = "relative px-3 py-1.5 text-[12px] font-medium rounded-md transition-all duration-200 tracking-[0.02em]";
          const activeClasses = "text-[#3B5BFE] bg-blue-50";
          const inactiveClasses = "text-gray-600 hover:text-gray-900 hover:bg-gray-50 hover:shadow-sm";
          
          if (item.external) {
            return (
              <a
                key={item.label}
                href={item.path}
                target="_blank"
                rel="noopener noreferrer"
                className={`${baseClasses} ${inactiveClasses}`}
              >
                {item.label}
              </a>
            );
          }

          return (
            <Link
              key={item.label}
              to={item.path}
              className={`${baseClasses} ${active ? activeClasses : inactiveClasses}`}
            >
              {item.label}
              {active && (
                <motion.div
                  layoutId="dealerActiveTab"
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#3B5BFE] rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden md:block text-[12px] text-gray-500">
              {user.name || user.email}
            </span>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => logout()}
              className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-md hover:bg-gray-100"
              title="Logout"
            >
              <LogOut size={16} />
            </motion.button>
          </div>
        )}
      </div>
    </header>
  );
}
