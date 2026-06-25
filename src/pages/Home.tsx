import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { StatsBar } from '@/components/StatsBar';
import { Footer } from '@/components/Footer';
import { ProcessingTheater } from '@/sections/ProcessingTheater';
import { InventoryGrid } from '@/sections/InventoryGrid';
import { LiquidityTaxonomy } from '@/sections/LiquidityTaxonomy';
import { EnhancedResidue } from '@/sections/EnhancedResidue';
import { WorkflowSidebar } from '@/components/WorkflowSidebar';
import { TabNav } from '@/components/TabNav';
import { FloatingNav } from '@/components/FloatingNav';
import { DetailModal } from '@/components/DetailModal';
import { EditModal } from '@/components/EditModal';
import { AIInsights } from '@/sections/AIInsights';
import LiveStream from '@/components/LiveStream';
import { useWatchData } from '@/hooks/useWatchData';
import { exportDatasetExcel, exportDatasetCsv } from '@/lib/datasetExport';
import { downloadStyledReport } from '@/lib/reportGenerator';
import type { WatchRecord } from '@/types';

/** Derive verdict from confidence + flags (same as backend) */
function getVerdict(r: WatchRecord): 'APPROVED' | 'HUMAN' | 'RECYCLE' {
  if (r.isResidue || r.confidence < 35) return 'RECYCLE';
  if (r.confidence >= 90 && !r.failureFlags?.length) return 'APPROVED';
  return 'HUMAN';
}

