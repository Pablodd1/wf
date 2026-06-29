/**
 * Public Reports Page — Consumer-facing reports
 * Links to admin analytics and shows summary stats
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, ArrowRight, Database, Shield } from 'lucide-react';
import { PublicNavbar } from '@/components/PublicNavbar';

const REPORTS = [
  {
    title: 'Market Analytics',
    description: 'Real-time brand distribution, price trends, and confidence scores across 2.39M+ listings.',
    icon: BarChart3,
    link: '/admin/analytics',
    color: '#C9A96E',
  },
  {
    title: 'Price Research',
    description: 'Analyze market trends and detect outliers for any watch reference with IQR methodology.',
    icon: TrendingUp,
    link: '/price-research',
    color: '#3B5BFE',
  },
  {
    title: 'Data Browser',
    description: 'Full access to the normalized database. Sort, filter, and export watch records.',
    icon: Database,
    link: '/admin/data',
    color: '#22C55E',
  },
];

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-white">
      <PublicNavbar />
      <div className="pt-[80px] max-w-5xl mx-auto px-6 pb-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-3xl font-light text-gray-900 mb-3">Market Reports</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Access real-time analytics, price research tools, and comprehensive data insights from our database of 2.39M+ watch listings.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {REPORTS.map((report, i) => {
            const Icon = report.icon;
            return (
              <motion.div key={report.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Link to={report.link} className="block bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg hover:border-gray-300 transition-all group">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: `${report.color}15` }}>
                    <Icon size={24} style={{ color: report.color }} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-[#3B5BFE] transition-colors">{report.title}</h3>
                  <p className="text-sm text-gray-500 mb-4 leading-relaxed">{report.description}</p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: report.color }}>
                    View Report <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </span>
                </Link>
              </motion.div>
            );
          })}
        </div>

        {/* Stats Banner */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="mt-12 bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-8 text-white text-center">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <div className="text-3xl font-bold text-amber-400">2.39M+</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">Listings</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-white">29,512+</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">Global Dealers</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-green-400">6,410</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">Catalog Images</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-400">Real-Time</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">Price Data</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
