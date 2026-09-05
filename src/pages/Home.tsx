import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Footer } from '@/components/Footer';
import { ProcessingTheater } from '@/sections/ProcessingTheater';
import { InventoryGrid } from '@/sections/InventoryGrid';
import { LiquidityTaxonomy } from '@/sections/LiquidityTaxonomy';
import { EnhancedResidue } from '@/sections/EnhancedResidue';
import { TabNav } from '@/components/TabNav';
import { FloatingNav } from '@/components/FloatingNav';
import { DetailModal } from '@/components/DetailModal';
import { EditModal } from '@/components/EditModal';
import { AIInsights } from '@/sections/AIInsights';
import { HomeCommandCenter } from '@/sections/HomeCommandCenter';
import LiveStream from '@/components/LiveStream';
import { useWatchData } from '@/hooks/useWatchData';
import type { WatchRecord } from '@/types';

export default function Home() {
  const { records, stats, loading } = useWatchData();

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
            price: record.price,
            originalCurrency: record.originalCurrency,
            confidence: record.confidence,
          };
          // Route to correct pipeline: ≥90 auto-approve, 60-89 AI review, <60 human
          updated.isResidue = true;
          // Update the record in local state (replace in records)
          // Note: records from useWatchData are read-only; edit is cosmetic in this session
          console.log('[Save] Record', record.id, 're-parsed, confidence:', updated.confidence,
            updated.isResidue ? '→ Residue' : updated.confidence >= 90 ? '→ Auto-Approved' : '→ AI Review');
        }
      }
    } catch (e) {
      console.error('[Save] AI re-parse failed:', e);
      // Failure never increases confidence or changes review state.
    }
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
              initial={{ width: '5%' }}
              animate={{ width: '85%' }}
              transition={{
                duration: 8,
                ease: 'easeInOut',
                repeat: Infinity,
                repeatType: 'reverse',
              }}
            />
          </div>
          <div className="h-10 w-10 rounded-full border-2 border-gold-primary/30 border-t-gold-primary animate-spin" />
          <p className="text-sm text-text-muted tracking-wide">
            Loading {stats.totalProcessed.toLocaleString()} records…
          </p>
          <p className="text-xs text-text-muted/50">
            Cache warming — first load takes ~8s, subsequent navigation is instant
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

      <div className="ml-0">
      <HomeCommandCenter workspaceRecords={stats.totalProcessed} />

      {/* Processing Theater Section */}
      <ProcessingTheater
        records={records}
        normalizedCount={stats.normalizedCount}
        residueCount={stats.residueCount}
      />

      {/* Live Stream from Supabase — real WhatsApp/Telegram messages */}
      <LiveStream />

      {/* Inventory Section */}
      <InventoryGrid
        records={records}
        onSelectRecord={handleSelectRecord}
      />

      {/* Liquidity & Taxonomy — NEW */}
      <LiquidityTaxonomy />

      {/* AI Intelligence Center */}
      <AIInsights
        records={records}
        onSelectRecord={handleSelectRecord}
      />

      {/* Enhanced Residue Bin — NEW */}
      <EnhancedResidue
        records={records}
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
