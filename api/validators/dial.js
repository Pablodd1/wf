/**
 * Dial Validator
 * Validates dial colors and descriptions
 */

import { BaseValidator } from './base.js';

export class DialValidator extends BaseValidator {
  constructor() {
    super('DIAL', '1.0');
    
    // Standard dial colors
    this.standardColors = [
      'black', 'white', 'blue', 'green', 'red', 'silver', 'gold',
      'gray', 'grey', 'brown', 'orange', 'yellow', 'pink', 'purple',
      'champagne', 'mother of pearl', 'mother-of-pearl', 'skeleton'
    ];

    // Common dial descriptions
    this.descriptors = [
      'roman', 'arabic', 'diamond', 'stick', 'baton', 'luminous',
      'sunburst', 'textured', 'guilloche', 'lacquered', 'meteorite'
    ];
  }

  async _validate(parsed, raw) {
    const issues = [];
    let confidence = 1.0;
    const output = {};

    if (!parsed.dial_color) {
      issues.push(this.createIssue('NO_DIAL', 'No dial color detected', 'INFO'));
      return {
        status: 'PASSED',
        confidence: 0.8,
        message: 'No dial color detected (may be intentional)',
        output,
        issues
      };
    }

    const dial = parsed.dial_color.toLowerCase();
    output.dial_color = parsed.dial_color;

    // 1. Check if it's a standard color
    const isStandard = this.standardColors.some(color => 
      dial.includes(color) || color.includes(dial)
    );

    if (!isStandard) {
      issues.push(this.createIssue(
        'NON_STANDARD_COLOR',
        `Dial color "${parsed.dial_color}" is not a standard color`,
        'INFO'
      ));
      confidence *= 0.9;
    }

    // 2. Check for descriptors
    const foundDescriptors = this.descriptors.filter(desc => 
      dial.includes(desc)
    );

    if (foundDescriptors.length > 0) {
      output.descriptors = foundDescriptors;
    }

    // 3. Check for multiple colors
    const colorCount = this.standardColors.filter(color => 
      dial.includes(color)
    ).length;

    if (colorCount > 2) {
      issues.push(this.createIssue(
        'TOO_MANY_COLORS',
        `Dial description contains ${colorCount} colors, may be incorrect`,
        'WARNING'
      ));
      confidence *= 0.7;
    }

    // 4. Check for invalid characters or formatting
    if (/[<>{}]/.test(parsed.dial_color)) {
      issues.push(this.createIssue(
        'INVALID_FORMAT',
        'Dial color contains invalid characters',
        'ERROR'
      ));
      confidence *= 0.3;
    }

    // 5. Check length
    if (parsed.dial_color.length > 50) {
      issues.push(this.createIssue(
        'TOO_LONG',
        'Dial color description is unusually long',
        'WARNING'
      ));
      confidence *= 0.8;
    }

    const status = issues.some(i => i.severity === 'ERROR') ? 
      'FAILED' : 
      (issues.length > 0 ? 'WARNING' : 'PASSED');

    return {
      status,
      confidence,
      message: issues.length > 0 ? 
        `Found ${issues.length} dial issue(s)` : 
        'Dial validation passed',
      output,
      issues
    };
  }
}
