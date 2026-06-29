/**
 * WatchFacts — Application Router
 * ================================
 * ALL routes are public — no login required
 * Public site (/) → watchfacts.com replica
 * Trading (/trading) → dealer marketplace with 2.39M watches
 * Auth routes (/login, /signup) → optional, for future use
 * Admin routes (/admin/*) → dashboard with 8 tabs, all public
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import Home from '@/pages/Home';
import ReportsPage from '@/pages/ReportsPage';
import LoginPage from '@/pages/LoginPage';
import SignUpPage from '@/pages/SignUpPage';
import TradingFloor from '@/pages/TradingFloor';
import FlashSaleDetail from '@/pages/FlashSaleDetail';
import { Layout } from '@/components/Layout';
import AdminPage from '@/pages/AdminPage';
import SearchPage from '@/pages/SearchPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import PriceResearch from '@/pages/PriceResearch';
import InsightDetails from '@/pages/InsightDetails';
import DemandSignals from '@/pages/DemandSignals';
import DemoPage from '@/pages/DemoPage';

/* Admin pages wrapped in Layout with internal navbar — ALL PUBLIC */
function AdminRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<AdminPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/clean" element={<CleanPage />} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/insight" element={<InsightDetails />} />
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
        {/* Public site — watchfacts.com replica */}
        <Route path="/" element={<Home />} />
        <Route path="/reports" element={<ReportsPage />} />

        {/* Auth routes — optional, for future OAuth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />

        {/* Trading Floor — dealer marketplace, 2.39M watches */}
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/flash-sales/:id" element={<FlashSaleDetail />} />
        <Route path="/buy" element={<Navigate to="/trading" replace />} />
        <Route path="/buy/all" element={<Navigate to="/trading" replace />} />

        {/* Admin dashboard — 8 tabs, ALL PUBLIC */}
        <Route path="/admin/*" element={<AdminRoutes />} />

        {/* Redirect legacy routes */}
        <Route path="/price-research" element={<Navigate to="/admin/price-research" replace />} />
        <Route path="/search" element={<Navigate to="/admin/search" replace />} />
        <Route path="/demo" element={<Navigate to="/admin/demo" replace />} />
        <Route path="/review" element={<Navigate to="/admin/review" replace />} />
        <Route path="/analytics" element={<Navigate to="/admin/analytics" replace />} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
