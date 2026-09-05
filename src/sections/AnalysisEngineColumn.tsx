import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StageDot } from '@/components/ui/StageDot';
import type { StageName, WatchRecord } from '@/types';
import type { StageMessage } from '@/hooks/usePipelineSimulation';

interface AnalysisEngineColumnProps {
  currentRecord: WatchRecord | null;
  activeStage: StageName | null;
  completedStages: StageName[];
  stageMessages: StageMessage[];
  isProcessing: boolean;
  failedStage: StageName | null;
  stageColors: Record<StageName, string>;
  progress: number;
}

const STAGE_LABELS: StageName[] = ['INGEST', 'VALIDATE', 'NORMALIZE', 'ENRICH', 'ML_SCORE'];

const STAGE_LABEL_NAMES: Record<StageName, string> = {
  INGEST: 'INGEST',
  VALIDATE: 'VALIDATE',
  NORMALIZE: 'NORMALIZE',
  ENRICH: 'ENRICH',
  ML_SCORE: 'ML_SCORE',
};

const getStageDotState = (
  stage: StageName,
  activeStage: StageName | null,
  completedStages: StageName[],
  failedStage: StageName | null
): 'inactive' | 'active' | 'completed' | 'failed' => {
  if (failedStage === stage) return 'failed';
  if (activeStage === stage) return 'active';
  if (completedStages.includes(stage)) return 'completed';
  return 'inactive';
};

export const AnalysisEngineColumn = memo(function AnalysisEngineColumn({
  currentRecord,
  activeStage,
  completedStages,
  stageMessages,
  isProcessing,
  failedStage,
  stageColors,
  progress,
}: AnalysisEngineColumnProps) {
  const currentStageLabel = activeStage
    ? `${activeStage}...`
    : isProcessing
      ? 'PROCESSING...'
      : 'READY';
  const currentStageColor = activeStage ? stageColors[activeStage] : '#8B5CF6';

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-col overflow-hidden" style={{ minHeight: 520 }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-border-default flex-shrink-0">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
          ANALYSIS ENGINE
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: currentStageColor }} />
          <span className="text-[10px] font-semibold" style={{ color: currentStageColor }}>
            {currentStageLabel}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Stage Indicators */}
        <div className="flex flex-col gap-3 px-1">
          {/* Dots row with connecting line */}
          <div className="relative flex items-center justify-between">
            {/* Connecting line background */}
            <div className="absolute top-[3px] left-0 right-0 h-[1px] bg-border-default -z-0" />

            {/* Connecting line fill */}
            <div
              className="absolute top-[3px] left-0 h-[1px] -z-0 transition-all duration-500 ease-linear"
              style={{
                width: `${progress}%`,
                background: failedStage === 'VALIDATE'
                  ? `linear-gradient(to right, ${stageColors.INGEST}, ${stageColors.VALIDATE}, #EF4444)`
                  : `linear-gradient(to right, ${stageColors.INGEST}, ${stageColors.VALIDATE}, ${stageColors.NORMALIZE}, ${stageColors.ENRICH}, ${stageColors.ML_SCORE})`,
              }}
            />

            {STAGE_LABELS.map((stage) => {
              const dotState = getStageDotState(stage, activeStage, completedStages, failedStage);
              const dotColor = stageColors[stage];
              const isGrayed = failedStage === 'VALIDATE' && stage !== 'VALIDATE' && stage !== 'INGEST';

              return (
                <div key={stage} className="relative z-10 flex flex-col items-center gap-1.5">
                  <StageDot
                    color={isGrayed ? '#1E1E2E' : dotColor}
                    state={dotState}
                    size={8}
                  />
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wider"
                    style={{
                      color: isGrayed
                        ? '#6B7280'
                        : dotState === 'active' || dotState === 'completed' || dotState === 'failed'
                          ? dotColor
                          : '#6B7280',
                    }}
                  >
                    {STAGE_LABEL_NAMES[stage]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="w-full h-1 rounded-full bg-bg-elevated overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: failedStage === 'VALIDATE'
                  ? 'linear-gradient(to right, #3B82F6, #F59E0B, #EF4444)'
                  : 'linear-gradient(to right, #3B82F6, #F59E0B, #22C55E, #8B5CF6, #F97316)',
              }}
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3, ease: 'linear' }}
            />
          </div>
        </div>

        {/* Current record info */}
        {currentRecord && (
          <div className="px-2 py-2 bg-bg-primary rounded-md border border-border-default">
            <div className="text-[10px] text-muted uppercase tracking-wider mb-1">PROCESSING</div>
            <div className="text-[11px] font-mono text-text-primary truncate">
              {currentRecord.reference || 'UNKNOWN REF'}
            </div>
            <div className="text-[10px] text-text-secondary truncate">
              {currentRecord.brand || 'Unknown Brand'}
            </div>
          </div>
        )}

        {/* Stage Log Panel */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="text-[10px] text-muted uppercase tracking-wider mb-2 px-1">STAGE LOG</div>
          <div className="flex-1 overflow-y-auto bg-bg-primary rounded-md border border-border-default p-2" style={{ scrollbarWidth: 'thin' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {stageMessages.map((msg, index) => (
                <motion.div
                  key={`${msg.stage}-${msg.timestamp}-${index}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mb-1.5"
                >
                  <span className="text-[10px] text-muted font-mono">[{msg.timestamp}]</span>{' '}
                  <span
                    className="text-[10px] font-semibold uppercase"
                    style={{ color: stageColors[msg.stage] || '#9CA3AF' }}
                  >
                    {msg.stage}
                  </span>
                  <span className="text-[10px] text-text-secondary">: {msg.message}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {stageMessages.length === 0 && (
              <div className="text-[11px] text-muted text-center py-4">Pipeline ready. Waiting for data...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
