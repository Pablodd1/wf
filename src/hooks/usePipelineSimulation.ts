import { useState, useEffect, useRef, useCallback } from 'react';
import type { WatchRecord, StageName } from '@/types';

export interface StageMessage {
  stage: StageName;
  message: string;
  timestamp: string;
}

export interface RawStreamMessage {
  id: string;
  source: 'whatsapp' | 'websocket' | 'csv';
  timestamp: string;
  text: string;
}

export interface ResultCard {
  id: string;
  type: 'normalized' | 'residue';
  record: WatchRecord;
  timestamp: string;
}

const STAGE_COLORS: Record<StageName, string> = {
  INGEST: '#3B82F6',
  VALIDATE: '#F59E0B',
  NORMALIZE: '#22C55E',
  ENRICH: '#8B5CF6',
  ML_SCORE: '#F97316',
};

function formatTime(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function generateStageMessage(stage: StageName, record: WatchRecord, failed: boolean = false): string {
  const messages: Record<StageName, string> = {
    INGEST: `Received ${record.source} message from dealer — ${record.rawMessage.slice(0, 40)}...`,
    VALIDATE: failed
      ? `FAILED — ${record.failureFlags?.join(', ') || 'Validation error'}`
      : `Reference ${record.reference || 'UNKNOWN'} matched against catalog`,
    NORMALIZE: `Price normalized to USD ${record.price?.toLocaleString() || 'N/A'}`,
    ENRICH: `Added market comparables (n=${record.marketComparables || 0})`,
    ML_SCORE: `Confidence ${record.confidence != null ? record.confidence.toFixed(0) : 'N/A'}% — ${record.outcomeClassification || 'UNKNOWN'} classification`,
  };
  return messages[stage] || `${stage}: Processing...`;
}

export interface UsePipelineSimulationReturn {
  currentRecord: WatchRecord | null;
  activeStage: StageName | null;
  completedStages: StageName[];
  stageMessages: StageMessage[];
  rawStreamMessages: RawStreamMessage[];
  resultCards: ResultCard[];
  isProcessing: boolean;
  failedStage: StageName | null;
  stageColors: typeof STAGE_COLORS;
  progress: number;
}

export function usePipelineSimulation(records: WatchRecord[]): UsePipelineSimulationReturn {
  const [currentRecord, setCurrentRecord] = useState<WatchRecord | null>(null);
  const [activeStage, setActiveStage] = useState<StageName | null>(null);
  const [completedStages, setCompletedStages] = useState<StageName[]>([]);
  const [stageMessages, setStageMessages] = useState<StageMessage[]>([]);
  const [rawStreamMessages, setRawStreamMessages] = useState<RawStreamMessage[]>([]);
  const [resultCards, setResultCards] = useState<ResultCard[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [failedStage, setFailedStage] = useState<StageName | null>(null);
  const [progress, setProgress] = useState(0);

  const recordIndexRef = useRef(0);
  const cycleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearStageTimeouts = useCallback(() => {
    stageTimeoutsRef.current.forEach((t) => clearTimeout(t));
    stageTimeoutsRef.current = [];
    if (cycleTimeoutRef.current) {
      clearTimeout(cycleTimeoutRef.current);
      cycleTimeoutRef.current = null;
    }
  }, []);

  // Process one record through the pipeline
  const processRecord = useCallback((record: WatchRecord) => {
    clearStageTimeouts();
    setIsProcessing(true);
    setCurrentRecord(record);
    setActiveStage(null);
    setCompletedStages([]);
    setStageMessages([]);
    setFailedStage(null);
    setProgress(0);

    // Add to raw stream
    const now = new Date();
    const rawMsg: RawStreamMessage = {
      id: `${record.id}-${now.getTime()}`,
      source: record.source,
      timestamp: formatTime(now),
      text: record.rawMessage,
    };
    setRawStreamMessages((prev) => [rawMsg, ...prev].slice(0, 15));

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // INGEST at T+0.0s
    timeouts.push(
      setTimeout(() => {
        setActiveStage('INGEST');
        setProgress(0);
        setStageMessages((prev) => [
          ...prev,
          { stage: 'INGEST', message: generateStageMessage('INGEST', record), timestamp: formatTime(new Date()) },
        ]);
      }, 0)
    );

    // VALIDATE at T+0.3s
    timeouts.push(
      setTimeout(() => {
        const hasFlags = record.failureFlags && record.failureFlags.length > 0;
        setCompletedStages((prev) => [...prev, 'INGEST']);

        if (hasFlags) {
          setActiveStage('VALIDATE');
          setFailedStage('VALIDATE');
          setProgress(40);
          setStageMessages((prev) => [
            ...prev,
            { stage: 'VALIDATE', message: generateStageMessage('VALIDATE', record, true), timestamp: formatTime(new Date()) },
          ]);

          // Add residue card at T+0.8s
          timeouts.push(
            setTimeout(() => {
              const resCard: ResultCard = {
                id: `res-${record.id}-${Date.now()}`,
                type: 'residue',
                record,
                timestamp: formatTime(new Date()),
              };
              setResultCards((prev) => [resCard, ...prev].slice(0, 8));
              setStageMessages((prev) => [
                ...prev,
                { stage: 'VALIDATE', message: 'ROUTED TO RESIDUE', timestamp: formatTime(new Date()) },
              ]);
              setIsProcessing(false);
            }, 500)
          );
        } else {
          setActiveStage('VALIDATE');
          setProgress(25);
          setStageMessages((prev) => [
            ...prev,
            { stage: 'VALIDATE', message: generateStageMessage('VALIDATE', record), timestamp: formatTime(new Date()) },
          ]);
        }
      }, 300)
    );

    // If not residue, continue pipeline
    if (!record.failureFlags || record.failureFlags.length === 0) {
      // NORMALIZE at T+0.6s
      timeouts.push(
        setTimeout(() => {
          setCompletedStages((prev) => [...prev, 'VALIDATE']);
          setActiveStage('NORMALIZE');
          setProgress(45);
          setStageMessages((prev) => [
            ...prev,
            { stage: 'NORMALIZE', message: generateStageMessage('NORMALIZE', record), timestamp: formatTime(new Date()) },
          ]);
        }, 600)
      );

      // ENRICH at T+1.0s
      timeouts.push(
        setTimeout(() => {
          setCompletedStages((prev) => [...prev, 'NORMALIZE']);
          setActiveStage('ENRICH');
          setProgress(65);
          setStageMessages((prev) => [
            ...prev,
            { stage: 'ENRICH', message: generateStageMessage('ENRICH', record), timestamp: formatTime(new Date()) },
          ]);
        }, 1000)
      );

      // ML_SCORE at T+1.4s
      timeouts.push(
        setTimeout(() => {
          setCompletedStages((prev) => [...prev, 'ENRICH']);
          setActiveStage('ML_SCORE');
          setProgress(85);
          setStageMessages((prev) => [
            ...prev,
            { stage: 'ML_SCORE', message: generateStageMessage('ML_SCORE', record), timestamp: formatTime(new Date()) },
          ]);
        }, 1400)
      );

      // COMPLETE at T+1.8s
      timeouts.push(
        setTimeout(() => {
          setCompletedStages((prev) => [...prev, 'ML_SCORE']);
          setActiveStage(null);
          setProgress(100);
          const normCard: ResultCard = {
            id: `norm-${record.id}-${Date.now()}`,
            type: 'normalized',
            record,
            timestamp: formatTime(new Date()),
          };
          setResultCards((prev) => [normCard, ...prev].slice(0, 8));
          setIsProcessing(false);
        }, 1800)
      );
    }

    stageTimeoutsRef.current = timeouts;
  }, [clearStageTimeouts]);

  // Main cycle: pick a new record every 3 seconds
  useEffect(() => {
    if (records.length === 0) return;

    let isActive = true;

    const startCycle = () => {
      if (!isActive) return;

      const idx = recordIndexRef.current % records.length;
      const record = records[idx];
      recordIndexRef.current += 1;

      processRecord(record);

      cycleTimeoutRef.current = setTimeout(startCycle, 3000);
    };

    // Start after a small initial delay
    const initialDelay = setTimeout(startCycle, 500);

    return () => {
      isActive = false;
      clearTimeout(initialDelay);
      clearStageTimeouts();
    };
  }, [records, processRecord, clearStageTimeouts]);

  return {
    currentRecord,
    activeStage,
    completedStages,
    stageMessages,
    rawStreamMessages,
    resultCards,
    isProcessing,
    failedStage,
    stageColors: STAGE_COLORS,
    progress,
  };
}
