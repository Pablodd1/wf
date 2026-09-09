'use strict';

// Only complete affirmative inventory headings establish a sale section.
// Location words are text evidence, never currency or dealer-location evidence.
function inventorySaleHeader(text) {
  const value=String(text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').trim();
  if(String(text).includes('?'))return false;
  return /^(?:ready\s+stock|in\s+stock|stock\s+list|ready\s+in\s+(?:HK|Hong\s*Kong)(?:\s+stock)?)$/i.test(value);
}
module.exports={inventorySaleHeader,POLICY_VERSION:'explicit-inventory-section-v6'};
