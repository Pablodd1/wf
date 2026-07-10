/**
 * Outlier Validator
 * Detects statistical outliers based on brand/reference pricing
 */

const { BaseValidator } = require('./base.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class OutlierValidator extends BaseValidator {
  constructor() {
    super('OUTLIER', '1.0');
  }

  async _validate(parsed, raw) {
    const issues = [];
    let confidence = 1.0;
    const output = {};

    if (!parsed.price_usd || !parsed.brand || !parsed.reference) {
      return {
        status: 'PASSED',
        confidence: 1.0,
        message: 'Insufficient data for outlier detection',
        output,
        issues
      };
    }

    const price = parsed.price_usd;
    const brand = parsed.brand;
    const reference = parsed.reference;

    output.price = price;
    output.brand = brand;
    output.reference = reference;

    try {
      // Get price statistics for this brand + reference
      const { data: prices, error } = await supabase
        .from('normalized_records')
        .select('price_usd')
        .eq('brand', brand)
        .eq('reference', reference)
        .eq('status', 'APPROVED')
        .not('price_usd', 'is', null)
        .limit(100);

      if (error) throw error;

      if (!prices || prices.length < 10) {
        // Not enough data for statistical analysis
        return {
          status: 'PASSED',
          confidence: 0.8,
          message: 'Insufficient data for outlier detection',
          output: { sample_size: prices?.length || 0 },
          issues
        };
      }

      const priceArray = prices.map(p => p.price_usd).sort((a, b) => a - b);
      const stats = this.calculateStats(priceArray);

      output.stats = stats;
      output.sample_size = priceArray.length;

      // Calculate IQR
      const q1Index = Math.floor(priceArray.length * 0.25);
      const q3Index = Math.floor(priceArray.length * 0.75);
      const q1 = priceArray[q1Index];
      const q3 = priceArray[q3Index];
      const iqr = q3 - q1;

      // Outlier bounds (1.5 * IQR rule)
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;

      output.lower_bound = lowerBound;
      output.upper_bound = upperBound;

      // Check if price is an outlier
      if (price < lowerBound) {
        issues.push(this.createIssue(
          'LOW_OUTLIER',
          `Price $${price} is below expected range ($${lowerBound.toFixed(2)} - $${upperBound.toFixed(2)})`,
          'WARNING'
        ));
        confidence *= 0.5;
      } else if (price > upperBound) {
        issues.push(this.createIssue(
          'HIGH_OUTLIER',
          `Price $${price} is above expected range ($${lowerBound.toFixed(2)} - $${upperBound.toFixed(2)})`,
          'WARNING'
        ));
        confidence *= 0.5;
      }

      // Check if price is extremely different from median
      const medianDiff = Math.abs(price - stats.median) / stats.median;
      if (medianDiff > 0.5) {
        issues.push(this.createIssue(
          'DEVIATES_FROM_MEDIAN',
          `Price deviates ${(medianDiff * 100).toFixed(1)}% from median ($${stats.median})`,
          'WARNING'
        ));
        confidence *= 0.7;
      }

      // Calculate z-score
      const zScore = (price - stats.mean) / stats.stdDev;
      output.z_score = zScore;

      if (Math.abs(zScore) > 3) {
        issues.push(this.createIssue(
          'HIGH_Z_SCORE',
          `Price has z-score of ${zScore.toFixed(2)} (extreme outlier)`,
          'WARNING'
        ));
        confidence *= 0.6;
      }

    } catch (error) {
      console.error('Outlier validation error:', error);
      return {
        status: 'WARNING',
        confidence: 0.7,
        message: 'Could not perform outlier analysis',
        output,
        issues: [this.createIssue('ANALYSIS_ERROR', error.message, 'INFO')]
      };
    }

    const status = issues.length > 0 ? 'WARNING' : 'PASSED';

    return {
      status,
      confidence,
      message: issues.length > 0 ? 
        `Price may be an outlier` : 
        'Price within normal range',
      output,
      issues
    };
  }

  calculateStats(array) {
    const n = array.length;
    const sum = array.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 === 0 ? 
      (array[n/2 - 1] + array[n/2]) / 2 : 
      array[Math.floor(n/2)];
    
    const variance = array.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    const min = array[0];
    const max = array[n - 1];

    return {
      count: n,
      mean: parseFloat(mean.toFixed(2)),
      median: parseFloat(median.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      min,
      max,
      range: max - min
    };
  }
}

module.exports = { OutlierValidator };
