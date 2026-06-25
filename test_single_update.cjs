const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function test() {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
  
  console.log('Testing single update...');
  console.log('URL:', SUPABASE_URL);
  console.log('Key length:', SUPABASE_KEY?.length);
  
  const testId = 'prod_ad4be21b-83ca-45c1-9';
  
  // First, get the record
  console.log('\n1. Getting record...');
  const getResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(testId)}`, { headers });
  console.log('GET status:', getResp.status);
  
  if (getResp.ok) {
    const data = await getResp.json();
    console.log('Record found:', data.length > 0);
    if (data.length > 0) {
      console.log('Current verdict:', data[0].verdict);
      console.log('Current confidence:', data[0].confidence);
    }
  }
  
  // Try update with RECYCLE
  console.log('\n2. Updating to RECYCLE...');
  const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(testId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ confidence: 70, verdict: 'RECYCLE' })
  });
  console.log('PATCH status:', patchResp.status);
  
  if (!patchResp.ok) {
    const text = await patchResp.text();
    console.log('PATCH error:', text);
  } else {
    console.log('✅ Update successful!');
    
    // Verify
    console.log('\n3. Verifying update...');
    const verifyResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(testId)}`, { headers });
    const verifyData = await verifyResp.json();
    if (verifyData.length > 0) {
      console.log('New verdict:', verifyData[0].verdict);
      console.log('New confidence:', verifyData[0].confidence);
    }
    
    // Revert
    console.log('\n4. Reverting...');
    const revertResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(testId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ confidence: 18, verdict: 'HUMAN' })
    });
    console.log('Revert status:', revertResp.status);
  }
}

test().catch(console.error);
