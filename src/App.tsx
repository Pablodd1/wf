import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { DealerGate } from '@/components/DealerGate';
import { HireFiScrollRail } from '@/components/HireFiScrollRail';
import { RouteLoadBoundary } from '@/components/RouteLoadBoundary';
import { loadRouteModuleWithRecovery } from '@/lazy-route-recovery';

const BUILD_ID = import.meta.env.VITE_APP_BUILD_ID || 'local';
type LazyRouteModule = { default: ComponentType<unknown> };

function recoverableRoute<T extends LazyRouteModule>(routeKey: string, importer: () => Promise<T>) {
  return lazy(() => loadRouteModuleWithRecovery(importer, {
    buildId: BUILD_ID,
    routeKey,
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
  }));
}

const OperationsDashboard = recoverableRoute('operations-dashboard', () => import('@/pages/OperationsDashboard'));
const TradingFloor = recoverableRoute('trading-floor', () => import('@/pages/TradingFloor'));
const SourceAnalytics = recoverableRoute('source-analytics', () => import('@/pages/SourceAnalytics'));
const ReviewQueue = recoverableRoute('review-queue', () => import('@/pages/ReviewQueue'));
const CleanPage = recoverableRoute('clean-page', () => import('@/pages/CleanPage'));
const ReprocessPage = recoverableRoute('reprocess-page', () => import('@/pages/ReprocessPage'));
const DemoPage = recoverableRoute('demo-page', () => import('@/pages/DemoPage'));
const DemoMode = recoverableRoute('demo-mode', () => import('@/pages/DemoMode'));
const AdminPage = recoverableRoute('admin-page', () => import('@/pages/AdminPage'));
const PriceResearch = recoverableRoute('price-research', () => import('@/pages/PriceResearch'));
const LuxuryResearch = recoverableRoute('luxury-research', () => import('@/pages/LuxuryResearch'));
const DemandSignals = recoverableRoute('demand-signals', () => import('@/pages/DemandSignals'));
const InsightDetails = recoverableRoute('insight-details', () => import('@/pages/InsightDetails'));
const DealerLogin = recoverableRoute('dealer-login', () => import('@/pages/DealerLogin'));
const DealerPortal = recoverableRoute('dealer-portal', () => import('@/pages/DealerPortal'));
const DealerSubmitListing = recoverableRoute('dealer-submit-listing', () => import('@/pages/DealerSubmitListing'));
const DealerAccount = recoverableRoute('dealer-account', () => import('@/pages/DealerAccount'));
const DealerDirectory = recoverableRoute('dealer-directory', () => import('@/pages/DealerDirectory'));
const DealerProfile = recoverableRoute('dealer-profile', () => import('@/pages/DealerProfile'));
const TelegramTest = recoverableRoute('telegram-test', () => import('@/pages/TelegramTest'));
const MultiListings = recoverableRoute('multi-listings', () => import('@/pages/MultiListings'));
const PublicInfo = recoverableRoute('public-info', () => import('@/pages/PublicInfo'));
const FlashSaleDetail = recoverableRoute('flash-sale-detail', () => import('@/pages/FlashSaleDetail'));
const Blog = recoverableRoute('blog', () => import('@/pages/Blog'));
const PrivacyPolicy = recoverableRoute('privacy-policy', () => import('@/pages/PrivacyPolicy'));

function LegacyDealerDirectoryRedirect() {
  const location = useLocation();
  return <Navigate to={`/reference-check${location.search}`} replace />;
}

function LegacyDealerProfileRedirect() {
  const { dealerId } = useParams();
  const location = useLocation();
  return <Navigate to={`/reference-check/${encodeURIComponent(dealerId || '')}${location.search}`} replace />;
}

export default function App() {
  const location = useLocation();
  return (
    <>
      <RouteLoadBoundary resetKey={`${location.pathname}${location.search}`}>
        <Suspense fallback={<div className="min-h-screen bg-white" />}>
          <Routes>
        <Route path="/" element={<Navigate to="/trading" replace />} />
        <Route path="/dealer" element={<DealerLogin />} />
        <Route path="/dealer-login" element={<Navigate to="/dealer" replace />} />
        <Route path="/cl-login" element={<DealerLogin />} />
        <Route path="/admin-login" element={<Navigate to="/cl-login" replace />} />
        <Route path="/dealer/workspace" element={<DealerPortal />} />
        <Route path="/dealer/post" element={<DealerSubmitListing />} />
        <Route path="/dealer/account/:section" element={<DealerAccount />} />
        <Route path="/dashboard" element={<DealerGate allowedRoles={['admin']}><OperationsDashboard /></DealerGate>} />
        <Route path="/dashboard/legacy" element={<Navigate to="/dashboard" replace />} />
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/telegram-test" element={<TelegramTest />} />
        <Route path="/analytics" element={<SourceAnalytics />} />
        <Route path="/analytics/legacy" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics-dashboard" element={<Navigate to="/analytics" replace />} />
        <Route path="/review" element={<Navigate to="/review-queue" replace />} />
        <Route path="/review-queue" element={<DealerGate allowedRoles={['reviewer', 'admin']}><ReviewQueue /></DealerGate>} />
        <Route path="/clean" element={<DealerGate><CleanPage /></DealerGate>} />
        <Route path="/reprocess" element={<DealerGate allowedRoles={['reviewer', 'admin']}><ReprocessPage /></DealerGate>} />
        <Route path="/study" element={<Navigate to="/clean" replace />} />
        <Route path="/demo" element={<DealerGate allowedRoles={['admin']}><DemoPage /></DealerGate>} />
        <Route path="/demo-mode" element={<DealerGate allowedRoles={['admin']}><DemoMode /></DealerGate>} />
        <Route path="/admin" element={<DealerGate allowedRoles={['admin']}><AdminPage /></DealerGate>} />
        <Route path="/multi-listings" element={<DealerGate allowedRoles={['admin']}><MultiListings /></DealerGate>} />
        <Route path="/dealers" element={<DealerDirectory />} />
        <Route path="/dealers/:dealerId" element={<DealerProfile />} />
        <Route path="/reference-check" element={<DealerDirectory />} />
        <Route path="/reference-check/:dealerId" element={<DealerProfile />} />
        <Route path="/dealer/profile/:dealerId" element={<DealerProfile />} />
        {/* ponytail: Price Research is public (adaa4e9, 0b92aa3, 0e51450 —
            2026-08-01 "remove DealerGate ... now public/free access, no
            login required"). c1f6490 re-wrapped it in DealerGate the same
            day by accident, showing the login page to every visitor. */}
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/luxury-research" element={<LuxuryResearch />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/insight" element={<InsightDetails />} />
        <Route path="/info/:page" element={<PublicInfo />} />
        <Route path="/flash-sales/:id" element={<FlashSaleDetail />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="*" element={<Navigate to="/trading" replace />} />
          </Routes>
        </Suspense>
      </RouteLoadBoundary>
      <HireFiScrollRail />
    </>
  );
}
