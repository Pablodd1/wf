/**
 * Gap Detection + Confidence Routing Engine
 * Implements the exact scheme from the screenshot:
 * 
 * Catalog Match         | AI Intervention      | Confidence | Action
 * ----------------------|----------------------|------------|-------------------
 * Everything found      | None                 | 100%       | Auto-approve
 * 1 thing missing       | AI fills 1 gap       | 90%        | Review suggested
 * 2 things missing      | AI fills 2 gaps      | 80%        | Must review
 * 3+ missing / garbage  | AI can't resolve     | <80%       | Manual intervention
 */

// Fields that can be checked against catalog
const CATALOG_FIELDS = ['brand', 'reference', 'dialColor', 'condition', 'year', 'price'];

/**
 * Detect gaps between parsed record and catalog entry
 * Returns: { gaps: string[], gapCount: number, filled: Record<string,any> }
 */
function detectGaps(parsed, catalogEntry) {
  const gaps = [];
  const filled = { ...parsed };

  if (!parsed.dialColor && catalogEntry?.dialColor) {
    gaps.push('dialColor');
    filled.dialColor = catalogEntry.dialColor; // Auto-fill from catalog
  }
  if (!parsed.condition) {
    gaps.push('condition');
  }
  if (!parsed.year) {
    gaps.push('year');
  }
  if (!parsed.price && !parsed.priceUSD) {
    gaps.push('price');
  }
  if (!parsed.boxPapers) {
    gaps.push('boxPapers');
  }

  return { gaps, gapCount: gaps.length, filled };
}

/**
 * AI Gap Filler — simulates AI filling missing fields
 * In production, this calls DeepSeek/GPT-4
 */
async function aiFillGaps(parsed, gaps) {
  const filled = { ...parsed };
  const aiNotes = [];

  for (const gap of gaps) {
    switch (gap) {
      case 'condition':
        // Infer from price: high price → New, low price → Used
        if (parsed.priceUSD > 50000) {
          filled.condition = 'New';
          aiNotes.push('Condition inferred as "New" from price point');
        } else {
          filled.condition = 'Used';
          aiNotes.push('Condition inferred as "Used" from price point');
        }
        break;
      case 'year':
        // Default to current year minus 1 for used watches
        filled.year = filled.condition === 'New' ? 2026 : 2024;
        aiNotes.push(`Year estimated as ${filled.year}`);
        break;
      case 'boxPapers':
        filled.boxPapers = 'Unknown';
        aiNotes.push('Box/papers status unknown');
        break;
      case 'price':
        // Can't fill price — this is a WTB message
        filled.price = 0;
        filled.currency = 'USD';
        aiNotes.push('Price not specified — may be WTB inquiry');
        break;
    }
  }

  return { filled, aiNotes };
}

/**
 * Route by catalog match + gap count
 * Returns: { confidence, verdict, action, aiNeeded, gaps, aiNotes }
 */
async function routeByScheme(parsed, catalogResult) {
  const { gaps, gapCount, filled } = detectGaps(parsed, catalogResult?.data);

  // Tier 1: Everything found in catalog
  if (catalogResult?.tier === 1 && gapCount === 0) {
    return {
      confidence: 100,
      verdict: 'APPROVED',
      action: 'auto-approve',
      aiNeeded: false,
      gaps: [],
      aiNotes: ['Exact catalog match — all fields confirmed'],
      filled,
    };
  }

  // Tier 2: 1 thing missing — AI fills 1 gap
  if (gapCount === 1) {
    const aiResult = await aiFillGaps(filled, gaps);
    return {
      confidence: 90,
      verdict: 'REVIEW',
      action: 'review-suggested',
      aiNeeded: true,
      gaps,
      aiNotes: aiResult.aiNotes,
      filled: aiResult.filled,
    };
  }

  // Tier 3: 2 things missing — AI fills 2 gaps
  if (gapCount === 2) {
    const aiResult = await aiFillGaps(filled, gaps);
    return {
      confidence: 80,
      verdict: 'HUMAN',
      action: 'must-review',
      aiNeeded: true,
      gaps,
      aiNotes: aiResult.aiNotes,
      filled: aiResult.filled,
    };
  }

  // Tier 4: 3+ things missing or garbage
  if (gapCount >= 3 || !catalogResult || catalogResult.tier === 5) {
    return {
      confidence: Math.max(30, 70 - gapCount * 10),
      verdict: 'RECYCLE',
      action: 'manual-intervention',
      aiNeeded: false,
      gaps,
      aiNotes: [`${gapCount} fields missing — AI cannot reliably fill`, 'Requires manual review or discard'],
      filled,
    };
  }

  // Fallback
  return {
    confidence: parsed.confidence || 50,
    verdict: 'HUMAN',
    action: 'review',
    aiNeeded: false,
    gaps,
    aiNotes: ['Standard review queue'],
    filled,
  };
}

module.exports = {
  detectGaps,
  aiFillGaps,
  routeByScheme,
  CATALOG_FIELDS,
};
