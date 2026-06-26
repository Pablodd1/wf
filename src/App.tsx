import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, memo } from 'react';

// Code-split every route — each page loads on demand, not all at once.
const Home = lazy(() => import('@/pages/Home'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const ReviewPage = lazy(() => import('@/pages/ReviewPage'));
const CleanPage = lazy(() => import('@/pages/CleanPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const PriceResearch = lazy(() => import('@/pages/PriceResearch'));
const DemandSignals = lazy(() => import('@/pages/DemandSignals'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const DemoPage = lazy(() => import('@/pages/DemoPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-gold-primary/30 border-t-gold-primary rounded-full animate-spin" />
        <span className="text-xs text-text-muted uppercase tracking-wider">Loading…</span>
      </div>
    </div>
  );
}

/** Wrapper that forces route remount on location change via key */
const AppRoutes = memo(function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/review" element={<ReviewPage />} />
      <Route path="/clean" element={<CleanPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/price-research" element={<PriceResearch />} />
      <Route path="/demand" element={<DemandSignals />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
});

export default function App() {
  const location = useLocation();
  return (
    <Suspense fallback={<PageLoader />}>
      <AppRoutes key={location.pathname + location.search} />
    </Suspense>
  );
}
