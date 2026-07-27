/** Server-side, reviewer-authorized image comparison. No AI key or image bytes enter the browser. */

export interface VerifyImageResult {
  success: boolean;
  verdict: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  flag: 'IMAGE_MISMATCH' | null;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
  textReference?: string;
  checks?: {
    reference: 'AGREES' | 'CONFLICT' | 'PARTIAL' | 'NOT_VISIBLE';
    brand: 'AGREES' | 'CONFLICT' | 'NOT_VISIBLE';
    model: 'CONSISTENT' | 'CHECK_MANUALLY' | 'NOT_VISIBLE';
    dial: 'CONSISTENT' | 'CHECK_MANUALLY' | 'NOT_VISIBLE';
  };
  image?: {
    brand: string;
    referenceVisible: string;
    modelGuess: string;
    dialColor: string;
    legible: boolean;
    confidence: number;
    notes: string;
  };
  source?: 'gemini' | 'kimi';
  policy?: string;
  error?: string;
}

export async function verifyImageReference(
  imageUrl: string,
  reference: string,
  brand?: string,
  dialColor?: string,
  model?: string,
): Promise<VerifyImageResult> {
  try {
    const response = await fetch('/api/verify-image', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, reference, brand, dialColor, model }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, verdict: 'UNVERIFIED', flag: null, severity: 'INFO', reason: data.error || `HTTP ${response.status}`, error: data.error };
    }
    return data as VerifyImageResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image review assistance failed';
    return { success: false, verdict: 'UNVERIFIED', flag: null, severity: 'INFO', reason: message, error: message };
  }
}
