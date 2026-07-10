/**
 * Validation Coordinator
 * Orchestrates all validators and aggregates results
 */

const { CurrencyValidator } = require('./currency.js');
const { ReferenceValidator } = require('./reference.js');
const { DialValidator } = require('./dial.js');
const { OutlierValidator } = require('./outlier.js');
const { AnalyticsValidator } = require('./analytics.js');
const { ImageValidator } = require('./image.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class ValidationCoordinator {
  constructor() {
    this.validators = [
      new CurrencyValidator(),
      new ReferenceValidator(),
      new DialValidator(),
      new OutlierValidator(),
      new AnalyticsValidator(),
      new ImageValidator()
    ];
  }

  /**
   * Run all validators on a record
   */
  async validate(parsed, raw) {
    const results = [];
    let overallConfidence = 1.0;
    let overallStatus = 'PASSED';
    const allIssues = [];

    // Run all validators
    for (const validator of this.validators) {
      try {
        const result = await validator.validate(parsed, raw);
        results.push(result);

        // Log validation result
        await this.logValidation(result, parsed, raw);

        // Aggregate confidence (weighted average)
        overallConfidence *= result.confidence;

        // Collect issues
        if (result.issues && result.issues.length > 0) {
          allIssues.push(...result.issues);
        }

        // Determine overall status
        if (result.status === 'ERROR') {
          overallStatus = 'FAILED';
        } else if (result.status === 'FAILED' && overallStatus !== 'FAILED') {
          overallStatus = 'FAILED';
        } else if (result.status === 'WARNING' && overallStatus === 'PASSED') {
          overallStatus = 'WARNING';
        }
      } catch (error) {
        console.error(`Validator ${validator.name} error:`, error);
        results.push({
          validator: validator.name,
          status: 'ERROR',
          confidence: 0,
          message: error.message,
          issues: [{ type: 'ERROR', message: error.message }]
        });
        overallStatus = 'FAILED';
        overallConfidence = 0;
      }
    }

    // Calculate final confidence
    overallConfidence = Math.max(0, Math.min(1, overallConfidence));

    return {
      overall_status: overallStatus,
      confidence: overallConfidence,
      validators: results,
      issues: allIssues,
      summary: this.generateSummary(results)
    };
  }

  /**
   * Log validation result to database
   */
  async logValidation(result, parsed, raw) {
    try {
      await supabase
        .from('validation_logs')
        .insert({
          validator_type: result.validator,
          validator_version: result.version,
          status: result.status,
          confidence: result.confidence,
          message: result.message,
          input_data: result.input_data,
          output_data: result.output_data,
          error_details: result.issues
        });
    } catch (error) {
      console.error('Failed to log validation:', error);
    }
  }

  /**
   * Generate human-readable summary
   */
  generateSummary(results) {
    const summary = {
      total_validators: results.length,
      passed: 0,
      failed: 0,
      warnings: 0,
      errors: 0,
      details: []
    };

    for (const result of results) {
      switch (result.status) {
        case 'PASSED':
          summary.passed++;
          break;
        case 'FAILED':
          summary.failed++;
          break;
        case 'WARNING':
          summary.warnings++;
          break;
        case 'ERROR':
          summary.errors++;
          break;
      }

      summary.details.push({
        validator: result.validator,
        status: result.status,
        confidence: (result.confidence * 100).toFixed(1) + '%',
        message: result.message
      });
    }

    return summary;
  }

  /**
   * Get validation statistics for a batch
   */
  async getBatchStats(batchId) {
    const { data, error } = await supabase
      .from('validation_logs')
      .select('validator_type, status, confidence')
      .in('normalized_record_id', 
        supabase
          .from('normalized_records')
          .select('id')
          .eq('batch_id', batchId)
      );

    if (error) throw error;

    const stats = {
      by_validator: {},
      by_status: {},
      avg_confidence: 0
    };

    let totalConfidence = 0;

    for (const log of data) {
      // By validator
      if (!stats.by_validator[log.validator_type]) {
        stats.by_validator[log.validator_type] = {
          total: 0,
          passed: 0,
          failed: 0,
          warnings: 0,
          errors: 0
        };
      }
      
      stats.by_validator[log.validator_type].total++;
      stats.by_validator[log.validator_type][log.status.toLowerCase()]++;

      // By status
      if (!stats.by_status[log.status]) {
        stats.by_status[log.status] = 0;
      }
      stats.by_status[log.status]++;

      totalConfidence += log.confidence;
    }

    stats.avg_confidence = data.length > 0 ? 
      (totalConfidence / data.length * 100).toFixed(1) + '%' : 
      '0%';

    return stats;
  }
}

module.exports = { ValidationCoordinator };
