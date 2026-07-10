/**
 * Create Batch - Interface for creating new normalization batches
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { FilterCriteria } from '@/types/pipeline';

export default function CreateBatch() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<{
    name: string;
    filter_criteria: FilterCriteria & { verdict?: string };
    batch_size: number;
    priority: number;
  }>({
    name: '',
    filter_criteria: {
      brand: '',
      reference: '',
      verdict: 'APPROVED',
      price_min: undefined,
      price_max: undefined,
      date_from: '',
      date_to: '',
    },
    batch_size: 100,
    priority: 5
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('batches')
        .insert([{
          name: formData.name || null,
          filter_criteria: formData.filter_criteria,
          batch_size: formData.batch_size,
          priority: formData.priority,
          status: 'PENDING'
        }])
        .select()
        .single();

      if (error) throw error;

      // Navigate to the batch review page
      navigate(`/pipeline/batch/${(data as any).id}`);
    } catch (err) {
      console.error('Error creating batch:', err);
      alert('Failed to create batch: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const updateFilterCriteria = (key: string, value: string) => {
    setFormData({
      ...formData,
      filter_criteria: {
        ...formData.filter_criteria,
        [key]: value
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/pipeline')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Create New Batch</h1>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Batch Name */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Batch Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Batch Name (optional)
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Rolex 116500 normalization"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Batch Size
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={formData.batch_size}
                    onChange={(e) => setFormData({ ...formData, batch_size: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Priority (1-10)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Filter Criteria */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Filter Criteria</h2>
            <p className="text-sm text-gray-600 mb-4">
              Select which records to include in this batch
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reference (optional)
                </label>
                <input
                  type="text"
                  value={formData.filter_criteria.reference || ''}
                  onChange={(e) => updateFilterCriteria('reference', e.target.value)}
                  placeholder="e.g., 116500"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Brand (optional)
                </label>
                <input
                  type="text"
                  value={formData.filter_criteria.brand || ''}
                  onChange={(e) => updateFilterCriteria('brand', e.target.value)}
                  placeholder="e.g., Rolex"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Verdict
                </label>
                <select
                  value={formData.filter_criteria.verdict || 'APPROVED'}
                  onChange={(e) => updateFilterCriteria('verdict', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="APPROVED">Approved</option>
                  <option value="REVIEW">Review</option>
                  <option value="HUMAN">Human</option>
                  <option value="RECYCLE">Recycle</option>
                </select>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/pipeline')}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Batch
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