export default function Home() {
  const { records, stats, loading, loadProgress } = useWatchData();
  
  // Public pages only show APPROVED records (HUMAN/RECYCLE hidden)
  const publicRecords = useMemo(() => records.filter(r => getVerdict(r) === 'APPROVED'), [records]);

  // Modal state
  const [selectedRecord, setSelectedRecord] = useState<WatchRecord | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<WatchRecord | null>(null);
  // Track which residue records have been reviewed (for authentic workflow)
  const [reviewedRecords, setReviewedRecords] = useState<Set<string>>(new Set());
  const [approvedRecords, setApprovedRecords] = useState<Set<string>>(new Set());
  const [deletedRecords, setDeletedRecords] = useState<Set<string>>(new Set());

  // ---- Handlers ----

  const handleSelectRecord = useCallback((record: WatchRecord) => {
    setSelectedRecord(record);
    setDetailModalOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleOpenEdit = useCallback((record: WatchRecord) => {
    setEditingRecord(record);
    setEditModalOpen(true);
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditModalOpen(false);
    setEditingRecord(null);
  }, []);

  const handleApprove = useCallback((record: WatchRecord) => {
    setApprovedRecords((prev) => new Set(prev).add(record.id));
    setReviewedRecords((prev) => new Set(prev).add(record.id));
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleDelete = useCallback((record: WatchRecord) => {
    setDeletedRecords((prev) => new Set(prev).add(record.id));
    setReviewedRecords((prev) => new Set(prev).add(record.id));
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleFlag = useCallback((record: WatchRecord) => {
    setReviewedRecords((prev) => new Set(prev).add(record.id));
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleSaveEdit = useCallback(async (record: WatchRecord) => {
    setEditModalOpen(false);
    setEditingRecord(null);
    // Re-run AI parse on the updated record to get fresh confidence
    try {
      const res = await fetch('/api/ai-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawMessage: record.rawMessage,
          currentGuess: {
            reference: record.reference,
            dialColor: record.dialColor,
            brand: record.brand,
            price: record.price,
            currency: record.originalCurrency,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        const ai = Array.isArray(data.parsed) ? data.parsed[0] : data.parsed;
        if (ai) {
          // Merge AI insights back into the record
          const updated: WatchRecord = {
            ...record,
            brand: ai.brand || record.brand,
            reference: ai.reference || record.reference,
            dialColor: ai.dialColor || record.dialColor,
            condition: ai.condition || record.condition,
            year: ai.year ?? record.year,
            price: ai.price || record.price,
            originalCurrency: ai.currency || record.originalCurrency,
            confidence: ai.confidence?.[0] && ai.confidence[0] >= 50
              ? Math.round(ai.confidence[0])
              : Math.min(100, record.confidence + 25), // Boost by 25 for human-verified
          };
          // Route to correct pipeline: ≥90 auto-approve, 60-89 AI review, <60 human
          updated.isResidue = updated.confidence < 60;
          // Update the record in local state (replace in records)
          // Note: records from useWatchData are read-only; edit is cosmetic in this session
          console.log('[Save] Record', record.id, 're-parsed, confidence:', updated.confidence,
            updated.isResidue ? '→ Residue' : updated.confidence >= 90 ? '→ Auto-Approved' : '→ AI Review');
        }
      }
    } catch (e) {
      console.error('[Save] AI re-parse failed:', e);
      // Even if AI fails, mark as human-approved with boosted confidence
      const updated: WatchRecord = {
        ...record,
        confidence: Math.min(100, record.confidence + 15),
        isResidue: false,
      };
      void updated; // read-only dataset, edit is cosmetic
    }
  }, [records]);

  const handleExportExcel = useCallback(async () => {
    if (!records || records.length === 0) return;
    try {
      await exportDatasetExcel(records);
    } catch (e) {
      console.error('Excel export failed:', e);
      alert('Export failed: ' + (e as Error).message);
    }
  }, [records]);

  const handleExportCsv = useCallback(() => {
    if (!records || records.length === 0) return;
    exportDatasetCsv(records);
  }, [records]);

  const handleExportReport = useCallback(() => {
    if (!records || records.length === 0) return;
    downloadStyledReport(records.map(r => ({
      reference: r.reference,
      brand: r.brand,
      dialColor: r.dialColor,
      price: r.price,
      currency: r.originalCurrency,
      condition: r.condition,
      year: r.year,
      confidence: r.confidence,
      status: r.isResidue ? 'HUMAN_REVIEW' : r.confidence >= 90 ? 'AUTO_APPROVED' : 'AI_REVIEW',
      intent: (r as any).intent || 'SELL',
      rawMessage: r.rawMessage,
    })));
  }, [records]);

  if (loading) {
    return (
      <Layout
        totalProcessed={stats.totalProcessed}
        normalizedCount={stats.normalizedCount}
        residueCount={stats.residueCount}
        throughputRate={stats.throughputRate}
        avgLatency={stats.avgLatency}
      >
        <TabNav totalProcessed={stats.totalProcessed} />
        <div className="flex flex-col items-center justify-center py-32 gap-6">
          {/* Animated progress bar */}
          <div className="w-64 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gold-primary rounded-full"
              initial={{ width: '0%' }}
              animate={{ width: `${loadProgress}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
          <div className="h-10 w-10 rounded-full border-2 border-gold-primary/30 border-t-gold-primary animate-spin" />
          <p className="text-sm text-text-muted tracking-wide">
            Loading {stats.totalProcessed.toLocaleString()} records… {Math.round(loadProgress)}%
          </p>
          <p className="text-xs text-text-muted/50">
            Cache warming — first load downloads ~20MB, subsequent tabs are instant
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      {/* Tab Navigation */}
      <TabNav totalProcessed={stats.totalProcessed} />

      {/* Workflow Sidebar */}
      <WorkflowSidebar
        totalRecords={stats.totalProcessed}
        normalizedCount={stats.normalizedCount}
        residueCount={stats.residueCount}
        onExportExcel={handleExportExcel}
        onExportCsv={handleExportCsv}
        onExportReport={handleExportReport}
      />

      <div className="ml-0">
        {/* Stats Bar */}
        <StatsBar
        totalProcessed={stats.totalProcessed}
        accuracyRate={stats.accuracyRate}
        mlAvgTime={stats.mlAvgTime}
        residueRate={stats.residueRate}
      />

      {/* Processing Theater Section */}
      <ProcessingTheater
        records={publicRecords}
        normalizedCount={stats.normalizedCount}
        residueCount={stats.residueCount}
      />

      {/* Live Stream from Supabase — real WhatsApp/Telegram messages */}
      <LiveStream />

      {/* Inventory Section */}
      <InventoryGrid
        records={publicRecords}
        onSelectRecord={handleSelectRecord}
      />

      {/* Liquidity & Taxonomy — NEW */}
      <LiquidityTaxonomy />

      {/* AI Intelligence Center */}
      <AIInsights
        records={publicRecords}
        onSelectRecord={handleSelectRecord}
      />

      {/* Enhanced Residue Bin — NEW */}
      <EnhancedResidue
        records={publicRecords}
        onApprove={handleApprove}
        onEdit={handleOpenEdit}
        onDelete={handleDelete}
        approvedRecords={approvedRecords}
        deletedRecords={deletedRecords}
        reviewedRecords={reviewedRecords}
      />

      </div>

      {/* Floating Navigation */}
      <FloatingNav />

      {/* Detail Modal */}
      <DetailModal
        record={selectedRecord}
        open={detailModalOpen}
        onClose={handleCloseDetail}
        onApprove={handleApprove}
        onEdit={handleOpenEdit}
        onFlag={handleFlag}
        onDelete={handleDelete}
      />

      {/* Edit Modal */}
      <EditModal
        record={editingRecord}
        open={editModalOpen}
        onClose={handleCloseEdit}
        onSave={handleSaveEdit}
      />

      <Footer />
    </Layout>
  );
}
