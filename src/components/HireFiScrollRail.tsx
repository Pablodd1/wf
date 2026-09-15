import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { LUXFI_URL } from '@/components/MarketHeader';

export function HireFiScrollRail() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 130,
    damping: 24,
    mass: 0.28,
  });
  const railOffset = useTransform(smoothProgress, [0, 1], [-14, 14]);

  return (
    <aside
      className="pointer-events-none fixed right-0 top-1/2 z-[60] -translate-y-1/2"
      style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 60 }}
      aria-label="Hire Fi"
    >
      <motion.a
        href={LUXFI_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Hire Fi — let Fi search the world"
        title="Let Fi search the world"
        style={reduceMotion ? undefined : { y: railOffset }}
        className="group pointer-events-auto relative flex min-h-64 w-16 items-center justify-center overflow-hidden rounded-l-2xl border-2 border-r-0 border-[#d4b87a]/60 bg-[#09090a]/95 p-4 text-white shadow-[-8px_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition-all duration-300 hover:w-20 hover:border-[#d4b87a] hover:bg-[#111113] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4b87a] sm:min-h-96 sm:w-20"
      >
        <span className="[writing-mode:vertical-rl] rotate-180 text-base font-bold uppercase tracking-[0.2em] text-[#d4b87a] transition-colors group-hover:text-white sm:text-lg">
          LET FI SEARCH THE WORLD
        </span>
      </motion.a>
    </aside>
  );
}
