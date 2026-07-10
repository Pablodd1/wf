/**
 * Currency Validator
 * Validates currency conversions and detects outliers
 */

import { BaseValidator } from './base.js';

export class CurrencyValidator extends BaseValidator {
  constructor() {
    super('CURRENCY', '1.0');
    
    // Exchange rates (approximate, for validation)
    this.rates = {
      USD: 1.0,
      EUR: 0.92,
      GBP: 0.79,
      HKD: 7.82,
      SGD: 1.34,
      AED: 3.67,
      CHF: 0.88,
      JPY: 149.5,
      CNY: 7.24
    };

    // Price ranges by brand (USD)
    this.priceRanges = {
      'Rolex': { min: 3000, max: 100000 },
      'Patek Philippe': { min: 10000, max: 2000000 },
      'Audemars Piguet': { min: 8000, max: 500000 },
      'Richard Mille': { min: 50000, max: 3000000 },
      'Omega': { min: 2000, max: 50000 },
      'Cartier': { min: 2000, max: 100000 },
      'IWC': { min: 3000, max: 80000 },
      'Jaeger-LeCoultre': { min: 3000, max: 150000 },
      'Vacheron Constantin': { min: 8000, max: 500000 },
      'default': { min: 500, max: 200000 }
    };
  }

  async _validate(parsed, raw) {
    const issues = [];
    let confidence = 1.0;
    const output = {};

    // Check if price exists
    if (!parsed.price_usd) {
      issues.push(this.createIssue('NO_PRICE', 'No price detected', 'WARNING'));
      return {
        status: 'WARNING',
        confidence: 0.5,
        message: 'No price detected',
        output,
        issues
      };
    }

    const price = parsed.price_usd;
    const currency = parsed.currency || 'USD';
    const brand = parsed.brand || 'default';

    // 1. Check if price is in reasonable range
    const range = this.priceRanges[brand] || this.priceRanges['default'];
    
    if (price < range.min) {
      issues.push(this.createIssue(
        'PRICE_TOO_LOW',
        `Price $${price} is below expected minimum $${range.min} for ${brand}`,
        'WARNING'
      ));
      confidence *= 0.7;
    }
    
    if (price > range.max) {
      issues.push(this.createIssue(
        'PRICE_TOO_HIGH',
        `Price $${price} exceeds expected maximum $${range.max} for ${brand}`,
        'WARNING'
      ));
      confidence *= 0.7;
    }

    // 2. Check currency conversion
    if (currency !== 'USD' && this.rates[currency]) {
      const expectedUSD = price * this.rates[currency];
      output.original_price = price;
      output.original_currency = currency;
      output.converted_price = expectedUSD;
      output.exchange_rate = this.rates[currency];

      // If converted price is very different, flag it
      if (Math.abs(price - expectedUSD) / price > 0.1) {
        issues.push(this.createIssue(
          'CURRENCY_CONVERSION',
          `Price appears to be in ${currency} (${price}) but stored as USD. Expected: $${expectedUSD.toFixed(2)}`,
          'WARNING'
        ));
        confidence *= 0.8;
      }
    }

    // 3. Check for common parsing errors
    // If price is exactly the reference number, it's likely wrong
    if (parsed.reference && price.toString().includes(parsed.reference)) {
      issues.push(this.createIssue(
        'PRICE_EQUALS_REFERENCE',
        `Price $${price} appears to be the reference number ${parsed.reference}`,
        'WARNING'
      ));
      confidence *= 0.5;
    }

    // 4. Check for HKD stored as USD (common error)
    if (currency === 'USD' && price > 10000 && price < 100000) {
      const hkdEquivalent = price * 7.82;
      const msg = raw.raw_message.toLowerCase();
      
      if (msg.includes('hkd') || msg.includes('hk$')) {
        issues.push(this.createIssue(
          'HKD_STORED_AS_USD',
          `Message mentions HKD but price stored as USD. If HKD ${price}, should be $${(price / 7.82).toFixed(2)} USD`,
          'WARNING'
        ));
        confidence *= 0.6;
      }
    }

    output.final_price = price;
    output.currency = currency;

    const status = issues.length > 0 ? 
      (confidence < 0.5 ? 'FAILED' : 'WARNING') : 
      'PASSED';

    return {
      status,
      confidence,
      message: issues.length > 0 ? 
        `Found ${issues.length} currency issue(s)` : 
        'Currency validation passed',
      output,
      issues
    };
  }
}
