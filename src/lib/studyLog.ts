/**
 * studyLog: persist each study entry to server + localStorage.
 * Provides cross-session memory so you can review your study history.
 */

const STORAGE_KEY = 'wf-study-history';

export interface StudyLogEntry {
  ts: string;
  sessionId: string;
  input: string;
  verdict: string;
  confidence: number;
  brand: string;
  reference: string;
  dialColor: string;
  price: number | null;
  currency: string;
}

let sessionId: string | null = null;
function getSessionId(): string {
  if (!sessionId) {
    sessionId = 'study-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }
  return sessionId;
}

/** Save entry to localStorage (always works) + fire-and-forget to server */
export async function saveStudyEntry(entry: { input: string; watch: any }): Promise<void> {
  const record: StudyLogEntry = {
    ts: new Date().toISOString(),
    sessionId: getSessionId(),
    input: entry.input.slice(0, 200),
    verdict: entry.watch.verdict,
    confidence: entry.watch.confidence,
    brand: entry.watch.parsed.brand,
    reference: entry.watch.parsed.reference,
    dialColor: entry.watch.parsed.dialColor,
    price: entry.watch.parsed.price,
    currency: entry.watch.parsed.currency,
  };

  // localStorage (permanent, cross-session)
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    existing.push(record);
    // Keep last 500 entries to not blow up localStorage
    if (existing.length > 500) existing.splice(0, existing.length - 500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    // localStorage full — silently truncate
  }

  // Server save (fire-and-forget)
  try {
    await fetch('/api/study-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry, sessionId: getSessionId() }),
    });
  } catch {
    // Server save is best-effort
  }
}

/** Load all study history from localStorage */
export function loadStudyHistory(): StudyLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/** Clear study history */
export function clearStudyHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
