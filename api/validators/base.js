/**
 * Base Validator Class
 * All validation agents inherit from this
 */

class BaseValidator {
  constructor(name, version = '1.0') {
    this.name = name;
    this.version = version;
  }

  /**
   * Validate a record
   * @param {Object} parsed - Parsed message data
   * @param {Object} raw - Raw message data
   * @returns {Promise<ValidationResult>}
   */
  async validate(parsed, raw) {
    try {
      const result = await this._validate(parsed, raw);
      return {
        validator: this.name,
        version: this.version,
        status: result.status || 'PASSED',
        confidence: result.confidence || 1.0,
        message: result.message || '',
        input_data: parsed,
        output_data: result.output || {},
        issues: result.issues || []
      };
    } catch (error) {
      return {
        validator: this.name,
        version: this.version,
        status: 'ERROR',
        confidence: 0,
        message: error.message,
        input_data: parsed,
        output_data: {},
        issues: [{ type: 'ERROR', message: error.message }]
      };
    }
  }

  /**
   * Override this method in subclasses
   */
  async _validate(parsed, raw) {
    throw new Error('_validate() must be implemented');
  }

  /**
   * Create a validation issue
   */
  createIssue(type, message, severity = 'WARNING') {
    return {
      type,
      message,
      severity,
      validator: this.name
    };
  }
}

/**
 * @typedef {Object} ValidationResult
 * @property {string} validator
 * @property {string} version
 * @property {string} status - PASSED, FAILED, WARNING, ERROR
 * @property {number} confidence - 0.0 to 1.0
 * @property {string} message
 * @property {Object} input_data
 * @property {Object} output_data
 * @property {Array} issues
 */

module.exports = { BaseValidator };
