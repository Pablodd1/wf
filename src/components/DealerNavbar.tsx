/**
 * Dealer Navbar — Glassmorphism luxury design for watch connoisseurs
 * Dark mode primary with gold accents. White logo variant for dark backgrounds.
 */
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, Watch, TrendingUp, Shield, ExternalLink } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

const NAV_ITEMS = [
  { label: 'Trading', path: '/trading', icon: Watch },
  { label: 'Price Research', path: '/price-research', icon: TrendingUp },
  { label: 'Reference Check', path: '/reference-check', icon: Shield },
  { label: 'Hire Fi', path: 'https://watchfacts.com/lux-fi', external: true, icon: ExternalLink },
];

export function DealerNavbar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const isActive = (path: string) => location.pathname === path;

  return (
    <motion.header
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="sticky top-0 z-50 h-[60px] glass-nav flex items-center justify-between px-4 md:px-8"
    >
      {/* Logo — White variant for dark background */}
      <Link to="/trading" className="flex items-center shrink-0 group">
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="relative"
        >
          <img
            src="/watchfacts-logo-white.png"
            alt="WatchFacts"
            className="h-[30px] w-auto object-contain transition-opacity duration-300 group-hover:opacity-90"
          />
          <div className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#D4AF37]/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        </motion.div>
      </Link>

      {/* Navigation */}
      <nav className="hidden md:flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          const baseClasses = "relative flex items-center gap-2 px-4 py-2 text-[12px] font-medium rounded-full transition-all duration-300 tracking-[0.04em]";
          const activeClasses = "text-[#0A0A0F] bg-gradient-to-r from-[#D4AF37] to-[#E5C158] shadow-lg shadow-[#D4AF37]/20";
          const inactiveClasses = "text-white/70 hover:text-white hover:bg-white/5";

          if (item.external) {
            return (
              <a
                key={item.label}
                href={item.path}
                target="_blank"
                rel="noopener noreferrer"
                className={`${baseClasses} ${inactiveClasses}`}
              >
                <Icon size={13} />
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
              <Icon size={13} className={active ? 'text-[#0A0A0F]' : ''} />
              {item.label}
              {active && (
                <motion.div
                  layoutId="dealerActiveTab"
                  className="absolute -bottom-1 left-3 right-3 h-0.5 bg-[#D4AF37] rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <ThemeToggle className="mr-1" />
        {user && (
          <div className="flex items-center gap-4">
            <span className="hidden md:block text-[11px] text-white/40 font-medium tracking-wide">
              {user.name || user.email}
            </span>
            <div className="w-px h-4 bg-white/10 hidden md:block" />
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => logout()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-white/50 hover:text-white hover:bg-white/5 rounded-full transition-all duration-200"
              title="Logout"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Logout</span>
            </motion.button>
          </div>
        )}
      </div>
    </motion.header>
  );
}
