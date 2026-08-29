import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext.tsx';

const directPath = window.location.pathname.replace(/\/+$/, '') || '/';
const appRoutePrefixes = [
  '/admin', '/analytics', '/clean', '/dashboard', '/dealer', '/demand',
  '/demo', '/demo-mode', '/info', '/insight', '/multi-listings',
  '/price-research', '/reprocess', '/review', '/review-queue', '/trading',
];

// HashRouter is retained for compatibility with the existing deployment. Turn
// old direct links into canonical routes before React starts so bookmarks and
// Admin buttons cannot silently fall back to the public homepage.
if (!window.location.hash && directPath !== '/' && appRoutePrefixes.some(prefix => directPath === prefix || directPath.startsWith(`${prefix}/`))) {
  window.history.replaceState(null, '', `/#${directPath}${window.location.search}`);
}

createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </HashRouter>,
);
