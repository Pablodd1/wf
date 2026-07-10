/**
 * Analytics Validator
 * Validates computed analytics and statistics
 */

const { BaseValidator } = require('./base.js');

class AnalyticsValidator extends BaseValidator {
  constructor() {
    super('ANALYTICS', '1.0');
  }

  async _validate(parsed, raw) {
    const issues = [];
    let confidence = 1.0;
    const output = {};

    // Check year validity
    if (parsed.year) {
      const currentYear = new Date().getFullYear();
      
      if (parsed.year > currentYear + 1) {
        issues.push(this.createIssue(
          'FUTURE_YEAR',
          `Year ${parsed.year} is in the future`,
          'ERROR'
        ));
        confidence *= 0.3;
      } else if (parsed.year < 1900) {
        issues.push(this.createIssue(
          'INVALID_YEAR',
          `Year ${parsed.year} is before 1900`,
          'ERROR'
        ));
        confidence *= 0.3;
      } else if (parsed.year < 1950) {
        issues.push(this.createIssue(
          'VINTAGE_YEAR',
          `Year ${parsed.year} indicates vintage watch`,
          'INFO'
        ));
      }

      output.year = parsed.year;
    }

    // Check condition consistency
    if (parsed.condition && parsed.year) {
      const currentYear = new Date().getFullYear();
      const age = currentYear - parsed.year;

      if (age < 1 && parsed.condition.toLowerCase().includes('vintage')) {
        issues.push(this.createIssue(
          'CONDITION_YEAR_MISMATCH',
          `Watch from ${parsed.year} cannot be vintage`,
          'WARNING'
        ));
        confidence *= 0.7;
      }

      if (age > 20 && parsed.condition.toLowerCase() === 'new') {
        issues.push(this.createIssue(
          'CONDITION_YEAR_MISMATCH',
          `${age}-year-old watch marked as new`,
          'WARNING'
        ));
        confidence *= 0.6;
      }

      output.condition = parsed.condition;
      output.age = age;
    }

    // Check confidence score
    if (parsed.confidence !== undefined) {
      if (parsed.confidence < 0 || parsed.confidence > 1) {
        issues.push(this.createIssue(
          'INVALID_CONFIDENCE',
          `Confidence score ${parsed.confidence} is out of range`,
          'ERROR'
        ));
        confidence *= 0.2;
      }

      output.parser_confidence = parsed.confidence;
    }

    // Check verdict consistency
    if (parsed.verdict) {
      const validVerdicts = ['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'];
      
      if (!validVerdicts.includes(parsed.verdict)) {
        issues.push(this.createIssue(
          'INVALID_VERDICT',
          `Verdict ${parsed.verdict} is not valid`,
          'ERROR'
        ));
        confidence *= 0.3;
      }

      // Check if low confidence should be HUMAN review
      if (parsed.confidence < 0.5 && parsed.verdict === 'APPROVED') {
        issues.push(this.createIssue(
          'VERDICT_CONFIDENCE_MISMATCH',
          `Low confidence (${parsed.confidence}) but marked as APPROVED`,
          'WARNING'
        ));
        confidence *= 0.6;
      }

      output.verdict = parsed.verdict;
    }

    // Check raw message quality
    if (raw.raw_message) {
      const msg = raw.raw_message;
      
      if (msg.length < 10) {
        issues.push(this.createIssue(
          'SHORT_MESSAGE',
          'Raw message is very short',
          'INFO'
        ));
      }

      if (msg.length > 5000) {
        issues.push(this.createIssue(
          'LONG_MESSAGE',
          'Raw message is unusually long',
          'INFO'
        ));
      }

      output.message_length = msg.length;
    }

    const status = issues.some(i => i.severity === 'ERROR') ? 
      'FAILED' : 
      (issues.length > 0 ? 'WARNING' : 'PASSED');

    return {
      status,
      confidence,
      message: issues.length > 0 ? 
        `Found ${issues.length} analytics issue(s)` : 
        'Analytics validation passed',
      output,
      issues
    };
  }
}

module.exports = { AnalyticsValidator };
