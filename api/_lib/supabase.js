const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or a Supabase server key');
}

let client = null;

function getClient() {
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
  }
  return client;
}

module.exports = { getClient };
