const { callKimi } = require('./api/_lib/kimi.cjs');
async function test() {
  const systemPrompt = `You are an expert luxury watch cataloging assistant. Analyze the provided raw message and extract:
- reference: The clean, uppercase reference number.
- brand: The standardized brand name.
- dialColor: The dial color (e.g., 'Green', 'Silver', 'White').
- condition: Standardized condition (e.g., 'New', 'Unworn', 'Used').
- year: The 4-digit year of the watch (if mentioned).

Rules:
1. If the brand is omitted, return null. Catalog reconciliation may validate the reference later.
4. Do not infer dial from a reference suffix. Return null unless the raw message states the dial.

Respond ONLY with a valid JSON object matching this structure:
{
  "reference": "string | null",
  "brand": "string | null",
  "dialColor": "string | null",
  "condition": "string | null",
  "year": "number | null"
}`;
  const res = await callKimi([
    {role: 'system', content: systemPrompt},
    {role: 'user', content: 'Omega 210.32.42.20.01.001 full set 2023y'}
  ]);
  console.log(res);
}
test().catch(console.error);
