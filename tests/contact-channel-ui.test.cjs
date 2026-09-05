'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('listing surfaces show verified channel actions without rendering contact numbers', () => {
  const trading = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');
  const evidence = read('src/components/ListingDealerEvidence.tsx');

  assert.match(trading, /contact_channels\?\.whatsapp/);
  assert.match(trading, /contact_channels\?\.telegram/);
  assert.match(trading, /fetch\(`\/api\/listing-contact\?\$\{contactParams\.toString\(\)\}`/);
  assert.match(trading, /Continue on Telegram/);
  assert.match(trading, /Ask Curated Luxury on WhatsApp/);
  assert.match(trading, /Please help connect me with the poster/);
  assert.doesNotMatch(trading, /Contact phone number not available for this poster/);
  assert.doesNotMatch(trading, /\{contact\?\.phone_display/);
  assert.doesNotMatch(trading, /Contact:\s*\{publishedPhone\}/);
  assert.match(research, /seller\?\.contact_channels\?\.whatsapp/);
  assert.match(research, /surface=price-research[^`]*channel=whatsapp/);
  assert.doesNotMatch(research, /seller\?\.phone_display/);
  assert.doesNotMatch(evidence, /Contact:\s*\{publishedPhone\}/);
});

test('Curated Luxury WhatsApp helper encodes listing-specific messages without exposing a poster number', () => {
  const contact = read('src/contactWhatsApp.ts');
  assert.match(contact, /buildContactWhatsAppUrl\(message: string\)/);
  assert.match(contact, /encodeURIComponent\(message\)/);
});
