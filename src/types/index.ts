export interface WatchRecord {
  id?: string;
  reference: string;
  brand: string;
  family?: string;
  price: number;
  originalPrice: number;
  originalCurrency: string;
  condition: string;
  year?: number;
  dialColor: string;
  confidence?: number;
  demandForecast?: string;
  buyerCount?: number;
  sellerCount?: number;
  buyerSellerRatio?: number;
  liquidityScore?: number;
  mlPredictedPrice?: number;
  imageUrl?: string;
  imageConfirmed?: boolean;
  hasBox?: boolean;
  hasPapers?: boolean;
  sellerRating?: number;
  status?: string;
  verdict?: Verdict;
  createdAt?: string;
  updatedAt?: string;
  source?: string;
  rawMessage?: string;
  // Outlier / pipeline fields
  isResidue?: boolean;
  priceVariance?: number;
  failureFlags?: string[];
  outcomeClassification?: string;
  marketComparables?: number;
  autoResolvedFlags?: string[];
  // Parser metadata
  parser_version?: string;
  field_confidence?: Record<string, number>;
  // Listing type
  listing_type?: 'WTS' | 'WTB' | 'WTT' | 'GARBAGE';
}

export type Verdict = 'APPROVED' | 'REVIEW' | 'HUMAN' | 'RECYCLE';

export interface DashboardStats {
  totalRecords: number;
  approvedRate: number;
  humanReview: number;
  recycled: number;
  avgPrice: number;
  avgConfidence: number;
  brandDistribution: BrandStat[];
  confidenceDistribution: ConfidenceBin[];
  priceDistribution: PriceBin[];
  dailyTrends: DailyTrend[];
  topReferences: ReferenceStat[];
}

export interface BrandStat {
  brand: string;
  count: number;
  percentage: number;
}

export interface ConfidenceBin {
  range: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface PriceBin {
  range: string;
  min: number;
  max: number;
  count: number;
}

export interface DailyTrend {
  date: string;
  count: number;
  avgConfidence: number;
  avgPrice: number;
}

export interface ReferenceStat {
  reference: string;
  brand: string;
  count: number;
  avgPrice: number;
  avgConfidence: number;
}

export interface ReportCache {
  generatedAt: string;
  stats: DashboardStats;
  records: WatchRecord[];
}

export interface ParsedResult {
  reference: string;
  brand: string;
  family: string;
  price: number;
  originalPrice: number;
  originalCurrency: string;
  condition: string;
  year: number;
  dialColor: string;
  confidence: number;
  verdict: Verdict;
  description: string;
  raw: string;
}

export interface ConditionDist {
  condition: string;
  count: number;
  percentage: number;
}

export interface CatalogMatchStat {
  matched: boolean;
  count: number;
  percentage: number;
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  target: string;
  status: 'success' | 'error' | 'pending';
  timestamp: string;
  details?: string;
}

export interface Insight {
  id: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  affectedReferences: string[];
  createdAt: string;
}

export interface DemandSignal {
  reference: string;
  brand: string;
  buyerCount: number;
  sellerCount: number;
  ratio: number;
  trend: 'up' | 'down' | 'stable';
  lastPrice: number;
  sentiment: number;
}
