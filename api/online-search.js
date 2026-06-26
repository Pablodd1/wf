/**
 * ONLINE WATCH SEARCH ENDPOINT
 * POST /api/online-search
 *
 * Multi-tier watch reference lookup:
 *   1. Try GPT-4o-mini (OpenAI) — primary, structured JSON output
 *   2. Fall back to OpenRouter free models (Gemma 4, Nemotron, etc.)
 *   3. Fall back to Anthropic Claude Haiku (if OpenRouter fails)
 *
 * Triggers when:
 *   - Catalog miss (no record in enriched_refs.json)
 *   - LLM confidence < 70%
 *   - Reference is new/unusual (Cubitus 7128/1G, new releases, etc.)
 *
 * Body: { reference: string, brand?: string, rawMessage?: string }
 * Returns: { success, brand, reference, model, collection, year, caseMaterial,
 *            dialColors, priceRange, source, confidence, providers_tried, total_cost_usd }
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are a luxury watch research expert with web search knowledge. When given a watch reference number (and optionally a brand), find the canonical specifications for that watch.

Return ONLY valid JSON with these fields (no markdown):
{
  "brand": "Manufacturer name (Rolex, Patek Philippe, etc.)",
  "reference": "Canonical reference (clean, normalized form)",
  "model": "Model name (e.g., 'Submariner Date', 'Nautilus')",
  "collection": "Collection (e.g., 'Submariner', 'Nautilus', 'Cubitus')",
  "year": "Production year(s) if known",
  "caseMaterial": "Case material",
  "dialColors": "Available dial colors (comma-separated)",
  "priceRange": "Estimated retail or market price (USD)",
  "confidence": 0-100 (how confident you are in this identification),
  "notes": "Any relevant details (special edition, discontinued, etc.)"
}

If you cannot find information, set confidence to a low number and explain in notes.`;

async function callOpenAI(reference, brand, rawMessage, apiKey) {
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: brand
            ? `Look up the watch: ${brand} ${reference}. Raw dealer message: "${rawMessage || 'N/A'}"`
            : `Look up this watch reference: ${reference}. Raw dealer message: "${rawMessage || 'N/A'}"`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 600,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { error: 'parse failed' };
  }
  return {
    ...parsed,
    provider: 'openai/gpt-4o-mini',
    tokens: data.usage?.total_tokens || 0,
    cost_usd: ((data.usage?.total_tokens || 0) / 1000000) * 0.30,
  };
}

async function callOpenRouter(reference, brand, rawMessage, apiKey) {
  // Try a free Gemini model first (best for structured tasks), then Gemma, then Llama
  const models = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-4-27b-a4b-it:free',
    'qwen/qwen-2.5-72b-instruct:free',
  ];
  for (const model of models) {
    try {
      const resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://watchfacts-poc.vercel.app',
          'X-Title': 'WatchFacts POC',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: brand
                ? `Look up: ${brand} ${reference}. Message: "${rawMessage || 'N/A'}"`
                : `Look up: ${reference}. Message: "${rawMessage || 'N/A'}"`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 600,
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        if (resp.status === 404 || resp.status === 429) {
          console.warn(`[openrouter] ${model} not available: ${err.slice(0, 100)}`);
          continue;  // try next model
        }
        throw new Error(`OpenRouter ${resp.status}: ${err.slice(0, 200)}`);
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      let parsed;
      try { parsed = JSON.parse(content); }
      catch (e) {
        const m = content.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : { error: 'parse failed' };
      }
      return {
        ...parsed,
        provider: `openrouter/${model}`,
        tokens: data.usage?.total_tokens || 0,
        cost_usd: 0,  // free model
      };
    } catch (e) {
      console.warn(`[openrouter] ${model} failed:`, e.message.slice(0, 100));
      continue;
    }
  }
  throw new Error('All OpenRouter free models failed');
}

async function callAnthropic(reference, brand, rawMessage, apiKey) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: brand
          ? `Look up: ${brand} ${reference}. Message: "${rawMessage || 'N/A'}"`
          : `Look up: ${reference}. Message: "${rawMessage || 'N/A'}"`,
      }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.content?.[0]?.text || '{}';
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { error: 'parse failed' };
  }
  return {
    ...parsed,
    provider: 'anthropic/claude-haiku-4.5',
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    cost_usd: ((data.usage?.input_tokens || 0) * 1.00 + (data.usage?.output_tokens || 0) * 5.00) / 1000000,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── P0-D: Allow GET with query params (e.g. ?reference=5712/1A&brand=Patek+Philippe) ──
  let reference, brand, rawMessage;
  if (req.method === 'GET') {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    reference = url.searchParams.get('reference');
    brand = url.searchParams.get('brand');
    rawMessage = url.searchParams.get('rawMessage');
  } else if (req.method === 'POST') {
    ({ reference, brand, rawMessage } = req.body || {});
  } else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!reference || typeof reference !== 'string') {
    return res.status(400).json({ error: 'reference field required' });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const providersTried = [];
  let totalCost = 0;
  let result = null;
  let primaryError = null;

  // Tier 1: OpenAI GPT-4o-mini (most reliable, structured output)
  if (openaiKey) {
    try {
      result = await callOpenAI(reference, brand, rawMessage, openaiKey);
      providersTried.push('openai');
      totalCost += result.cost_usd;
    } catch (e) {
      primaryError = e.message;
      console.warn('[online-search] OpenAI failed:', e.message);
    }
  }

  // Tier 2: OpenRouter free models (no cost)
  if (!result && openrouterKey) {
    try {
      result = await callOpenRouter(reference, brand, rawMessage, openrouterKey);
      providersTried.push('openrouter');
      totalCost += result.cost_usd || 0;
    } catch (e) {
      console.warn('[online-search] OpenRouter failed:', e.message);
    }
  }

  // Tier 3: Anthropic Claude Haiku (cheap, high quality)
  if (!result && anthropicKey) {
    try {
      result = await callAnthropic(reference, brand, rawMessage, anthropicKey);
      providersTried.push('anthropic');
      totalCost += result.cost_usd;
    } catch (e) {
      console.warn('[online-search] Anthropic failed:', e.message);
    }
  }

  if (!result) {
    return res.status(500).json({
      success: false,
      error: 'All providers failed',
      providers_tried: providersTried,
      last_error: primaryError,
    });
  }

  // Slightly discount confidence when using fallback providers
  let finalConfidence = result.confidence || 50;
  if (providersTried[0] !== 'openai') {
    finalConfidence = Math.max(0, finalConfidence - 10);
  }

  return res.status(200).json({
    success: true,
    query: `${brand || ''} ${reference}`.trim(),
    ...result,
    confidence: finalConfidence,
    providers_tried: providersTried,
    total_cost_usd: totalCost,
  });
};
