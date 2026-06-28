/**
 * WatchFacts — Application Router
 * ================================
 * Wraps all routes inside the shared Layout (Navbar + StatsBar) so every
 * page inherits the top-level chrome.
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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/clean" element={<CleanPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/insight" element={<InsightDetails />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
