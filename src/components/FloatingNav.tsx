import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, ArrowUp, ArrowDown, Activity } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export function FloatingNav() {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const goToAnalytics = () => {
    navigate('/analytics');
  };

  const goToDashboard = () => {
    navigate('/dashboard');
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            onClick={scrollToTop}
            className="w-12 h-12 bg-bg-card border border-gold-primary rounded-full flex items-center justify-center shadow-gold hover:bg-bg-elevated transition-colors tap-target"
            title="Scroll to top"
          >
            <ArrowUp size={20} className="text-gold-primary" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Live Activity Indicator */}
      <div className="relative">
        <div className="absolute -top-1 -right-1 w-3 h-3">
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-success" />
        </div>
        <button
          onClick={location.pathname === '/analytics' ? goToDashboard : goToAnalytics}
          className="w-12 h-12 bg-gold-primary rounded-full flex items-center justify-center shadow-gold-strong hover:bg-gold-bright transition-colors tap-target"
          title={location.pathname === '/analytics' ? 'Dashboard' : 'Analytics'}
        >
          {location.pathname === '/analytics' ? (
            <Activity size={20} className="text-black" />
          ) : (
            <BarChart3 size={20} className="text-black" />
          )}
        </button>
      </div>

      {/* Scroll to bottom */}
      <motion.button
        onClick={scrollToBottom}
        className="w-12 h-12 bg-bg-card border border-border-default rounded-full flex items-center justify-center shadow-card hover:bg-bg-elevated transition-colors tap-target"
        title="Scroll to bottom"
      >
        <ArrowDown size={20} className="text-text-muted" />
      </motion.button>
    </div>
  );
}
