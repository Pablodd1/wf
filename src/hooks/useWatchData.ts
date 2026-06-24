import { useState, useEffect } from 'react';
import type { WatchRecord, PipelineStage } from '@/types';
import { detectCurrency } from '@/lib/currency';
import { normalizeDialColor, normalizeReference } from '@/lib/catalog';

interface RawStageLog {
  stage: string;
  time: string;
  message: string;
}

interface RawRecord {
  id: string;
  hash: string;
  sourceType: string;
  sourceLine: string;
  brand: string;
  reference: string;
  family: string;
  dial?: string;
  dialColor?: string;
  condition: string;
  boxPapers: string;
  price: number;
  currency: string;
  priceUSD: number;
  year: number | null;
  seller: string;
  location: string;
  confidence: number;
  status: string;
  flags: string[];
  timestamp: string;
  mlPredictedPrice: number;
  mlPriceConfidence: number;
  mlDemandForecast: string;
  mlOutcomeClass: string;
  mlOutcomeConfidence: number;
  marketComparables: number;
  sellerRating: number;
  daysOnMarket: number;
  stageLogs: RawStageLog[];
  imageUrl?: string | null;
  imageCount?: number;
  imageConfirmed?: boolean;
  autoResolvedFlags?: string[];
  buyerCount?: number;
  sellerCount?: number;
  buyerSellerRatio?: number;
  liquidityScore?: number;
  isResidue?: boolean;
  description?: string;
}

interface EnrichedRef {
  reference: string;
  buyers: number;
  sellers: number;
  buyer_seller_ratio: number;
  liquidity_score: number;
  total_mentions: number;
}

function transformRecord(raw: RawRecord, enrichedMap: Map<string, EnrichedRef>): WatchRecord {
  // Map boxPapers string to booleans
  const bp = (raw.boxPapers || '').toLowerCase();
  const hasBox = bp.includes('full set') || bp.includes('box') || bp.includes('card');
  const hasPapers = bp.includes('full set') || bp.includes('papers') || bp.includes('card');

  // Map source type
  const sourceMap: Record<string, 'whatsapp' | 'websocket' | 'csv'> = {
    'WhatsApp': 'whatsapp',
    'WebSocket': 'websocket',
    'CSV': 'csv',
  };

  // Transform stage logs to pipeline stages
  const pipelineLog: PipelineStage[] = (raw.stageLogs || []).map((log, i) => {
    const status = log.stage === 'FAIL' ? 'failed' : 
                   i === raw.stageLogs.length - 1 ? 'completed' : 'completed';
    return {
      name: (log.stage === 'FAIL' ? 'VALIDATE' : log.stage) as PipelineStage['name'],
      status: status as PipelineStage['status'],
      message: log.message,
      timestamp: i,
    };
  });

  // Calculate severity
  let severity: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
  if (raw.flags?.some((f: string) => f === 'PRICE_OUTLIER')) {
    severity = 'CRITICAL';
  } else if (raw.flags?.some((f: string) => f === 'INCOMPLETE_REFERENCE' || f === 'YEAR_MISSING')) {
    severity = 'WARNING';
  }

  // Use enriched data if available, fallback to raw
  const enriched = enrichedMap.get(raw.reference);
  const buyerCount = enriched?.buyers ?? raw.buyerCount ?? 0;
  const sellerCount = enriched?.sellers ?? raw.sellerCount ?? 0;
  const buyerSellerRatio = enriched?.buyer_seller_ratio ?? raw.buyerSellerRatio ?? 0;
  const liquidityScore = enriched?.liquidity_score ?? raw.liquidityScore ?? 0;

  // Compute real seller rating proxy from liquidity + market presence
  // If no enriched data, use a lower score to indicate uncertainty
  let sellerRating = raw.sellerRating ?? 0;
  if (sellerRating === 0 || sellerRating === 4) {
    // Derive from liquidity score (0-100) mapped to 1-5 stars
    if (liquidityScore > 0) {
      sellerRating = Math.min(5, Math.max(1, Math.round(liquidityScore / 20)));
    } else if (buyerCount + sellerCount > 0) {
      sellerRating = Math.min(5, Math.max(1, Math.round((buyerCount + sellerCount) / 200)));
    } else {
      sellerRating = 0; // truly unknown
    }
  }

  // Use price directly since priceUSD is missing in the JSON
  const effectivePrice = raw.priceUSD || raw.price || 0;

  // Currency detection from raw message if price seems off or missing
  // Skip regex re-parse if priceUSD already present in data (col 5)
  let originalCurrency = raw.currency || 'USD';
  let originalPrice = raw.price || 0;
  let finalPrice = effectivePrice;
  // Only run expensive detectCurrency if priceUSD column is missing/zero
  if (finalPrice === 0 && raw.sourceLine) {
    const currencyInfo = detectCurrency(raw.sourceLine);
    if (currencyInfo && currencyInfo.usdAmount > 0) {
      originalCurrency = currencyInfo.currency;
      originalPrice = currencyInfo.originalAmount;
      finalPrice = currencyInfo.usdAmount;
    }
  }

  // Calculate price variance
  const priceVariance = finalPrice > 0 
    ? ((raw.mlPredictedPrice - finalPrice) / finalPrice) * 100 
    : 0;

  return {
    id: raw.id,
    source: sourceMap[raw.sourceType] || 'whatsapp',
    rawMessage: raw.sourceLine || '',
    timestamp: raw.timestamp || '',
    brand: raw.brand || 'Unknown',
    reference: normalizeReference(raw.reference || '', raw.brand),
    family: raw.family || 'Other',
    price: finalPrice,
    originalPrice: originalPrice,
    originalCurrency: originalCurrency,
    dialColor: normalizeDialColor(raw.dialColor || raw.dial || 'UNKNOWN'),
    condition: raw.condition || 'Unknown',
    hasBox,
    hasPapers,
    year: raw.year,
    sellerRating,
    daysOnMarket: raw.daysOnMarket || 0,
    confidence: raw.confidence || 0,
    mlPredictedPrice: raw.mlPredictedPrice || 0,
    priceVariance: Math.round(priceVariance * 100) / 100,
    demandForecast: raw.mlDemandForecast || 'STABLE',
    outcomeClassification: raw.mlOutcomeClass || 'HOLD',
    marketComparables: raw.marketComparables || 0,
    processingTime: raw.stageLogs ? raw.stageLogs.length * 300 : 1500,
    pipelineLog,
    isResidue: raw.isResidue ?? (raw.status === 'RESIDUE'),
    failureFlags: raw.flags || [],
    severity,
    imageUrl: raw.imageUrl || null,
    imageCount: raw.imageCount || 0,
    imageConfirmed: raw.imageConfirmed || false,
    autoResolvedFlags: raw.autoResolvedFlags || [],
    buyerCount,
    sellerCount,
    buyerSellerRatio,
    liquidityScore,
    description: raw.description || '',
  };
}

