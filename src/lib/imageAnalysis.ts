export interface ImageAnalysisResult {
  success: boolean;
  dialColor: string;
  confidence: number;
  brand: string | null;
  notes: string;
  raw?: string;
  error?: string;
}

export async function analyzeWatchImage(imageUrl: string, reference?: string): Promise<ImageAnalysisResult> {
  try {
    const res = await fetch('/api/analyze-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, reference }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return { success: false, dialColor: 'UNKNOWN', confidence: 0, brand: null, notes: '', error: err.error || `HTTP ${res.status}` };
    }

    return await res.json();
  } catch (e: any) {
    return { success: false, dialColor: 'UNKNOWN', confidence: 0, brand: null, notes: '', error: e.message };
  }
}

// Batch processor with rate limiting (1 req / 2 sec to avoid rate limits)
export async function batchAnalyzeImages(
  items: { id: string; imageUrl: string; reference?: string }[],
  onProgress?: (done: number, total: number, current: string) => void
): Promise<Record<string, ImageAnalysisResult>> {
  const results: Record<string, ImageAnalysisResult> = {};

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i, items.length, item.id);

    try {
      const result = await analyzeWatchImage(item.imageUrl, item.reference);
      results[item.id] = result;
    } catch (e: any) {
      results[item.id] = { success: false, dialColor: 'UNKNOWN', confidence: 0, brand: null, notes: '', error: e.message };
    }

    // Rate limit: wait 2 seconds between calls
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  onProgress?.(items.length, items.length, 'done');
  return results;
}
