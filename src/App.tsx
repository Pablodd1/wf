/**
 * WatchFacts — Application Router
 * ================================
 * Public site (/) → uses PublicNavbar (watchfacts.com replica)
 * Auth routes (/login, /signup) → dealer authentication
 * Admin routes → use Layout with admin Navbar (internal tabs, protected)
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import Home from '@/pages/Home';
import ReportsPage from '@/pages/ReportsPage';
import LoginPage from '@/pages/LoginPage';
import SignUpPage from '@/pages/SignUpPage';
import TradingFloor from '@/pages/TradingFloor';
import FlashSaleDetail from '@/pages/FlashSaleDetail';
import AdminPage from '@/pages/AdminPage';
import SearchPage from '@/pages/SearchPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import PriceResearch from '@/pages/PriceResearch';
import InsightDetails from '@/pages/InsightDetails';
import DemandSignals from '@/pages/DemandSignals';
import DemoPage from '@/pages/DemoPage';

/* Admin pages wrapped in Layout with internal navbar */
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

        {/* Auth routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />

        {/* Trading Floor — public dealer marketplace */}
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/flash-sales/:id" element={<FlashSaleDetail />} />

        {/* Admin dashboard — all routes under /admin/* (protected) */}
        <Route path="/admin/*" element={
          <ProtectedRoute>
            <AdminRoutes />
          </ProtectedRoute>
        } />

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
