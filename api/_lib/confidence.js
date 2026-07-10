/**
 * Phase 3: Confidence Scoring Engine
 * Multi-factor confidence calculation for real-time message routing
 * 
 * Factors:
 * 1. Catalog match quality (0-40 points)
 * 2. Price presence + format (0-30 points)
 * 3. Reference format validation (0-20 points)
 * 4. Brand detection (0-10 points)
 * 
 * Output: 0-100 confidence score used for auto-routing
 */

/**
 * Calculate confidence score for a parsed listing
 * @param {Object} parsed - Output from parser.parseFull()
 * @param {Object} catalogEntry - Catalog lookup result (or null)
 * @param {string} rawText - Original raw message text
 * @returns {{score: number, factors: Object, verdict: string}}
 */
function calculateConfidence(parsed, catalogEntry, rawText) {
  const factors = {};
  let totalScore = 0;

  // ─── FACTOR 1: Catalog Match (0-40 points) ────────────────────────
  let catalogScore = 0;
  if (catalogEntry) {
    // Exact reference match in catalog
    if (catalogEntry.reference && parsed.ref &&
        catalogEntry.reference.toUpperCase() === parsed.ref.toUpperCase()) {
      catalogScore = 40;
    } else if (catalogEntry.reference && parsed.ref &&
               catalogEntry.reference.toUpperCase().includes(parsed.ref.toUpperCase())) {
      catalogScore = 30; // Partial match
    } else {
      catalogScore = 20; // Brand match only
    }

    // Bonus for dial color match
    if (parsed.dial && catalogEntry.dialColor &&
        parsed.dial.toLowerCase() === catalogEntry.dialColor.toLowerCase()) {
      catalogScore = Math.min(40, catalogScore + 5);
    }
  } else {
    catalogScore = parsed.brand ? 10 : 0; // Brand detected but no catalog
  }
  factors.catalog = catalogScore;
  totalScore += catalogScore;

  // ─── FACTOR 2: Price Presence + Format (0-30 points) ───────────────
  let priceScore = 0;
  if (parsed.price) {
    const price = parsed.price;

    // Has explicit currency marker
    if (parsed.currency && ['USD', 'USDT', 'HKD', 'EUR', 'GBP', 'CHF'].includes(parsed.currency)) {
      priceScore += 10;
    }

    // Price is in a normal range for luxury watches
    if (price >= 500 && price <= 5000000) {
      priceScore += 15;
    } else if (price >= 100 && price <= 10000000) {
      priceScore += 10; // Slightly outside normal range
    } else {
      priceScore += 5; // Suspicious range
    }

    // Price has k/m suffix or commas (formatted)
    const priceStr = String(parsed.price);
    const rawLower = rawText.toLowerCase();
    if (/\d[kKmM]/.test(rawLower) || /,\d{3}/.test(priceStr)) {
      priceScore += 5;
    }
  } else {
    // No price — may be WTB or inquiry
    priceScore = 5;
  }
  factors.price = priceScore;
  totalScore += priceScore;

  // ─── FACTOR 3: Reference Format (0-20 points) ─────────────────────
  let refScore = 0;
  if (parsed.ref) {
    // Reference looks valid for known brands
    if (/^\d{5,6}[A-Z]{0,4}$/.test(parsed.ref)) {
      refScore = 20; // Classic Rolex/AP format
    } else if (/^\d{3,5}[A-Z]?\/?\d*[A-Z]?-?\d*$/.test(parsed.ref)) {
      refScore = 18; // Patek Philippe format
    } else if (/^\d{3,5}[A-Z]{2,4}$/.test(parsed.ref)) {
      refScore = 16; // Generic vendor format
    } else if (/^\d{4,6}$/.test(parsed.ref)) {
      refScore = 15; // Bare numeric
    } else if (parsed.ref.length >= 4 && /[A-Z0-9]/.test(parsed.ref)) {
      refScore = 10; // Contains letters and numbers
    } else {
      refScore = 5; // Suspicious format
    }
  } else {
    refScore = parsed.brand ? 5 : 0; // Has brand but no ref
  }
  factors.reference = refScore;
  totalScore += refScore;

  // ─── FACTOR 4: Brand Detection (0-10 points) ──────────────────────
  let brandScore = 0;
  if (parsed.brand) {
    const knownBrands = [
      'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille',
      'Omega', 'Cartier', 'IWC', 'Jaeger-LeCoultre', 'Vacheron Constantin',
      'Panerai', 'Hublot', 'TAG Heuer', 'Tudor', 'Breitling', 'Longines',
      'Grand Seiko', 'Zenith', 'Blancpain', 'Breguet', 'A. Lange & Sohne'
    ];
    brandScore = knownBrands.includes(parsed.brand) ? 10 : 7;
  }
  factors.brand = brandScore;
  totalScore += brandScore;

  // ─── FINAL VERDICT ────────────────────────────────────────────────
  let verdict;
  if (totalScore >= 85) {
    verdict = 'APPROVED';
  } else if (totalScore >= 50) {
    verdict = 'REVIEW';
  } else {
    verdict = 'HUMAN';
  }

  return {
    score: totalScore,
    maxScore: 100,
    factors,
    verdict,
    level: totalScore >= 85 ? 'HIGH' : totalScore >= 50 ? 'MEDIUM' : 'LOW'
  };
}

module.exports = { calculateConfidence };
