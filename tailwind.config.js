/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // WatchFacts Theme — luxury watch platform
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
        // Verdict colors (for condition badges, status pills)
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Playfair Display', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'hero': "linear-gradient(to bottom, rgba(10,10,15,0.3), rgba(10,10,15,0.95)), url('https://images.unsplash.com/photo-1547996663-b8308d6e161c?auto=format&fit=crop&w=2000')",
        'gold-gradient': 'linear-gradient(135deg, #D4AF37 0%, #E5C158 50%, #8B6914 100%)',
        'gold-shimmer': 'linear-gradient(90deg, transparent 0%, rgba(212,175,55,0.15) 50%, transparent 100%)',
        'dark-gradient': 'linear-gradient(to bottom, #0A0A0F, #111118)',
        'card-glass': 'linear-gradient(135deg, rgba(26,26,36,0.8) 0%, rgba(26,26,36,0.4) 100%)',
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
      },
      boxShadow: {
        'gold': '0 0 20px rgba(212,175,55,0.15)',
        'gold-lg': '0 0 40px rgba(212,175,55,0.25)',
        'gold-xl': '0 0 60px rgba(212,175,55,0.35)',
        'card': '0 4px 24px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 40px rgba(0,0,0,0.5)',
        'glass': '0 8px 32px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glass-hover': '0 12px 48px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
      },
      animation: {
        'shimmer': 'shimmer 2.5s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'float-slow': 'float 8s ease-in-out infinite',
        'fade-up': 'fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fadeIn 0.5s ease-out both',
        'scale-in': 'scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'marquee': 'marquee 30s linear infinite',
        'spin-slow': 'spin 20s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-glow': {
          '0%, 100%': {
            boxShadow: '0 0 20px rgba(212,175,55,0.1)',
            borderColor: 'rgba(212,175,55,0.2)',
          },
          '50%': {
            boxShadow: '0 0 40px rgba(212,175,55,0.3)',
            borderColor: 'rgba(212,175,55,0.5)',
          },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(40px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
        '800': '800ms',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
    },
  },
  plugins: [],
};
