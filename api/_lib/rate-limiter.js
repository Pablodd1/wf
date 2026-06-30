/**
 * In-memory rate limiter for Vercel serverless functions.
 * Uses a rolling window per endpoint + identifier.
 * For production scale, replace with Upstash Redis.
 */

const DEFAULT_LIMIT = { windowMs: 60000, maxRequests: 30 };

const ENDPOINT_LIMITS = {
  '/api/green-api-live':    { windowMs: 60000, maxRequests: 120 },
  '/api/green-api-webhook': { windowMs: 60000, maxRequests: 120 },
  '/api/online-search':     { windowMs: 60000, maxRequests: 10 },
};

const stores = {};

function getStore(key) {
  if (!stores[key]) stores[key] = [];
  return stores[key];
}

function rateLimit(endpoint, identifier) {
  const config = ENDPOINT_LIMITS[endpoint] || DEFAULT_LIMIT;
  const now = Date.now();
  const store = getStore(`${endpoint}:${identifier}`);
  const windowStart = now - config.windowMs;
  while (store.length > 0 && store[0] < windowStart) store.shift();
  if (store.length >= config.maxRequests) {
    const retryAfter = Math.ceil((store[0] + config.windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }
  store.push(now);
  return { allowed: true, remaining: config.maxRequests - store.length };
}

function withRateLimit(endpoint, handler) {
  return async (req, res) => {
    const identifier = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const result = rateLimit(endpoint, identifier);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter));
      res.setHeader('X-RateLimit-Remaining', '0');
      return res.status(429).json({ error: 'Too Many Requests', retryAfter: result.retryAfter });
    }
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    return handler(req, res);
  };
}

module.exports = { rateLimit, withRateLimit, ENDPOINT_LIMITS };
