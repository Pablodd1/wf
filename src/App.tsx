/**
 * WatchFacts — Application Router
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
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import DemandSignals from '@/pages/DemandSignals';
import DemoPage from '@/pages/DemoPage';
import HealthPage from '@/pages/HealthPage';
import DataBrowser from '@/pages/DataBrowser';
import AdminReportsPage from '@/pages/AdminReportsPage';
import ReferenceCheck from '@/pages/ReferenceCheck';
import ExportPage from '@/pages/ExportPage';
import QualityPage from '@/pages/QualityPage';
import VerificationPage from '@/pages/VerificationPage';
import SettingsPage from '@/pages/SettingsPage';
import BulkImportPage from '@/pages/BulkImportPage';
import BlogPage from '@/pages/BlogPage';
import ReprocessPage from '@/pages/ReprocessPage';

function AdminRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<AdminPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/data" element={<DataBrowser />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/reports" element={<AdminReportsPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/quality" element={<QualityPage />} />
        <Route path="/verification" element={<VerificationPage />} />
        <Route path="/clean" element={<CleanPage />} />
        <Route path="/import" element={<BulkImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/reprocess" element={<ReprocessPage />} />
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
        <Route path="/" element={<><Home /><Footer /></>} />
        <Route path="/reports" element={<><ReportsPage /><Footer /></>} />
        <Route path="/about-us" element={<><AboutUs /><Footer /></>} />
        <Route path="/about-simon" element={<><AboutSimon /><Footer /></>} />
        <Route path="/buying-process" element={<><BuyingProcess /><Footer /></>} />
        <Route path="/selling-process" element={<><SellingProcess /><Footer /></>} />
        <Route path="/terms" element={<><Terms /><Footer /></>} />
        <Route path="/privacy-policy" element={<><PrivacyPolicy /><Footer /></>} />
        <Route path="/glossary" element={<><Glossary /><Footer /></>} />
        <Route path="/blog" element={<><BlogPage /><Footer /></>} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />

        {/* Trading */}
        <Route path="/trading" element={<><TradingFloor /><Footer /></>} />
        <Route path="/flash-sales/:id" element={<FlashSaleDetail />} />
        <Route path="/buy" element={<Navigate to="/trading" replace />} />
        <Route path="/buy/all" element={<Navigate to="/trading" replace />} />
        <Route path="/price-research" element={<><PriceResearch /><Footer /></>} />
        <Route path="/reference-check" element={<ReferenceCheck />} />
        <Route path="/insight" element={<InsightDetails />} />

        {/* Pricing */}
        <Route path="/pricing" element={<><PricingPage /><Footer /></>} />

        {/* Admin — protected */}
        <Route path="/admin/*" element={<ProtectedRoute><AdminRoutes /></ProtectedRoute>} />

        {/* Redirects */}
        <Route path="/search" element={<Navigate to="/admin/search" replace />} />
        <Route path="/data" element={<Navigate to="/admin/data" replace />} />
        <Route path="/review" element={<Navigate to="/admin/review" replace />} />
        <Route path="/analytics" element={<Navigate to="/admin/analytics" replace />} />
        <Route path="/health" element={<Navigate to="/admin/health" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CookieConsent />
    </AuthProvider>
  );
}