// Module-level cache so the 18MB dataset is fetched + transformed ONCE.
// Without this, every tab switch re-fetches & re-parses -> multi-second loading
// spinner on each navigation (looks like "the link doesn't work" on slow/mobile).
let _cache: WatchRecord[] | null = null;
let _cachePromise: Promise<WatchRecord[]> | null = null;

function loadWatchData(): Promise<WatchRecord[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;
  console.time('loadWatchData');
  
  // HYBRID APPROACH: Try Supabase API first (fast, paginated), fallback to JSON
  _cachePromise = (async () => {
    // Try Supabase API for first 1000 records (instant load)
    try {
      const statsResp = await fetch('/api/watch-data?stats=true');
      const stats = await statsResp.json();
      const totalCount = stats.total || 0;
      
      // Fetch first 3 pages (3000 records) from Supabase for immediate display
      const allData: any[] = [];
      for (let page = 1; page <= 3; page++) {
        const dataResp = await fetch(`/api/watch-data?page=${page}&limit=1000`);
        const dataJson = await dataResp.json();
        if (dataJson.data && dataJson.data.length > 0) {
          allData.push(...dataJson.data);
        }
        if (!dataJson.data || dataJson.data.length < 1000) break;
      }
      const dataJson = { data: allData };
      
      if (dataJson.data && dataJson.data.length > 0) {
        // Transform Supabase records to WatchRecord format
        const records: WatchRecord[] = dataJson.data.map((r: any) => ({
          id: r.id || '',
          source: 'whatsapp' as const,
          rawMessage: r.raw_message || r.title || '',
          timestamp: r.created_at || r.received_at || '',
          brand: r.brand || 'Unknown',
          reference: r.reference || r.normalized_reference || '',
          family: r.model || '',
          price: r.price_usd || r.price_raw || 0,
          originalPrice: r.price_raw || 0,
          originalCurrency: r.currency || 'USD',
          dialColor: r.dial_color || 'UNKNOWN',
          condition: r.condition || 'Unknown',
          hasBox: r.box === 'Yes',
          hasPapers: r.papers === 'Yes',
          year: r.year ?? null,
          sellerRating: 0,
          daysOnMarket: 0,
          confidence: r.confidence || 0,
          mlPredictedPrice: 0,
          priceVariance: 0,
          demandForecast: 'STABLE',
          outcomeClassification: 'HOLD',
          marketComparables: 0,
          processingTime: 0,
          pipelineLog: [],
          isResidue: r.verdict === 'RECYCLE' ? true : (r.verdict === 'HUMAN' ? false : false),
          failureFlags: r.flags || [],
          severity: r.verdict === 'RECYCLE' ? 'CRITICAL' : r.verdict === 'HUMAN' ? 'WARNING' : 'INFO',
          imageUrl: r.front_image ? `/images/${r.front_image}` : null,
          imageCount: r.front_image ? 1 : 0,
          imageConfirmed: false,
          autoResolvedFlags: [],
          buyerCount: 0,
          sellerCount: 0,
          buyerSellerRatio: 0,
          liquidityScore: 0,
          description: r.raw_message || '',
        }));
        
        _cache = records;
        console.timeEnd('loadWatchData');
        console.log(`Loaded ${records.length} records from Supabase (total: ${totalCount})`);
        return records;
      }
    } catch (e: any) {
      console.warn('Supabase API failed, falling back to JSON:', e);
    }
    
    // FALLBACK: Original JSON approach
    const [rawData, enrichedData] = await Promise.all([
      fetch('/parsedWatches.json').then((res) => {
        if (!res.ok) throw new Error(`parsedWatches.json HTTP ${res.status}`);
        return res.json();
      }),
      fetch('/enriched_refs.json').then((res) => {
        if (!res.ok) throw new Error(`enriched_refs.json HTTP ${res.status}`);
        return res.json();
      }).catch(() => [] as EnrichedRef[]),
    ]);
    
    let records: RawRecord[];
    if (Array.isArray(rawData) && rawData.length > 0 && Array.isArray(rawData[0])) {
      const rows = rawData as any[][];
      records = rows.map((row) => ({
        id: row[0], hash: '', sourceType: 'WhatsApp', sourceLine: row[8] || '',
        brand: row[1], reference: row[2], family: '', dialColor: row[3], condition: row[7],
        boxPapers: '', price: row[4], currency: row[6], priceUSD: row[5], year: row[12] ?? null,
        seller: '', location: '', confidence: row[9], status: row[10] || 'NORMALIZED', flags: row[11] || [],
        timestamp: '', mlPredictedPrice: 0, mlPriceConfidence: 0, mlDemandForecast: '',
        mlOutcomeClass: '', mlOutcomeConfidence: 0, marketComparables: 0, sellerRating: 0,
        daysOnMarket: 0, stageLogs: [], imageUrl: row[14] || null, imageCount: row[14] ? 1 : 0,
        imageConfirmed: false, autoResolvedFlags: [], buyerCount: 0, sellerCount: 0,
        buyerSellerRatio: 0, liquidityScore: 0, isResidue: row[10] === 'RECYCLE' || row[10] === 'RESIDUE' || row[10] === true,
        description: row[13] || row[8] || '',
      }));
    } else {
      records = rawData as RawRecord[];
    }
    const enrichedMap = new Map<string, EnrichedRef>();
    enrichedData.forEach((e: EnrichedRef) => { if (e.reference) enrichedMap.set(e.reference, e); });
    const transformed = records
      .map((r) => {
        try { return transformRecord(r, enrichedMap); }
        catch (e) { console.warn('Skipped malformed record', (r as any)?.id, e); return null; }
      })
      .filter((r): r is WatchRecord => r !== null);
    _cache = transformed;
    console.timeEnd('loadWatchData');
    return transformed;
  })();
  return _cachePromise;
}

