const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const k = parts[0].trim();
      const v = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

const { getClient } = require('../api/_lib/supabase.js');

async function testBrandQuery(brandName) {
  console.log(`Testing brand query for: "${brandName}"...`);
  const client = getClient();
  const columns = 'id,brand_scope,supplied_brand,canonical_brand,model,raw_reference,user_image_url,has_exact_source_image';
  
  try {
    const { data, count, error } = await client
      .from('reviewed_workbook_market_source_v2')
      .select(columns, { count: 'estimated' })
      .ilike('brand_scope', brandName)
      .limit(10);

    if (error) {
      console.error(`Error for "${brandName}":`, error.message);
    } else {
      console.log(`Success for "${brandName}": found ${data ? data.length : 0} sample rows (Total est: ${count})`);
      if (data && data.length > 0) {
        console.log(`  Sample 0: brand=${data[0].brand_scope}, model=${data[0].model}, image=${data[0].user_image_url || 'None'}`);
      }
    }
  } catch (err) {
    console.error(`Exception for "${brandName}":`, err.message);
  }
}

async function run() {
  const BRANDS = [
    'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille',
    'Vacheron Constantin', 'Tudor', 'Panerai', 'Omega', 'Cartier'
  ];
  for (const b of BRANDS) {
    await testBrandQuery(b);
  }
}

run();
