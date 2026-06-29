import { useState, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Search, BarChart3, ClipboardCheck,
  Sparkles, TrendingUp, Zap, Shield, CheckCircle
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Home', path: '/', icon: LayoutDashboard },
  { label: 'Price Research', path: '/price-research', icon: TrendingUp },
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Demo', path: '/demo', icon: Zap },
  { label: 'Review', path: '/review', icon: ClipboardCheck },
  { label: 'Analytics', path: '/analytics', icon: BarChart3 },
  { label: 'Admin', path: '/admin', icon: Shield },
  { label: 'Clean', path: '/clean', icon: Sparkles },
] as const;

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [time, setTime] = useState('');
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(`${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} UTC`);
    };
    update();
    const i = setInterval(update, 60000);
    return () => clearInterval(i);
  }, []);

  // Fetch real stats
  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => {});
  }, []);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const total = stats?.totalRecords ?? 2390143;
  const approved = stats?.approvedCount ?? 805872;

  return (
    <>
      {/* ── Top Bar ──────────────────────────────────────────── */}
      <motion.header
        initial={{ y: -56 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.4 }}
        className="sticky top-0 z-50 h-14 bg-[#111118]/95 backdrop-blur-md border-b border-[#1E1E2E] flex items-center justify-between px-6"
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <span className="text-lg font-bold tracking-[0.12em] text-white">
            WATCHFACTS
          </span>
          <CheckCircle size={14} className="text-[#D4AF37] group-hover:scale-110 transition-transform" />
        </Link>

        {/* Center Stats */}
        <div className="hidden lg:flex items-center gap-6">
          <span className="text-[11px] font-mono text-gray-500">{time}</span>
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <span className="text-gray-500 mr-1">TOTAL</span>
            <span className="font-bold text-white">{total.toLocaleString()}</span>
            <span className="text-gray-600 mx-1">|</span>
            <span className="text-[#D4AF37] mr-1">APPROVED</span>
            <span className="font-bold text-[#D4AF37]">{approved.toLocaleString()}</span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-[10px] text-green-400 font-medium uppercase tracking-wider">System Online</span>
          </div>
          <button
            onClick={() => navigate('/trading')}
            className="px-3 py-1.5 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-[11px] font-medium rounded-md transition-colors"
          >
            TRADING FLOOR
          </button>
        </div>
      </motion.header>

      {/* ── Tab Bar ──────────────────────────────────────────── */}
      <nav className="sticky top-14 z-40 h-9 bg-[#0A0A0F]/95 backdrop-blur border-b border-[#1E1E2E] flex items-center px-4 gap-0.5 overflow-x-auto">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const active = isActive(path);
          return (
            <Link
              key={path}
              to={path}
              className={`
                flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium
                transition-all duration-200 whitespace-nowrap
                ${active
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1A1A24]'
                }
              `}
            >
              <Icon size={11} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
