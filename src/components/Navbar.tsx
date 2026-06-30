import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, BarChart3, ClipboardCheck,
  Sparkles, Zap, Shield,
  Activity, FileSpreadsheet, Database,
  Download, ShieldCheck, Target,
  Settings, Upload, BookOpen,
  Menu, X, ChevronRight,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Data', path: '/data', icon: Database },
  { label: 'Demo', path: '/demo', icon: Zap },
  { label: 'Review', path: '/review', icon: ClipboardCheck },
  { label: 'Analytics', path: '/analytics', icon: BarChart3 },
  { label: 'Reports', path: '/reports', icon: FileSpreadsheet },
  { label: 'Health', path: '/health', icon: Activity },
  { label: 'Export', path: '/export', icon: Download },
  { label: 'Quality', path: '/quality', icon: ShieldCheck },
  { label: 'Verify', path: '/verification', icon: Target },
  { label: 'Admin', path: '/admin', icon: Shield },
  { label: 'Clean', path: '/clean', icon: Sparkles },
  { label: 'Import', path: '/import', icon: Upload },
  { label: 'Blog', path: '/blog', icon: BookOpen },
  { label: 'Settings', path: '/settings', icon: Settings },
] as const;

const BOTTOM_BAR_ITEMS = [
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Review', path: '/review', icon: ClipboardCheck },
  { label: 'Trading', path: '/trading', icon: Zap },
  { label: 'Admin', path: '/admin', icon: Shield },
] as const;

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [time, setTime] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(`${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} UTC`);
    };
    update();
    const i = setInterval(update, 60000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
    fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=id&limit=1`, {
      method: 'GET',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count:exact' },
    })
      .then(r => {
        const range = r.headers.get('content-range') || '';
        const total = parseInt(range.split('/')[1] || '0');
        if (total > 0) setStats({ totalRecords: total });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const total = stats?.totalRecords ?? 2390143;
  const approved = stats?.approvedCount ?? 805872;

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setMobileMenuOpen(false);
  }, []);

  return (
    <>
      <motion.header
        initial={{ y: -56 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.4 }}
        className="sticky top-0 z-50 h-14 bg-[#111118]/95 backdrop-blur-md border-b border-[#1E1E2E] flex items-center justify-between px-4 md:px-6"
      >
        <Link to="/" className="flex items-center gap-2 group">
          <div className="h-9 px-2 rounded-lg bg-white/95 flex items-center justify-center shadow-sm border border-[#D4AF37]/20">
            <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-6 w-auto object-contain" />
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <span className="text-[11px] font-mono text-gray-500">{time}</span>
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <span className="text-gray-500 mr-1">TOTAL</span>
            <span className="font-bold text-white price-mono">{total.toLocaleString()}</span>
            <span className="text-gray-600 mx-1">|</span>
            <span className="text-[#D4AF37] mr-1">APPROVED</span>
            <span className="font-bold text-[#D4AF37] price-mono">{approved.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden md:flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-[10px] text-green-400 font-medium uppercase tracking-wider">System Online</span>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/trading')}
            className="hidden sm:block px-3 py-1.5 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-[11px] font-medium rounded-md transition-colors shadow-sm"
          >
            TRADING FLOOR
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-md text-gray-300 hover:text-white hover:bg-[#1A1A24] transition-colors"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </motion.button>
        </div>
      </motion.header>

      <nav className="sticky top-14 z-40 h-9 bg-[#0A0A0F]/95 backdrop-blur border-b border-[#1E1E2E] flex items-center px-4 gap-0.5 overflow-x-auto hide-scrollbar">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const active = isActive(path);
          return (
            <Link key={path} to={path}
              className={`relative flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium transition-all duration-200 whitespace-nowrap min-h-[36px] md:min-h-0 ${
                active ? 'text-[#D4AF37] bg-[#D4AF37]/10' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1A1A24]'
              }`}
            >
              {active && (
                <motion.div layoutId="activeTab" className="absolute bottom-0 left-1 right-1 h-0.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C158] rounded-full" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
              )}
              <Icon size={11} />
              {label}
            </Link>
          );
        })}
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={handleBackdropClick}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm md:hidden">
            <motion.div ref={menuRef} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} onClick={e => e.stopPropagation()}
              className="absolute right-0 top-0 bottom-0 w-[85vw] max-w-[360px] bg-[#0A0A0F]/98 backdrop-blur-lg border-l border-[#1E1E2E] flex flex-col">
              <div className="flex items-center justify-between px-5 h-14 border-b border-[#1E1E2E] flex-shrink-0">
                <span className="text-sm font-semibold text-white tracking-wide">Menu</span>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center w-10 h-10 rounded-md text-gray-300 hover:text-white hover:bg-[#1A1A24] transition-colors" aria-label="Close menu">
                  <X size={22} />
                </motion.button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-mono">{time}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      <span className="text-[10px] text-green-400 font-medium uppercase tracking-wider">System Online</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-[#111118] border border-[#1E1E2E]">
                    <div className="flex-1 text-center">
                      <div className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Total</div>
                      <div className="text-sm font-bold text-white price-mono">{total.toLocaleString()}</div>
                    </div>
                    <div className="w-px h-8 bg-[#1E1E2E]" />
                    <div className="flex-1 text-center">
                      <div className="text-[10px] text-[#D4AF37]/70 font-mono uppercase tracking-wider mb-1">Approved</div>
                      <div className="text-sm font-bold text-[#D4AF37] price-mono">{approved.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => { setMobileMenuOpen(false); navigate('/trading'); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
                  <Zap size={16} /> TRADING FLOOR
                </motion.button>
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500 font-mono uppercase tracking-wider px-1 mb-2">Navigation</div>
                  {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
                    const active = isActive(path);
                    return (
                      <Link key={path} to={path} onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-all duration-200 min-h-[48px] ${
                          active ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-gray-300 hover:text-white hover:bg-[#1A1A24]'
                        }`}>
                        <Icon size={18} />
                        <span className="flex-1">{label}</span>
                        <ChevronRight size={14} className="text-gray-600" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#111118]/95 backdrop-blur-md border-t border-[#1E1E2E] h-16 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-full px-2">
          {BOTTOM_BAR_ITEMS.map(({ label, path, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Link key={path} to={path}
                className={`flex flex-col items-center justify-center gap-0.5 w-16 h-full rounded-lg transition-all duration-200 active:scale-90 ${active ? 'text-[#D4AF37]' : 'text-gray-500 hover:text-gray-300'}`}>
                <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
                <span className="text-[10px] font-medium">{label}</span>
                {active && <motion.div layoutId="bottomIndicator" className="absolute bottom-1 w-6 h-0.5 bg-[#D4AF37] rounded-full" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
