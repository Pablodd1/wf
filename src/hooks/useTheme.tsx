/**
 * ThemeContext — 3-mode contrast system for WatchFacts.
 *
 * Modes:
 *   'luxury'   — Dark background, gold accents, glassmorphism (default)
 *   'contrast' — High-contrast light mode for detailed watch inspection
 *   'neutral'  — Balanced gray mode for long-reading admin sessions
 *
 * Persisted in localStorage as 'watchfacts-theme'.
 * Adds data-theme attribute to <html> for CSS targeting.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'luxury' | 'contrast' | 'neutral';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'luxury',
  setMode: () => {},
  cycle: () => {},
  isDark: true,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem('watchfacts-theme');
      if (stored === 'luxury' || stored === 'contrast' || stored === 'neutral') return stored;
    } catch {}
    return 'luxury';
  });

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem('watchfacts-theme', m); } catch {}
  };

  const cycle = () => {
    const order: ThemeMode[] = ['luxury', 'contrast', 'neutral'];
    const idx = order.indexOf(mode);
    setMode(order[(idx + 1) % order.length]);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const isDark = mode !== 'contrast';

  return (
    <ThemeContext.Provider value={{ mode, setMode, cycle, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
