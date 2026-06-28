/**
 * WatchFacts — Application Router
 * ================================
 * Public site (/) → uses PublicNavbar (watchfacts.com replica)
 * Admin routes → use Layout with admin Navbar (internal tabs)
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import AdminPage from '@/pages/AdminPage';
import PriceResearch from '@/pages/PriceResearch';
import InsightDetails from '@/pages/InsightDetails';
import DemandSignals from '@/pages/DemandSignals';
import SearchPage from '@/pages/SearchPage';
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
    <Routes>
      {/* Public site — watchfacts.com replica, uses PublicNavbar */}
      <Route path="/" element={<Home />} />

      {/* Admin dashboard — all routes under /admin/* with admin navbar */}
      <Route path="/admin/*" element={<AdminRoutes />} />

      {/* Redirect old routes to admin */}
      <Route path="/price-research" element={<Navigate to="/admin/price-research" replace />} />
      <Route path="/search" element={<Navigate to="/admin/search" replace />} />
      <Route path="/demo" element={<Navigate to="/admin/demo" replace />} />
      <Route path="/review" element={<Navigate to="/admin/review" replace />} />
      <Route path="/analytics" element={<Navigate to="/admin/analytics" replace />} />
      <Route path="/admin" element={<Navigate to="/admin/" replace />} />

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
