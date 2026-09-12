'use strict';

const PROHIBITED_IDENTIFIERS = [
  'bptrvfncppbjnchsaxtb',
  'qnsafosakvonzgfcsphh',
  'watchfacts-poc',
  'luxuryapp-wf',
  'wf-production-00b9.up.railway.app'
];

function checkEnv() {
  const envEntries = Object.entries(process.env);
  for (const [key, value] of envEntries) {
    if (!value || typeof value !== 'string') continue;
    const lower = value.toLowerCase();
    for (const prohibited of PROHIBITED_IDENTIFIERS) {
      if (lower.includes(prohibited.toLowerCase())) {
        console.error(`CRITICAL SAFETY ERROR: Prohibited production reference '${prohibited}' found in environment variable '${key}'.`);
        process.exit(1);
      }
    }
  }
}

checkEnv();
console.log('Verified: zero production Supabase or Railway project references present in build environment.');
