/**
 * Levenshtein Distance Algorithm
 * Measures the minimum number of single-character edits
 * (insertions, deletions, substitutions) to transform string a into b.
 *
 * O(m*n) time, O(n) space
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows for O(n) space
  let prev: number[] = new Array(n + 1);
  let curr: number[] = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/** Normalized similarity score: 0.0 to 1.0 (1.0 = identical) */
export function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return 1.0 - dist / maxLen;
}
