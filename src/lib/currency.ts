// Currency detection + normalization for watch chat messages
// Supports: USD, HKD, EUR, GBP, CHF, JPY, SGD, AUD, CAD

export interface CurrencyInfo {
  code: string;
  symbol: string;
  rateToUSD: number;
}

const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', symbol: '$', rateToUSD: 1.0 },
  { code: 'HKD', symbol: 'HK$', rateToUSD: 0.128 },
  { code: 'EUR', symbol: '€', rateToUSD: 1.08 },
  { code: 'GBP', symbol: '£', rateToUSD: 1.27 },
  { code: 'CHF', symbol: 'CHF', rateToUSD: 1.13 },
  { code: 'JPY', symbol: '¥', rateToUSD: 0.0066 },
  { code: 'SGD', symbol: 'S$', rateToUSD: 0.74 },
  { code: 'AUD', symbol: 'A$', rateToUSD: 0.65 },
  { code: 'CAD', symbol: 'C$', rateToUSD: 0.73 },
];

export function detectCurrency(rawMessage: string): { currency: string; originalAmount: number; usdAmount: number } | null {
  if (!rawMessage) return null;

  const text = rawMessage.replace(/,/g, '');
  const matches: { currency: string; amount: number; index: number }[] = [];

  // Pattern: symbol/abbreviation followed by number
  const symRegex = /(?:^|\s|\b)(HKD|HKS|HK\$|€|EUR|£|GBP|CHF|¥|JPY|S\$|SGD|A\$|AUD|C\$|CAD|US\$|\$)\s*([0-9\.]+(?:\s*[kK])?)/gi;
  let m: RegExpExecArray | null;
  while ((m = symRegex.exec(text)) !== null) {
    const sym = m[1].toUpperCase();
    const amtStr = m[2].toLowerCase();
    const multiplier = amtStr.includes('k') ? 1000 : 1;
    const amount = parseFloat(amtStr.replace(/k/i, '')) * multiplier;
    if (!isNaN(amount) && amount > 0) {
      matches.push({ currency: normalizeSymbol(sym), amount, index: m.index });
    }
  }

  // Pattern: number followed by symbol/abbreviation
  const numRegex = /([0-9\.]+(?:\s*[kK])?)\s*(HKD|HKS|HK\$|€|EUR|£|GBP|CHF|¥|JPY|S\$|SGD|A\$|AUD|C\$|CAD|US\$|\$)/gi;
  while ((m = numRegex.exec(text)) !== null) {
    const sym = m[2].toUpperCase();
    const amtStr = m[1].toLowerCase();
    const multiplier = amtStr.includes('k') ? 1000 : 1;
    const amount = parseFloat(amtStr.replace(/k/i, '')) * multiplier;
    if (!isNaN(amount) && amount > 0) {
      matches.push({ currency: normalizeSymbol(sym), amount, index: m.index });
    }
  }

  if (matches.length === 0) return null;

  // Prefer explicit non-USD if present (HK$500k vs $500k)
  const nonUsd = matches.find((x) => x.currency !== 'USD');
  const pick = nonUsd || matches[0];

  const info = CURRENCIES.find((c) => c.code === pick.currency);
  if (!info) return null;

  return {
    currency: pick.currency,
    originalAmount: Math.round(pick.amount),
    usdAmount: Math.round(pick.amount * info.rateToUSD),
  };
}

function normalizeSymbol(sym: string): string {
  const map: Record<string, string> = {
    'HK$': 'HKD', 'HKS': 'HKD', 'HKD': 'HKD',
    '€': 'EUR', 'EUR': 'EUR',
    '£': 'GBP', 'GBP': 'GBP',
    'CHF': 'CHF',
    '¥': 'JPY', 'JPY': 'JPY',
    'S$': 'SGD', 'SGD': 'SGD',
    'A$': 'AUD', 'AUD': 'AUD',
    'C$': 'CAD', 'CAD': 'CAD',
    'US$': 'USD',
  };
  return map[sym] || '';
}

export function formatCurrencyUSD(amount: number): string {
  if (amount === 0 || !amount) return '—';
  return `$${amount.toLocaleString()}`;
}
