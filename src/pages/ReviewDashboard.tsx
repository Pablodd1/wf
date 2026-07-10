/**
 * Review Dashboard - Batch Management & Review Interface
 * Main entry point for human review workflow
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Clock, CheckCircle, XCircle, AlertCircle, 
  ChevronRight, Filter, Search, RefreshCw
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Batch, NormalizedRecord } from '@/types/pipeline';

export default function ReviewDashboard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadBatches();
  }, [filter]);

  const loadBatches = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('batches')
        .select(`
          *,
          normalized_records (
            id,
            status,
            validation_results
          )
        `)
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Process batches to add stats
      const processedBatches = data.map((batch: Batch) => {
        const records = batch.normalized_records || [];
        const approved = records.filter((r: NormalizedRecord) => r.status === 'APPROVED').length;
        const rejected = records.filter((r: NormalizedRecord) => r.status === 'REJECTED').length;
        const pending = records.filter((r: NormalizedRecord) => r.status === 'PENDING').length;
        
        return {
          ...batch,
          stats: {
            total: records.length,
            approved,
            rejected,
            pending
          }
        };
      });

      setBatches(processedBatches);
    } catch (error) {
      console.error('Error loading batches:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredBatches = batches.filter((batch: Batch) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      batch.id.toLowerCase().includes(term) ||
      batch.name?.toLowerCase().includes(term) ||
      batch.filter_criteria?.reference?.toLowerCase().includes(term)
    );
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'PROCESSING':
        return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'PENDING_REVIEW':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'FAILED':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'PROCESSING':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'PENDING_REVIEW':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'FAILED':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  if (loading && batches.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Review Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">
                Manage and review normalized batches
              </p>
            </div>
            <button
              onClick={loadBatches}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600">Total Batches</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {batches.length}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-yellow-200 p-4">
            <div className="text-sm text-yellow-700">Pending Review</div>
            <div className="text-2xl font-bold text-yellow-900 mt-1">
              {batches.filter(b => b.status === 'PENDING_REVIEW').length}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-blue-200 p-4">
            <div className="text-sm text-blue-700">Processing</div>
            <div className="text-2xl font-bold text-blue-900 mt-1">
              {batches.filter(b => b.status === 'PROCESSING').length}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-green-200 p-4">
            <div className="text-sm text-green-700">Completed</div>
            <div className="text-2xl font-bold text-green-900 mt-1">
              {batches.filter(b => b.status === 'COMPLETED').length}
            </div>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search batches..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="PENDING_REVIEW">Pending Review</option>
                <option value="PROCESSING">Processing</option>
                <option value="COMPLETED">Completed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Batch List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Batch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Records
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Validation
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredBatches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {batch.name || `Batch ${batch.id.slice(0, 8)}`}
                          </div>
                          <div className="text-xs text-gray-500">
                            {batch.id.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(batch.status)}
                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(batch.status)}`}>
                          {batch.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {batch.stats?.total ?? 0}
                      </div>
                      <div className="text-xs text-gray-500">
                        {batch.stats?.approved ?? 0} approved, {batch.stats?.pending ?? 0} pending
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {batch.validation_summary ? (
                          <>
                            <div>{batch.validation_summary.passed || 0} passed</div>
                            <div className="text-xs text-yellow-600">
                              {batch.validation_summary.flagged || 0} flagged
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400">No validation</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(batch.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        to={`/review/batch/${batch.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900"
                      >
                        Review
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {filteredBatches.length === 0 && !loading && (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No batches found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
