/**
 * SHARED REFERENCE RESOLVER — api/_lib/resolve.js
 *
 * Single source of truth for reference normalization + brand inference across
 * ALL price/catalog endpoints (catalog-models, catalog-references,
 * price-research). Prevents "resolver drift" — where two endpoints normalize a
 * reference slightly differently and a reference shown in the picker resolves to
 * a different reference (or none) in the detail view.
 *
 * normRef  : strip everything except A-Z0-9 (for KEYING/JOINING — indicators,
 *            catalog maps). Aggressive: 126710 BLRO / 126710-BLRO -> 126710BLRO.
 * normSlash: keep slashes (for Patek display refs like 5711/1A).
 * inferBrand: brand from reference prefix (mirrors price-research inline rules).
 */

function normRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normSlash(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9/\-]/g, '');
}

function inferBrand(ref) {
  if (!ref) return null;
  const raw = String(ref).trim().toUpperCase();
  // Omega references are commonly three or four digits followed by dotted
  // two-digit groups (for example 123.10.28.60.06.001). Detect the original
  // representation before normSlash intentionally removes punctuation.
  if (/^\d{3,4}(?:\.\d{2}){3,}\.\d{3}$/.test(raw)) return 'Omega';
  const r = normSlash(ref);
  // Dots are common in AP/Cartier/OEM refs — strip them for matching
  const rClean = r.replace(/\./g, '');
  // VC Overseas: 4-digit+V (4500V, 4300V, 6000V, 7900V) — before Patek catch-all
  if (/^(45|43|60|79)\d{2}V$/.test(r)) return 'Vacheron Constantin';
  // Patek: slash refs (5711/1A) or 4-digit+letter (5167A, 5236P) or bare 4-digit (3730 vintage)
  if (/^[3-7]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[3-7]\d{3}[A-Z]?$/.test(r)) return 'Patek Philippe';
  // AP: 5-digit+letters (15500ST, 26240OR, 15180OR...) — match first 5 digits + first letters
  if (/^\d{5}[A-Z]{2}/.test(rClean)) return 'Audemars Piguet';
  // Rolex: 5-6 digits + optional suffix
  if (/^\d{5,6}[A-Z]{0,4}$/.test(rClean)) return 'Rolex';
  // RM: RM + digits
  if (/^RM\d{2}/.test(rClean)) return 'Richard Mille';
  // IWC: IW + digits
  if (/^IW\d{4,6}$/i.test(rClean)) return 'IWC';
  // Cartier: W-prefix, CR-prefix, WG, HP, WE, WT
  if (/^(W|CR|WG|HP|WE|WT|WS)[A-Z0-9]{3,}/i.test(rClean)) return 'Cartier';
  // VC: 47xxx, 85xxx, 81xxx, 45xx, 43xx
  if (/^(85|47|49|81|82)\d{3}[A-Z/]/.test(rClean)) return 'Vacheron Constantin';
  // Tudor: 79xxxx, 70xxxx, M7xxxx (Black Bay GMT, Chronograph)
  if (/^(79|70)\d{4}[A-Z]*$/.test(rClean)) return 'Tudor';
  if (/^M7\d{4}[A-Z]*$/.test(rClean)) return 'Tudor';
  // Panerai: PAM + the zero-padded numeric reference used by reviewed releases.
  if (/^PAM\d{3,5}$/i.test(rClean)) return 'Panerai';
  // JLC: Q + 5-6 digits
  if (/^Q\d{5,6}$/i.test(rClean)) return 'Jaeger-LeCoultre';
  // Breitling: AB + digits
  if (/^(AB|A[123])\d{4}[A-Z]?$/i.test(rClean)) return 'Breitling';
  // Hublot: HUB patterns
  if (/^HUB\d{2}/.test(rClean)) return 'Hublot';
  return null;
}

module.exports = { normRef, normSlash, inferBrand };
