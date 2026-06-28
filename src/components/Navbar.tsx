import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { StatusPill } from './ui/StatusPill';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Search, BarChart3, ClipboardCheck,
  Settings, Sparkles, TrendingUp, Zap, AlertTriangle, Shield
} from 'lucide-react';

/* ─── Navigation items ─────────────────────────────────────────────────── */
const NAV_ITEMS = [
  { label: 'Home', path: '/', icon: LayoutDashboard },
  { label: 'Price Research', path: '/price-research', icon: TrendingUp },
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Demo', path: '/demo', icon: Zap },
  { label: 'Review', path: '/review', icon: ClipboardCheck },
  { label: 'Analytics', path: '/analytics', icon: BarChart3 },
  { label: 'Admin', path: '/admin', icon: Shield },
  { label: 'Clean', path: '/clean', icon: Sparkles },
  { label: 'Demand', path: '/demand', icon: AlertTriangle },
] as const;

/* ─── Component ────────────────────────────────────────────────────────── */
interface NavbarProps {
  totalProcessed?: number;
  normalizedCount?: number;
  residueCount?: number;
  throughputRate?: number;
  avgLatency?: number;
}

export function Navbar({
  totalProcessed = 2390143,
  normalizedCount = 1838921,
  residueCount = 551222,
  throughputRate = 142,
  avgLatency = 847,
}: NavbarProps) {
  const location = useLocation();
  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      setTime(`${h}:${m} UTC`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <>
      {/* ── Top Stats Bar ──────────────────────────────────────────── */}
      <motion.header
        initial={{ y: -56, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] as [number, number, number, number] }}
        className="sticky top-0 z-50 h-14 bg-[#111118] border-b border-[#1E1E2E] flex items-center justify-between px-4"
      >
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm font-extrabold uppercase tracking-[0.08em] text-[#C9A96E] hover:text-[#D4B87A] transition-colors"
            style={{ textShadow: '0 0 20px rgba(201, 169, 110, 0.3)' }}>
            WATCHFACTS
          </Link>
          <StatusPill />
        </div>

        {/* Center: Live Stats */}
        <div className="hidden lg:flex items-center gap-5">
          <span className="text-[11px] font-mono text-gray-500">{time}</span>
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <span className="text-gray-500 uppercase mr-1">TOTAL</span>
            <span className="font-bold text-white">{(totalProcessed).toLocaleString()}</span>
            <span className="text-gray-600 mx-1">|</span>
            <span className="text-gray-500 uppercase mr-1">NORM</span>
            <span className="font-bold text-green-400">{(normalizedCount).toLocaleString()}</span>
            <span className="text-gray-600 mx-1">|</span>
            <span className="text-gray-500 uppercase mr-1">RES</span>
            <span className="font-bold text-red-400">{(residueCount).toLocaleString()}</span>
          </div>
        </div>

        {/* Right: Throughput */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">THROUGHPUT</span>
            <span className="text-[10px] font-semibold text-white font-mono">{throughputRate} rec/min</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">LATENCY</span>
            <span className="text-[10px] font-semibold text-white font-mono">{avgLatency} ms</span>
          </div>
        </div>
      </motion.header>

      {/* ── Navigation Tab Bar ─────────────────────────────────────── */}
      <nav className="sticky top-14 z-40 h-10 bg-[#0A0A0F] border-b border-[#1E1E2E] flex items-center px-4 gap-1 overflow-x-auto hide-scrollbar">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const active = isActive(path);
          return (
            <Link
              key={path}
              to={path}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium
                transition-all duration-200 whitespace-nowrap
                ${active
                  ? 'bg-[#C9A96E]/15 text-[#C9A96E] border border-[#C9A96E]/30'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1A1A24] border border-transparent'
                }
              `}
            >
              <Icon size={12} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
