/**
 * Client for /api/clean-analyze — individualized, fully-visible watch analysis.
 * Paste 1..N watch descriptions (text, text+URL, text+image, or several
 * watches at once). Each watch is returned with its full stage-by-stage
 * workflow plus a single-gate verdict (APPROVED / HUMAN / RECYCLE).
 */

export type Verdict = 'APPROVED' | 'HUMAN' | 'RECYCLE';
export type StageName = 'PARSE' | 'AI_TEXT' | 'ONLINE' | 'IMAGE';

export interface CleanStage {
  stage: StageName;
  engine: string;
  confidence: number;
  data?: Record<string, any>;
  verdict?: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  note?: string;
  error?: string;
}

export interface CleanParsed {
  reference: string | null;
  brand: string;
  dialColor: string | null;
  condition: string;
  year: number | null;
  price: number | null;
  currency: string | null;
}

export interface CleanWatch {
  input: string;
  parsed: CleanParsed;
  confidence: number;
  verdict: Verdict;
  reason: string;
  hasImage: boolean;
  hasLink: boolean;
  imageUrl: string | null;
  pageUrl: string | null;
  stages: CleanStage[];
}

export interface CleanSummary {
  total: number;
  approved: number;
  human: number;
  recycle: number;
  threshold: number;
}

export interface CleanResponse {
  success: boolean;
  summary: CleanSummary;
  watches: CleanWatch[];
  error?: string;
}

export async function cleanAnalyze(text: string, imageUrls?: string[]): Promise<CleanResponse> {
  try {
    const res = await fetch('/api/clean-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, imageUrls }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, summary: { total: 0, approved: 0, human: 0, recycle: 0, threshold: 85 }, watches: [], error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (e: any) {
    return { success: false, summary: { total: 0, approved: 0, human: 0, recycle: 0, threshold: 85 }, watches: [], error: e.message };
  }
}

/** Save a single CleanWatch result to Supabase via /api/ingest */
export async function saveCleanWatchToSupabase(watch: CleanWatch): Promise<{ success: boolean; persisted?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawMessage: watch.input,
        source: 'clean_page',
        channelId: 'manual',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }
    return { success: true, persisted: data.persisted > 0 };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
