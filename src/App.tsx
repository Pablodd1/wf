import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

// Code-split every route — each page loads on demand, not all at once.
// This makes tab switching instant after first load.
const Home = lazy(() => import('@/pages/Home'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const AnalyticsDashboard = lazy(() => import('@/pages/AnalyticsDashboard'));
const ReviewPage = lazy(() => import('@/pages/ReviewPage'));
const ReviewQueue = lazy(() => import('@/pages/ReviewQueue'));
const CleanPage = lazy(() => import('@/pages/CleanPage'));
const ReprocessPage = lazy(() => import('@/pages/ReprocessPage'));
const DemoPage = lazy(() => import('@/pages/DemoPage'));
const DemoMode = lazy(() => import('@/pages/DemoMode'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const PriceResearch = lazy(() => import('@/pages/PriceResearch'));
const DemandSignals = lazy(() => import('@/pages/DemandSignals'));
const InsightDetails = lazy(() => import('@/pages/InsightDetails'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));

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

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/analytics-dashboard" element={<AnalyticsDashboard />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/review-queue" element={<ReviewQueue />} />
        <Route path="/clean" element={<CleanPage />} />
        <Route path="/reprocess" element={<ReprocessPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/demo-mode" element={<DemoMode />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/insight" element={<InsightDetails />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
