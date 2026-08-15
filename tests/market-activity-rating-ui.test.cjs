const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ticker = fs.readFileSync(path.join(root, 'src/components/MarketActivityTicker.tsx'), 'utf8');
const floor = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const dealerEvidence = fs.readFileSync(path.join(root, 'src/components/ListingDealerEvidence.tsx'), 'utf8');

test('market activity ticker uses bounded released listing evidence rather than fixed marketing claims', () => {
  assert.match(ticker, /RELEASED_BRANDS/);
  assert.match(ticker, /reviewed-market-inventory\?brand=/);
  assert.match(ticker, /pageSize=1&pagination=cursor/);
  assert.match(ticker, /REFRESH_INTERVAL_MS = 45_000/);
  assert.doesNotMatch(ticker, /Patek 5712\/1A matched/);
  assert.doesNotMatch(ticker, /WTB posted · Miami network/);
});

test('listing cards render the source-backed dealer rating beside price', () => {
  assert.match(floor, /justify-between gap-2 border-y py-3/);
  assert.match(floor, /<DealerRatingBadge/);
  assert.match(dealerEvidence, /Dealer rating \$\{evidence\.rating\.toFixed\(1\)\} from \$\{evidence\.reviewCount\} reviews/);
  assert.match(dealerEvidence, /Rated dealer with \$\{evidence\.reviewCount\} positive feedback records/);
  assert.match(dealerEvidence, />Not rated<\/span>/);
});