export function useWatchData() {
  // If already cached, start non-loading with data in hand (instant tab switches).
  const [records, setRecords] = useState<WatchRecord[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_cache) { setRecords(_cache); setLoading(false); return; }
    let alive = true;

    // Progress simulation while the 20MB JSON downloads
    const progressTimer = setInterval(() => {
      setLoadProgress(p => Math.min(p + Math.random() * 8, 90));
    }, 200);

    loadWatchData()
      .then((data) => {
        if (alive) {
          clearInterval(progressTimer);
          setLoadProgress(100);
          setRecords(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          clearInterval(progressTimer);
          console.error('Failed to load watch data:', err);
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { alive = false; clearInterval(progressTimer); };
  }, []);

  const stats = {
    totalProcessed: records.length,
    normalizedCount: records.filter((r) => !r.isResidue).length,
    residueCount: records.filter((r) => r.isResidue).length,
    throughputRate: Math.round(records.length / 2.4),
    avgLatency: 45,
    accuracyRate: records.length > 0
      ? Math.round((records.filter((r) => !r.isResidue).length / records.length) * 100)
      : 0,
    mlAvgTime: 45,
    residueRate: records.length > 0
      ? Math.round((records.filter((r) => r.isResidue).length / records.length) * 100)
      : 0,
  };

  return { records, loading, error, stats, setRecords, loadProgress };
}
