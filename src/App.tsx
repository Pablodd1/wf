import { Routes, Route, Navigate } from 'react-router-dom';
import Home from '@/pages/Home';
import TradingFloor from '@/pages/TradingFloor';
import AnalyticsPage from '@/pages/AnalyticsPage';
import AnalyticsDashboard from '@/pages/AnalyticsDashboard';
import ReviewPage from '@/pages/ReviewPage';
import ReviewQueue from '@/pages/ReviewQueue';
import CleanPage from '@/pages/CleanPage';
import ReprocessPage from '@/pages/ReprocessPage';
import DemoPage from '@/pages/DemoPage';
import DemoMode from '@/pages/DemoMode';
import AdminPage from '@/pages/AdminPage';
import PriceResearch from '@/pages/PriceResearch';
import DemandSignals from '@/pages/DemandSignals';
import InsightDetails from '@/pages/InsightDetails';
import ReviewDashboard from '@/pages/ReviewDashboard';
import BatchReview from '@/pages/BatchReview';
import CreateBatch from '@/pages/CreateBatch';
import MonitorDashboard from '@/pages/MonitorDashboard';
import PipelineDashboard from '@/pages/PipelineDashboard';
import { AuthProvider } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<PipelineDashboard />} />
          <Route path="/trading" element={<TradingFloor />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/analytics-dashboard" element={<AnalyticsDashboard />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/review-queue" element={<ReviewQueue />} />
          <Route path="/clean" element={<CleanPage />} />
          <Route path="/reprocess" element={<ReprocessPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/demo-mode" element={<DemoMode />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/price-research" element={<PriceResearch />} />
          <Route path="/demand" element={<DemandSignals />} />
          <Route path="/insight" element={<InsightDetails />} />
          <Route path="/pipeline" element={<ReviewDashboard />} />
          <Route path="/pipeline/batch/:batchId" element={<BatchReview />} />
          <Route path="/pipeline/create" element={<CreateBatch />} />
          <Route path="/monitor" element={<MonitorDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
