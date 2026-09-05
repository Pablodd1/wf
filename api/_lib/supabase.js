const { createClient } = require('@supabase/supabase-js');

let client = null;
let clientConfig = null;

function getClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or a Supabase server key');
  }

  const nextConfig = `${supabaseUrl}\n${supabaseKey}`;
  if (!client || clientConfig !== nextConfig) {
    const isDirectPostgrest = process.env.USE_DIRECT_POSTGREST === 'true' || !supabaseUrl.includes('supabase.co');
    const options = { auth: { persistSession: false } };
    if (isDirectPostgrest) {
      options.global = {
        fetch: async (url, opts) => {
          const rewritten = url.replace('/rest/v1/', '/');
          const res = await fetch(rewritten, opts);
          const text = await res.text();
          return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
        }
      };
    }
    client = createClient(supabaseUrl, supabaseKey, options);
    clientConfig = nextConfig;
  }
  return client;
}

module.exports = { getClient };
