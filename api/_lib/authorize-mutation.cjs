'use strict';

const { authorizeDealer } = require('./dealer-auth.cjs');
const { hasServiceToken } = require('./require-service-token.cjs');

async function authorizeMutation(req, res, allowedRoles) {
  if (hasServiceToken(req)) return true;

  const authorization = await authorizeDealer(req, res, allowedRoles);
  if (!authorization.error) return true;

  const status = authorization.status || 401;
  const error = status === 403 ? 'Forbidden' : status === 503 ? 'Authentication is not configured' : 'Unauthorized';
  res.status(status).json({ error });
  return false;
}

module.exports = { authorizeMutation };
