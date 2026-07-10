/**
 * Image Validator
 * Validates image URLs and checks accessibility
 */

const { BaseValidator } = require('./base.js');

class ImageValidator extends BaseValidator {
  constructor() {
    super('IMAGE', '1.0');
  }

  async _validate(parsed, raw) {
    const issues = [];
    let confidence = 1.0;
    const output = {};

    // Check if images exist
    if (!parsed.images || parsed.images.length === 0) {
      return {
        status: 'PASSED',
        confidence: 1.0,
        message: 'No images to validate',
        output,
        issues
      };
    }

    output.image_count = parsed.images.length;
    output.images = [];

    for (let i = 0; i < parsed.images.length; i++) {
      const imageUrl = parsed.images[i];
      const imageResult = await this.validateImage(imageUrl, i);
      
      output.images.push(imageResult);

      if (imageResult.status === 'ERROR') {
        issues.push(this.createIssue(
          'INVALID_IMAGE',
          `Image ${i + 1}: ${imageResult.message}`,
          'ERROR'
        ));
        confidence *= 0.5;
      } else if (imageResult.status === 'WARNING') {
        issues.push(this.createIssue(
          'IMAGE_ISSUE',
          `Image ${i + 1}: ${imageResult.message}`,
          'WARNING'
        ));
        confidence *= 0.8;
      }
    }

    // Check if too many images
    if (parsed.images.length > 10) {
      issues.push(this.createIssue(
        'TOO_MANY_IMAGES',
        `Unusually high number of images (${parsed.images.length})`,
        'INFO'
      ));
    }

    const status = issues.some(i => i.severity === 'ERROR') ? 
      'FAILED' : 
      (issues.length > 0 ? 'WARNING' : 'PASSED');

    return {
      status,
      confidence,
      message: issues.length > 0 ? 
        `Found ${issues.length} image issue(s)` : 
        'Image validation passed',
      output,
      issues
    };
  }

  async validateImage(url, index) {
    const result = {
      url,
      index,
      status: 'PASSED',
      message: 'Valid'
    };

    try {
      // Basic URL validation
      if (!url || typeof url !== 'string') {
        result.status = 'ERROR';
        result.message = 'Invalid URL';
        return result;
      }

      // Check URL format
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        result.status = 'ERROR';
        result.message = 'URL must start with http:// or https://';
        return result;
      }

      // Check for common image extensions
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const hasExtension = imageExtensions.some(ext => 
        url.toLowerCase().includes(ext)
      );

      if (!hasExtension) {
        result.status = 'WARNING';
        result.message = 'URL does not have a common image extension';
      }

      // Check URL length
      if (url.length > 2000) {
        result.status = 'WARNING';
        result.message = 'URL is unusually long';
      }

      // Note: We're not actually fetching the images here to avoid
      // rate limiting and slow validation. In a production system,
      // you might want to:
      // 1. Check if URL is accessible (HEAD request)
      // 2. Verify content-type is an image
      // 3. Check image dimensions
      // This would be done asynchronously in a background job

    } catch (error) {
      result.status = 'ERROR';
      result.message = error.message;
    }

    return result;
  }
}

module.exports = { ImageValidator };
