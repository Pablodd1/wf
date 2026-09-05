export type StageName = 'INGEST' | 'VALIDATE' | 'NORMALIZE' | 'ENRICH' | 'ML_SCORE';

export type FailureFlag = string;

export interface PipelineStage {
  name: StageName;
  status: 'pending' | 'active' | 'completed' | 'failed';
  message: string;
  timestamp: number;
}

export interface WatchRecord {
  id: string;
  source: 'whatsapp' | 'websocket' | 'csv';
  rawMessage: string;
  timestamp: string;
  brand: string;
  reference: string;
  family: string;
  price: number;
  originalPrice: number;
  originalCurrency: string;
  dialColor: string;
  condition: string;
  hasBox: boolean;
  hasPapers: boolean;
  year: number | null;
  sellerRating: number;
  daysOnMarket: number;
  confidence: number;
  mlPredictedPrice: number;
  priceVariance: number;
  demandForecast: string;
  outcomeClassification: string;
  marketComparables: number;
  processingTime: number;
  pipelineLog: PipelineStage[];
  isResidue: boolean;
  failureFlags: string[];
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  imageUrl?: string | null;
  imageCount?: number;
  imageConfirmed?: boolean;
  autoResolvedFlags?: string[];
  buyerCount?: number;
  sellerCount?: number;
  buyerSellerRatio?: number;
  liquidityScore?: number;
  description?: string;
}

export interface DashboardState {
  records: WatchRecord[];
  currentTheaterRecord: WatchRecord | null;
  theaterStage: number;
  filters: {
    search: string;
    brands: string[];
    priceMin: number;
    priceMax: number;
    conditions: string[];
    currencies: string[];
    confidenceMin: number;
  };
  stats: {
    totalProcessed: number;
    normalizedCount: number;
    residueCount: number;
    throughputRate: number;
    avgLatency: number;
    accuracyRate: number;
    mlAvgTime: number;
    residueRate: number;
  };
  selectedRecord: WatchRecord | null;
  detailModalOpen: boolean;
  editModalOpen: boolean;
  editingRecord: WatchRecord | null;
  residueBinOpen: boolean;
}
