/**
 * Batch Review - Detailed record-by-record review interface
 * Shows raw vs normalized data side-by-side with validation results
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, CheckCircle, XCircle, AlertCircle, 
  ChevronLeft, ChevronRight, Save, SkipForward
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Batch, NormalizedRecord, ValidationIssue } from '@/types/pipeline';

export default function BatchReview() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  
  const [batch, setBatch] = useState<Batch | null>(null);
  const [records, setRecords] = useState<NormalizedRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    loadBatch();
  }, [batchId]);

  const loadBatch = async () => {
    setLoading(true);
    try {
      // Load batch details
      const { data: batchData, error: batchError } = await supabase
        .from('batches')
        .select('*')
        .eq('id', batchId)
        .single();

      if (batchError) throw batchError;

      // Load all records for this batch
      const { data: recordsData, error: recordsError } = await supabase
        .from('normalized_records')
        .select(`
          *,
          watch_records (
            raw_message,
            received_at,
            source
          )
        `)
        .eq('batch_id', batchId)
        .order('created_at', { ascending: true });

      if (recordsError) throw recordsError;

      setBatch(batchData as Batch);
      setRecords((recordsData || []) as NormalizedRecord[]);
      
      // Start with first pending record
      const firstPending = recordsData?.findIndex(r => r.status === 'PENDING');
      if (firstPending !== -1) {
        setCurrentIndex(firstPending);
      }
    } catch (error) {
      console.error('Error loading batch:', error);
    } finally {
      setLoading(false);
    }
  };

  const currentRecord = records[currentIndex];

  const handleApprove = async () => {
    await updateRecordStatus('APPROVED');
  };

  const handleReject = async () => {
    await updateRecordStatus('REJECTED');
  };

  const handleSkip = () => {
    if (currentIndex < records.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const updateRecordStatus = async (status: string) => {
    if (!currentRecord) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('normalized_records')
        .update({ 
          status,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', currentRecord.id);

      if (error) throw error;

      // Update local state
      setRecords(records.map((r: NormalizedRecord) => 
        r.id === currentRecord.id 
          ? { ...r, status, reviewed_at: new Date().toISOString() } as NormalizedRecord
          : r
      ));

      // Move to next record
      handleSkip();
    } catch (error) {
      console.error('Error updating record:', error);
      alert('Failed to update record');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkApprove = async () => {
    if (!confirm('Approve all pending records in this batch?')) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('normalized_records')
        .update({ 
          status: 'APPROVED',
          reviewed_at: new Date().toISOString()
        })
        .eq('batch_id', batchId)
        .eq('status', 'PENDING');

      if (error) throw error;

      // Reload batch
      await loadBatch();
      alert('All pending records approved!');
    } catch (error) {
      console.error('Error bulk approving:', error);
      alert('Failed to approve records');
    } finally {
      setSaving(false);
    }
  };

  const getValidationBadge = (status: string) => {
    switch (status) {
      case 'passed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
            <CheckCircle className="w-3 h-3" />
            Passed
          </span>
        );
      case 'flagged':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
            <AlertCircle className="w-3 h-3" />
            Flagged
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
            <XCircle className="w-3 h-3" />
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!batch || records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Batch not found or no records</p>
          <button
            onClick={() => navigate('/review')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const pendingCount = records.filter(r => r.status === 'PENDING').length;
  const approvedCount = records.filter(r => r.status === 'APPROVED').length;
  const rejectedCount = records.filter(r => r.status === 'REJECTED').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/review')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="w-5 h-5" />
                Back
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {batch.name || `Batch ${batch.id.slice(0, 8)}`}
                </h1>
                <p className="text-sm text-gray-600">
                  Record {currentIndex + 1} of {records.length}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex gap-2 text-sm">
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full">
                  {approvedCount} approved
                </span>
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full">
                  {pendingCount} pending
                </span>
                <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full">
                  {rejectedCount} rejected
                </span>
              </div>
              
              <button
                onClick={handleBulkApprove}
                disabled={saving || pendingCount === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Approve All Pending
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {currentRecord && (
          <>
            {/* Validation Status Banner */}
            {currentRecord.validation_status && (
              <div className={`mb-4 p-4 rounded-lg border ${
                currentRecord.validation_status === 'passed' ? 'bg-green-50 border-green-200' :
                currentRecord.validation_status === 'flagged' ? 'bg-yellow-50 border-yellow-200' :
                'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getValidationBadge(currentRecord.validation_status)}
                    <div>
                      <p className="font-medium text-gray-900">
                        Validation Confidence: {(currentRecord.confidence_score * 100).toFixed(1)}%
                      </p>
                      {currentRecord.validation_results?.issues && currentRecord.validation_results.issues.length > 0 && (
                        <p className="text-sm text-gray-600 mt-1">
                          {currentRecord.validation_results.issues.length} issue(s) found
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Validation Issues */}
                {currentRecord.validation_results?.issues && currentRecord.validation_results.issues.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {currentRecord.validation_results.issues.map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-gray-900">{issue.type}:</span>
                          <span className="text-gray-700 ml-1">{issue.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Side-by-Side Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Raw Message */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Raw Message</h2>
                <div className="space-y-3">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono">
                      {currentRecord.watch_records?.raw_message || 'No raw message'}
                    </pre>
                  </div>
                  
                  <div className="text-sm text-gray-600 space-y-1">
                    <div><span className="font-medium">Source:</span> {currentRecord.watch_records?.source || 'Unknown'}</div>
                    <div><span className="font-medium">Received:</span> {currentRecord.watch_records?.received_at ? new Date(currentRecord.watch_records.received_at).toLocaleString() : 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* Normalized Data */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Normalized Data</h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Brand</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">{currentRecord.brand || '-'}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
                      <div className="p-2 bg-gray-50 rounded text-sm font-mono">{currentRecord.reference || '-'}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Price USD</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">
                        {currentRecord.price_usd ? `$${currentRecord.price_usd.toLocaleString()}` : '-'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">{currentRecord.currency || '-'}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Dial Color</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">{currentRecord.dial_color || '-'}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Condition</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">{currentRecord.condition || '-'}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">{currentRecord.year || '-'}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Verdict</label>
                      <div className="p-2 bg-gray-50 rounded text-sm">{currentRecord.verdict || '-'}</div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Confidence Score</label>
                    <div className="p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${currentRecord.confidence_score * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">
                          {(currentRecord.confidence_score * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  onClick={() => setCurrentIndex(Math.min(records.length - 1, currentIndex + 1))}
                  disabled={currentIndex === records.length - 1}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {currentRecord.status === 'PENDING' && (
                <div className="flex gap-3">
                  <button
                    onClick={handleSkip}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    <SkipForward className="w-4 h-4" />
                    Skip
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </button>
                </div>
              )}

              {currentRecord.status !== 'PENDING' && (
                <div className="text-sm text-gray-600">
                  This record has been {currentRecord.status.toLowerCase()}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
