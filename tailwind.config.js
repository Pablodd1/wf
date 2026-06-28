/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // WatchFacts Theme — matching watchfacts.com
        wf: {
          black: '#0A0A0F',
          dark: '#111118',
          card: '#1A1A24',
          input: '#16161F',
          gold: '#D4AF37',
          'gold-light': '#E5C158',
          'gold-dim': '#8B6914',
          border: '#1E1E2E',
          'border-hover': '#2A2A3E',
          text: '#FFFFFF',
          'text-secondary': '#9CA3AF',
          'text-muted': '#6B7280',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'hero': "linear-gradient(to bottom, rgba(10,10,15,0.3), rgba(10,10,15,0.95)), url('https://images.unsplash.com/photo-1547996663-b8308d6e161c?auto=format&fit=crop&w=2000')",
      },
    },
  },
  plugins: [],
};
