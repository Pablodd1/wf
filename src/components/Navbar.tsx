import { useState, useEffect } from 'react';
import { StatusPill } from './ui/StatusPill';
import { motion } from 'framer-motion';

interface NavbarProps {
  totalProcessed?: number;
  normalizedCount?: number;
  residueCount?: number;
  throughputRate?: number;
  avgLatency?: number;
}

export function Navbar({
  totalProcessed = 0,
  normalizedCount = 0,
  residueCount = 0,
  throughputRate = 142,
  avgLatency = 847,
}: NavbarProps) {
  const [time, setTime] = useState('');
  const [showColon, setShowColon] = useState(true);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setTime(`${h}${showColon ? ':' : ' '}${m}${showColon ? ':' : ' '}${s} UTC`);
      setShowColon((prev) => !prev);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [showColon]);

  const formatNum = (n: number) => n.toLocaleString();

  return (
    <motion.header
      initial={{ y: -56, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] as [number, number, number, number] }}
      className="sticky top-0 z-50 h-14 bg-bg-card border-b border-border-default flex items-center justify-between px-5"
    >
      {/* Left Group */}
      <div className="flex items-center gap-4">
        <span
          className="text-sm font-extrabold uppercase tracking-[0.08em] text-gold-primary"
          style={{ textShadow: '0 0 20px rgba(201, 169, 110, 0.3)' }}
        >
          WF SHOWROOM
        </span>
        <StatusPill />
      </div>

      {/* Center Group */}
      <div className="hidden lg:flex items-center gap-6">
        <span className="text-[13px] font-medium text-text-secondary font-mono tracking-wide w-[140px] text-center">
          {time}
        </span>
        <div className="flex items-center gap-1 text-[11px] font-mono">
          <span className="text-muted uppercase tracking-wider mr-1">TOTAL</span>
          <motion.span
            key={totalProcessed}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 100, damping: 15 }}
            className="font-bold text-text-primary"
          >
            {formatNum(totalProcessed)}
          </motion.span>
          <span className="text-muted mx-1">/</span>
          <span className="text-muted uppercase tracking-wider mr-1">NORM</span>
          <motion.span
            key={normalizedCount}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 100, damping: 15 }}
            className="font-bold text-success"
          >
            {formatNum(normalizedCount)}
          </motion.span>
          <span className="text-muted mx-1">/</span>
          <span className="text-muted uppercase tracking-wider mr-1">RES</span>
          <motion.span
            key={residueCount}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 100, damping: 15 }}
            className="font-bold text-danger"
          >
            {formatNum(residueCount)}
          </motion.span>
        </div>
      </div>

      {/* Right Group */}
      <div className="hidden md:flex items-center gap-5">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9A96E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted uppercase tracking-wider leading-none">THROUGHPUT</span>
            <span className="text-[11px] font-semibold text-text-primary font-mono leading-none mt-0.5">
              {throughputRate} rec/min
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9A96E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted uppercase tracking-wider leading-none">AVG LATENCY</span>
            <span className="text-[11px] font-semibold text-text-primary font-mono leading-none mt-0.5">
              {avgLatency} ms
            </span>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
