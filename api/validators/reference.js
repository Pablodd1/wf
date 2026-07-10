/**
 * Reference Validator
 * Validates reference numbers against catalog
 */

const { BaseValidator } = require('./base.js');
const { lookupCatalog } = require('../_lib/catalog-matcher');

class ReferenceValidator extends BaseValidator {
  constructor() {
    super('REFERENCE', '1.0');
  }

  async _validate(parsed, raw) {
    const issues = [];
    let confidence = 1.0;
    const output = {};

    // Check if reference exists
    if (!parsed.reference) {
      issues.push(this.createIssue('NO_REFERENCE', 'No reference number detected', 'WARNING'));
      return {
        status: 'WARNING',
        confidence: 0.3,
        message: 'No reference detected',
        output,
        issues
      };
    }

    const ref = parsed.reference;
    const brand = parsed.brand;

    output.reference = ref;
    output.brand = brand;

    // 1. Check reference format
    const formatCheck = this.checkFormat(ref, brand);
    if (!formatCheck.valid) {
      issues.push(this.createIssue(
        'INVALID_FORMAT',
        formatCheck.message,
        'WARNING'
      ));
      confidence *= 0.7;
    }

    // 2. Lookup in catalog
    if (brand) {
      const catalog = lookupCatalog(brand, ref);
      
      if (catalog) {
        output.catalog_match = catalog;
        
        // Check if reference matches exactly
        if (catalog.reference === ref) {
          output.exact_match = true;
        } else {
          issues.push(this.createIssue(
            'REFERENCE_VARIANT',
            `Reference ${ref} matches catalog entry ${catalog.reference} (${catalog.model_name})`,
            'INFO'
          ));
        }

        // Check dial color match
        if (parsed.dial_color && catalog.dial_colors) {
          const dialMatch = catalog.dial_colors.some(d => 
            d.toLowerCase().includes(parsed.dial_color.toLowerCase()) ||
            parsed.dial_color.toLowerCase().includes(d.toLowerCase())
          );
          
          if (!dialMatch) {
            issues.push(this.createIssue(
              'DIAL_MISMATCH',
              `Dial color "${parsed.dial_color}" not in catalog colors: ${catalog.dial_colors.join(', ')}`,
              'WARNING'
            ));
            confidence *= 0.8;
          }
        }
      } else {
        issues.push(this.createIssue(
          'NOT_IN_CATALOG',
          `Reference ${ref} not found in ${brand} catalog`,
          'WARNING'
        ));
        confidence *= 0.6;
      }
    }

    // 3. Check for common reference errors
    // Reference that looks like a price
    if (/^\d{4,6}$/.test(ref) && parseInt(ref) > 10000) {
      issues.push(this.createIssue(
        'REFERENCE_LOOKS_LIKE_PRICE',
        `Reference ${ref} looks like a price`,
        'WARNING'
      ));
      confidence *= 0.7;
    }

    // Reference with invalid characters
    if (/[<>{}[\]]/.test(ref)) {
      issues.push(this.createIssue(
        'INVALID_CHARACTERS',
        `Reference contains invalid characters`,
        'ERROR'
      ));
      confidence *= 0.3;
    }

    // 4. Slash-ref validation (Patek Philippe)
    if (ref.includes('/') && brand === 'Patek Philippe') {
      const parts = ref.split('/');
      if (parts.length === 2) {
        const [main, suffix] = parts;
        if (main.length < 4 || suffix.length < 1) {
          issues.push(this.createIssue(
            'INVALID_SLASH_REF',
            `Slash reference ${ref} has invalid format`,
            'WARNING'
          ));
          confidence *= 0.7;
        }
      }
    }

    const status = issues.length > 0 ? 
      (confidence < 0.5 ? 'FAILED' : 'WARNING') : 
      'PASSED';

    return {
      status,
      confidence,
      message: issues.length > 0 ? 
        `Found ${issues.length} reference issue(s)` : 
        'Reference validation passed',
      output,
      issues
    };
  }

  checkFormat(ref, brand) {
    // Brand-specific format rules
    const formats = {
      'Rolex': {
        pattern: /^[0-9]{5,6}[A-Z]{0,4}$/,
        description: '5-6 digits followed by 0-4 letters'
      },
      'Patek Philippe': {
        pattern: /^[0-9]{3,5}[A-Z]?\/?[0-9A-Z-]*$/,
        description: '3-5 digits with optional letter and slash suffix'
      },
      'Audemars Piguet': {
        pattern: /^[0-9]{5}[A-Z]{2}(\.[0-9]{2})?$/,
        description: '5 digits + 2 letters with optional .XX suffix'
      },
      'Omega': {
        pattern: /^[0-9]{3}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{3}\.[0-9]{3}$/,
        description: 'XXX.XX.XX.XX.XXX.XXX format'
      }
    };

    const format = formats[brand];
    if (format) {
      if (!format.pattern.test(ref)) {
        return {
          valid: false,
          message: `Reference ${ref} doesn't match ${brand} format: ${format.description}`
        };
      }
    }

    // Generic checks
    if (ref.length < 3) {
      return {
        valid: false,
        message: `Reference too short (minimum 3 characters)`
      };
    }

    if (ref.length > 30) {
      return {
        valid: false,
        message: `Reference too long (maximum 30 characters)`
      };
    }

    return { valid: true };
  }
}

module.exports = { ReferenceValidator };
