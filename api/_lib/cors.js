/**
 * CORS utility - centralized origin control
 * Issue #9 from security audit: wildcard '*' allows any origin
 */

const ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS 
  ? process.env.CORS_ALLOWED_ORIGINS.split(',')
  : [
      'https://watchfacts-poc.vercel.app',
      'https://watchfacts.vercel.app',
      'http://localhost:3000',
      'http://localhost:5173',
    ];

/**
 * Set CORS headers for Vercel serverless functions
 * @param {object} res - Express response object
 * @param {object} req - Express request object (to check origin)
 * @param {object} options - { credentials: true, methods: 'GET,POST,OPTIONS' }
 */
function setCorsHeaders(res, req, options = {}) {
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', options.credentials !== false ? 'true' : 'false');
  res.setHeader('Access-Control-Allow-Methods', options.methods || 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  
  return false;
}

module.exports = { setCorsHeaders, ALLOWED_ORIGINS };
