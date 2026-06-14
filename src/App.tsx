import { Routes, Route } from 'react-router-dom';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import CleanAnalysis from '@/pages/CleanAnalysis';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/clean" element={<CleanAnalysis />} />
    </Routes>
  );
}
