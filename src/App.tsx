/**
 * WatchFacts — Application Router (Consolidated)
 *
 * Admin routes reduced from 15 overlapping tabs to 7 focused sections:
 *   /admin              — Dashboard (health, stats, confidence protocol)
 *   /admin/reports      — Unified Reports (ALL listings, colored verdicts, dedup, bulk actions)
 *   /admin/search       — Search
 *   /admin/analytics    — Analytics
 *   /admin/health       — System Health
 *   /admin/import       — Bulk Import
 *   /admin/settings     — Settings
 *
 * Old routes (data, review, export, quality, verification, clean, reprocess, demo, demand)
 * redirect to /admin/reports — they are superseded by UnifiedReports.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CookieConsent } from '@/components/CookieConsent';
import { Footer } from '@/components/Footer';
import Home from '@/pages/Home';
import ReportsPage from '@/pages/ReportsPage';
import LoginPage from '@/pages/LoginPage';
import SignUpPage from '@/pages/SignUpPage';
import TradingFloor from '@/pages/TradingFloor';
import FlashSaleDetail from '@/pages/FlashSaleDetail';
import PriceResearch from '@/pages/PriceResearch';
import InsightDetails from '@/pages/InsightDetails';
import AboutUs from '@/pages/AboutUs';
import AboutSimon from '@/pages/AboutSimon';
import BuyingProcess from '@/pages/BuyingProcess';
import SellingProcess from '@/pages/SellingProcess';
import Terms from '@/pages/Terms';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import Glossary from '@/pages/Glossary';
import PricingPage from '@/pages/PricingPage';
import { Layout } from '@/components/Layout';
import AdminPage from '@/pages/AdminPage';
import SearchPage from '@/pages/SearchPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import HealthPage from '@/pages/HealthPage';
import SettingsPage from '@/pages/SettingsPage';
import BulkImportPage from '@/pages/BulkImportPage';
import BlogPage from '@/pages/BlogPage';
import ReferenceCheck from '@/pages/ReferenceCheck';
import UnifiedReports from '@/pages/UnifiedReports';

import PipelineDashboard from '@/pages/PipelineDashboard';
import LiveQueue from '@/pages/LiveQueue';
import DemoPage from '@/pages/DemoPage';

import WatchDetailReport from '@/pages/WatchDetailReport';
import CatalogSummary from '@/pages/CatalogSummary';

function AdminRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<AdminPage />} />
        <Route path="/reports" element={<UnifiedReports />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/import" element={<BulkImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path='/pipeline' element={<PipelineDashboard />} />
        <Route path='/live' element={<LiveQueue />} />
        <Route path='/catalog' element={<CatalogSummary />} />
        <Route path='/watch/:id' element={<WatchDetailReport />} />

        {/* Legacy redirects — old tabs now point to UnifiedReports */}
        <Route path="/data" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/review" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/export" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/quality" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/verification" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/clean" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/reprocess" element={<Navigate to="/admin" replace />} />
        <Route path="/demand" element={<Navigate to="/admin/analytics" replace />} />
        <Route path="/demo" element={<DemoPage />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <Footer />
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public site */}
        <Route path="/" element={<Home />} />
        <Route path="/reports" element={<><ReportsPage /><Footer /></>} />
        <Route path="/about-us" element={<><AboutUs /><Footer /></>} />
        <Route path="/about-simon" element={<><AboutSimon /><Footer /></>} />
        <Route path="/buying-process" element={<><BuyingProcess /><Footer /></>} />
        <Route path="/selling-process" element={<><SellingProcess /><Footer /></>} />
        <Route path="/terms" element={<><Terms /><Footer /></>} />
        <Route path="/privacy-policy" element={<><PrivacyPolicy /><Footer /></>} />
        <Route path="/glossary" element={<><Glossary /><Footer /></>} />
        <Route path="/blog" element={<><BlogPage /><Footer /></>} />
        <Route path="/demo" element={<DemoPage />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />

        {/* Trading */}
        <Route path="/trading" element={<><TradingFloor /><Footer /></>} />
        <Route path="/flash-sales/:id" element={<FlashSaleDetail />} />
        <Route path="/buy" element={<Navigate to="/trading" replace />} />
        <Route path="/buy/all" element={<Navigate to="/trading" replace />} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/reference-check" element={<ReferenceCheck />} />
        <Route path="/insight" element={<InsightDetails />} />

        {/* Pricing */}
        <Route path="/pricing" element={<><PricingPage /><Footer /></>} />

        {/* Admin — protected */}
        <Route path="/admin/*" element={<ProtectedRoute><AdminRoutes /></ProtectedRoute>} />

        {/* Legacy redirects */}
        <Route path="/search" element={<Navigate to="/admin/search" replace />} />
        <Route path="/data" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/review" element={<Navigate to="/admin/reports" replace />} />
        <Route path="/analytics" element={<Navigate to="/admin/analytics" replace />} />
        <Route path="/health" element={<Navigate to="/admin/health" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CookieConsent />
    </AuthProvider>
  );
}