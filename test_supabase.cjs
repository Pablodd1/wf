const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('URL:', SUPABASE_URL);
console.log('Key present:', !!SUPABASE_KEY);
console.log('Key length:', SUPABASE_KEY?.length);
console.log('Key starts with:', SUPABASE_KEY?.slice(0, 10));

// Try with anon key fallback
async function test() {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
  
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=count&limit=1`, { headers });
  console.log('Status:', resp.status);
  const text = await resp.text();
  console.log('Response:', text.slice(0, 200));
}

test();
