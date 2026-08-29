const { createClient } = require('@supabase/supabase-js');

let client = null;
let clientConfig = null;

function getClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qnsafosakvonzgfcsphh.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or a Supabase server key');
  }

  const nextConfig = `${supabaseUrl}\n${supabaseKey}`;
  if (!client || clientConfig !== nextConfig) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    clientConfig = nextConfig;
  }
  return client;
}

module.exports = { getClient };
