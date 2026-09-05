import { memo } from 'react';
import { motion } from 'framer-motion';
import { usePipelineSimulation } from '@/hooks/usePipelineSimulation';
import { RawStreamColumn } from './RawStreamColumn';
import { AnalysisEngineColumn } from './AnalysisEngineColumn';
import { ResultsOutputColumn } from './ResultsOutputColumn';
import type { WatchRecord } from '@/types';

interface ProcessingTheaterProps {
  records: WatchRecord[];
  normalizedCount?: number;
  residueCount?: number;
}

export const ProcessingTheater = memo(function ProcessingTheater({
  records,
  normalizedCount = 0,
  residueCount = 0,
}: ProcessingTheaterProps) {
  const {
    currentRecord,
    activeStage,
    completedStages,
    stageMessages,
    rawStreamMessages,
    resultCards,
    isProcessing,
    failedStage,
    stageColors,
    progress,
  } = usePipelineSimulation(records);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] as [number, number, number, number], delay: 0.3 }}
      className="px-5 mt-4"
    >
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary mb-3">
        LIVE PROCESSING THEATER
      </h2>

      <div
        className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr_1fr] gap-3"
        style={{ minHeight: 520 }}
      >
        <RawStreamColumn messages={rawStreamMessages} />
        <AnalysisEngineColumn
          currentRecord={currentRecord}
          activeStage={activeStage}
          completedStages={completedStages}
          stageMessages={stageMessages}
          isProcessing={isProcessing}
          failedStage={failedStage}
          stageColors={stageColors}
          progress={progress}
        />
        <ResultsOutputColumn
          cards={resultCards}
          normalizedTotal={normalizedCount}
          residueTotal={residueCount}
        />
      </div>
    </motion.section>
  );
});
