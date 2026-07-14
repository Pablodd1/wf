import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DealerGate } from '@/components/DealerGate';

const Home = lazy(() => import('@/pages/Home'));
const OperationsDashboard = lazy(() => import('@/pages/OperationsDashboard'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const TradingFloor = lazy(() => import('@/pages/TradingFloor'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const SourceAnalytics = lazy(() => import('@/pages/SourceAnalytics'));
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
const DealerLogin = lazy(() => import('@/pages/DealerLogin'));
const HireFi = lazy(() => import('@/pages/HireFi'));
const Partners = lazy(() => import('@/pages/Partners'));

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dealer-login" element={<DealerLogin />} />
        <Route path="/dashboard" element={<DealerGate><OperationsDashboard /></DealerGate>} />
        <Route path="/dashboard/legacy" element={<DealerGate><Home /></DealerGate>} />
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/analytics" element={<DealerGate><SourceAnalytics /></DealerGate>} />
        <Route path="/analytics/legacy" element={<DealerGate><AnalyticsPage /></DealerGate>} />
        <Route path="/analytics-dashboard" element={<DealerGate><AnalyticsDashboard /></DealerGate>} />
        <Route path="/review" element={<DealerGate><ReviewPage /></DealerGate>} />
        <Route path="/review-queue" element={<DealerGate><ReviewQueue /></DealerGate>} />
        <Route path="/clean" element={<DealerGate><CleanPage /></DealerGate>} />
        <Route path="/reprocess" element={<DealerGate><ReprocessPage /></DealerGate>} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/demo-mode" element={<DemoMode />} />
        <Route path="/admin" element={<DealerGate><AdminPage /></DealerGate>} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/insight" element={<InsightDetails />} />
        <Route path="/hire-fi" element={<HireFi />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
