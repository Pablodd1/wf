import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DealerGate } from '@/components/DealerGate';

const OperationsDashboard = lazy(() => import('@/pages/OperationsDashboard'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const TradingFloor = lazy(() => import('@/pages/TradingFloor'));
const SourceAnalytics = lazy(() => import('@/pages/SourceAnalytics'));
const ReviewQueue = lazy(() => import('@/pages/ReviewQueue'));
const CleanPage = lazy(() => import('@/pages/CleanPage'));
const ReprocessPage = lazy(() => import('@/pages/ReprocessPage'));
const DemoPage = lazy(() => import('@/pages/DemoPage'));
const DemoMode = lazy(() => import('@/pages/DemoMode'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const PriceResearch = lazy(() => import('@/pages/PriceResearch'));
const DemandSignals = lazy(() => import('@/pages/DemandSignals'));
const InsightDetails = lazy(() => import('@/pages/InsightDetails'));
const DealerLogin = lazy(() => import('@/pages/DealerLogin'));
const DealerPortal = lazy(() => import('@/pages/DealerPortal'));
const DealerDirectory = lazy(() => import('@/pages/DealerDirectory'));
const DealerProfile = lazy(() => import('@/pages/DealerProfile'));
const MultiListings = lazy(() => import('@/pages/MultiListings'));

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dealer-login" element={<DealerLogin />} />
        <Route path="/dealer" element={<DealerGate allowBetaSkip><DealerPortal /></DealerGate>} />
        <Route path="/dashboard" element={<DealerGate allowedRoles={['admin']}><OperationsDashboard /></DealerGate>} />
        <Route path="/dashboard/legacy" element={<Navigate to="/dashboard" replace />} />
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/analytics" element={<DealerGate><SourceAnalytics /></DealerGate>} />
        <Route path="/analytics/legacy" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics-dashboard" element={<Navigate to="/analytics" replace />} />
        <Route path="/review" element={<Navigate to="/review-queue" replace />} />
        <Route path="/review-queue" element={<DealerGate><ReviewQueue /></DealerGate>} />
        <Route path="/clean" element={<DealerGate><CleanPage /></DealerGate>} />
        <Route path="/reprocess" element={<DealerGate><ReprocessPage /></DealerGate>} />
        <Route path="/study" element={<Navigate to="/clean" replace />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/demo-mode" element={<DemoMode />} />
        <Route path="/admin" element={<DealerGate allowedRoles={['admin']}><AdminPage /></DealerGate>} />
        <Route path="/multi-listings" element={<DealerGate allowedRoles={['admin']}><MultiListings /></DealerGate>} />
        <Route path="/dealers" element={<DealerGate><DealerDirectory /></DealerGate>} />
        <Route path="/dealers/:dealerId" element={<DealerGate><DealerProfile /></DealerGate>} />
        <Route path="/price-research" element={<DealerGate allowBetaSkip><PriceResearch /></DealerGate>} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/insight" element={<InsightDetails />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
