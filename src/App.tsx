import { Routes, Route, Navigate } from 'react-router-dom';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import AdminPage from '@/pages/AdminPage';
import PriceResearch from '@/pages/PriceResearch';
import DemandSignals from '@/pages/DemandSignals';
import SearchPage from '@/pages/SearchPage';
import DemoPage from '@/pages/DemoPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/review" element={<ReviewPage />} />
      <Route path="/clean" element={<CleanPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/price-research" element={<PriceResearch />} />
      <Route path="/demand" element={<DemandSignals />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
