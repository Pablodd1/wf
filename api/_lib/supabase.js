const { createClient } = require('@supabase/supabase-js');

let client = null;
let clientConfig = null;

function getClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    const error = new Error('Service temporarily unavailable');
    error.statusCode = 503;
    error.code = 'SERVICE_UNAVAILABLE';
    throw error;
  }

  const isDirectPostgrest = process.env.USE_DIRECT_POSTGREST === 'true';
  const nextConfig = `${supabaseUrl}\n${supabaseKey}\n${isDirectPostgrest}`;
  if (!client || clientConfig !== nextConfig) {
    const options = { auth: { persistSession: false } };
    if (isDirectPostgrest) {
      options.global = {
        fetch: async (url, opts) => {
          const rewritten = new URL(url);
          if (rewritten.origin === new URL(supabaseUrl).origin && rewritten.pathname.startsWith('/rest/v1/')) {
            rewritten.pathname = rewritten.pathname.slice('/rest/v1'.length);
          }
          return fetch(rewritten, opts);
        }
      };
    }
    client = createClient(supabaseUrl, supabaseKey, options);
    clientConfig = nextConfig;
  }
  return client;
}

module.exports = { getClient };
