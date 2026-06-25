const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('URL:', SUPABASE_URL);
console.log('Key length:', SUPABASE_KEY?.length);
console.log('Key first 20 chars:', SUPABASE_KEY?.slice(0, 20));
console.log('Key last 10 chars:', SUPABASE_KEY?.slice(-10));

async function test() {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
  
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=id&limit=1`, { headers });
  console.log('Status:', resp.status);
  if (resp.ok) {
    const data = await resp.json();
    console.log('Success! Records:', data.length);
  } else {
    console.log('Error:', await resp.text());
  }
}

test();
