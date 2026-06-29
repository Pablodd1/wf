/**
 * WatchFacts — Application Router
 * ================================
 * ALL routes are public — no login required
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { CookieConsent } from '@/components/CookieConsent';
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
        <Route path="/clean" element={<CleanPage />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public site */}
        <Route path="/" element={<Home />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/about-us" element={<AboutUs />} />
        <Route path="/about-simon" element={<AboutSimon />} />
        <Route path="/buying-process" element={<BuyingProcess />} />
        <Route path="/selling-process" element={<SellingProcess />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/glossary" element={<Glossary />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />

        {/* Trading */}
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/flash-sales/:id" element={<FlashSaleDetail />} />
        <Route path="/buy" element={<Navigate to="/trading" replace />} />
        <Route path="/buy/all" element={<Navigate to="/trading" replace />} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/reference-check" element={<ReferenceCheck />} />
        <Route path="/insight" element={<InsightDetails />} />

        {/* Pricing */}
        <Route path="/pricing" element={<PricingPage />} />

        {/* Admin — 6 tabs: Search, Demo, Review, Analytics, Admin, Clean */}
        <Route path="/admin/*" element={<AdminRoutes />} />

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
