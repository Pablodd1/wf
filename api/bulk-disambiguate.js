/**
 * BULK DISAMBIGUATION ENDPOINT
 * POST /api/bulk-disambiguate
 *
 * Uses GPT-4o-mini to batch-disambiguate partial references.
 * Processes 20 records per API call to minimize cost.
 *
 * POST body:
 *   { records: [{ id, reference, brand, dial, source? }], useWebSearch?: bool }
 *
 * Returns:
 *   { resolved: [{ id, originalRef, resolvedRef, model, year, confidence, notes }] }
 *
 * Cost: ~$0.001 per 20 records (gpt-4o-mini @ $0.15/1M input)
 */

const BATCH_SIZE = 20;
const MAX_RECORDS = 100;
const { requireServiceToken } = require('./_lib/require-service-token.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireServiceToken(req, res)) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not set in Vercel env' });
  }

  const { records = [], useWebSearch = false } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }
  if (records.length > MAX_RECORDS) return res.status(413).json({ error: `Maximum ${MAX_RECORDS} records per request` });

  // Split into batches
  const batches = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push(records.slice(i, i + BATCH_SIZE));
  }

  // Process all batches in PARALLEL (with concurrency limit)
  const CONCURRENCY = 5; // OpenAI rate limits: ~500 RPM on tier 1
  const systemPrompt = useWebSearch
    ? `You are a luxury watch expert. For each partial/ambiguous reference below, identify the most likely complete reference using your knowledge. Watch naming conventions:
- Rolex 126xxx/116xxx = 6-digit + 1-4 letter suffix (e.g., 126610LV = Submariner Date)
- Rolex suffix: LN=Black, LV=Green, LB=Blue, BLNR=Batman, BLRO=Pepsi
- Patek 5xxx/xxxx = 4-digit + slash + 1-4 letters (e.g., 5712/1A = Nautilus Moon Phase)
- Patek 5270P = Annual Calendar Chronograph Platinum, 5167A = Steel Annual Calendar
- RM 11-01/02/03/04 = Felipe Massa editions (RM 11-03 most common 2024)
- RM 67-01/02 = Sprint ladies editions
- AP 15500ST, 15510ST, 16202ST = Royal Oak variants
- VC 336xxx = Overseas

Return JSON object with "results" array. Each entry: { "id": "...", "resolved_ref": "5712/1A", "model": "Nautilus Moon Phase", "year": 2024, "confidence": 0.95, "notes": "..." }
If already complete and correct, set confidence=1.0.`
    : `You are a luxury watch expert. For each partial/ambiguous reference, identify the most likely canonical full reference. Use your training data only.

Return JSON object with "results" array. Each entry: { "id": "...", "resolved_ref": "5712/1A", "model": "Nautilus Moon Phase", "year": 2024, "confidence": 0.95, "notes": "..." }
If reference is already complete, set confidence=1.0.`;

  async function processBatch(batch, batchIdx) {
    try {
      const inputData = batch.map(r => ({
        id: r.id,
        reference: r.reference,
        brand: r.brand,
        dial: r.dial || null,
        occurrences: r.occurrences || null,
      }));

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(inputData) },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { batchIdx, error: `OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}`, results: [] };
      }

      const data = await resp.json();
      const tokens = data.usage?.total_tokens || 0;
      const cost = ((data.usage?.prompt_tokens || 0) * 0.15 + (data.usage?.completion_tokens || 0) * 0.60) / 1_000_000;

      const content = data.choices?.[0]?.message?.content || '{}';
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        return { batchIdx, error: `JSON parse: ${content.slice(0, 200)}`, results: [], tokens, cost };
      }

      let results = [];
      if (Array.isArray(parsed)) {
        results = parsed;
      } else {
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) {
            results = parsed[key];
            break;
          }
        }
      }

      const mapped = results.map(r => ({
        id: r.id,
        originalRef: batch.find(b => b.id === r.id)?.reference,
        resolvedRef: r.resolved_ref || r.reference || r.ref || r.resolvedRef,
        model: r.model || null,
        year: r.year || null,
        confidence: r.confidence || 0,
        notes: r.notes || '',
      }));

      return { batchIdx, results: mapped, tokens, cost, error: null };
    } catch (e) {
      return { batchIdx, error: e.message, results: [] };
    }
  }

  // Run with limited concurrency
  const allResults = [];
  let totalTokens = 0;
  let totalCost = 0;
  const errors = [];

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const window = batches.slice(i, i + CONCURRENCY);
    const windowResults = await Promise.all(
      window.map((batch, idx) => processBatch(batch, i + idx))
    );
    for (const r of windowResults) {
      totalTokens += r.tokens || 0;
      totalCost += r.cost || 0;
      allResults.push(...r.results);
      if (r.error) errors.push({ batch: r.batchIdx, error: r.error });
    }
  }

  return res.status(200).json({
    success: true,
    total: records.length,
    resolved: allResults.length,
    errors: errors.length,
    totalTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000,
    resolved_records: allResults,
    errors_detail: errors,
  });
};
