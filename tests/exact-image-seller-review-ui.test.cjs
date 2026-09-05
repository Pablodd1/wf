'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'ReviewQueue.tsx'),
  'utf8',
);
const imageLane = source.slice(
  source.indexOf('function ImageReviewLane'),
  source.indexOf('function SellerLineageReviewLane'),
);
const sellerLane = source.slice(
  source.indexOf('function SellerLineageReviewLane'),
  source.indexOf('export default function ReviewQueue'),
);

test('image lane loads actual evidence and has no default review decision', () => {
  assert.match(source, /'images'/);
  assert.match(source, />\s*Images\s*</);
  assert.match(imageLane, /imageQueueUrl = `\/api\/image-review-queue\?release=true&limit=50/);
  assert.match(imageLane, /fetch\(imageQueueUrl/);
  assert.match(imageLane, /credentials:\s*'include'/);
  assert.match(imageLane, /src=\{item\.public_url\}/);
  assert.match(imageLane, /item\.raw_message/);
  assert.match(imageLane, /item\.brand/);
  assert.match(imageLane, /item\.model/);
  assert.match(imageLane, /item\.reference/);
  assert.match(imageLane, /item\.dial_color/);
  assert.match(imageLane, /useState<Record<string, 'MATCH' \| 'NO_MATCH' \| undefined>>\(\{\}\)/);
  assert.match(imageLane, /\(\['MATCH', 'NO_MATCH'\] as const\)/);
  assert.match(imageLane, /type="radio"/);
  assert.match(imageLane, /type="checkbox"/);
  assert.match(imageLane, /setNextCursor\(String\(data\.nextCursor/);
  assert.match(imageLane, /Image review page \{cursorHistory\.length \+ 1\}/);
  assert.match(imageLane, />\s*Previous\s*</);
  assert.match(imageLane, />\s*Next\s*</);
  assert.match(imageLane, /AI visual check \(advisory only\)/);
  assert.match(imageLane, /Compare image to listing identity/);
  assert.match(imageLane, /Reads only this source image\. It does not receive the raw listing, change fields, attach the image, or make your review decision\./);
  assert.match(imageLane, /verifyImageReference\(/);
  assert.match(imageLane, /Visible reference agrees; reviewer decision is still required/);
  assert.match(imageLane, /Visible conflict; do not attach until a reviewer adjudicates/);
});

test('image lane sends only an explicit, reasoned match decision', () => {
  assert.match(imageLane, /fetch\('\/api\/image-review-decision'/);
  assert.match(imageLane, /sourceObjectKey:\s*item\.source_object_key/);
  assert.match(imageLane, /recordId:\s*item\.record_id/);
  assert.match(imageLane, /visualMatch,/);
  assert.match(imageLane, /reason,/);
  assert.match(imageLane, /reason\.length < 12/);
  assert.match(imageLane, /minLength=\{12\}/);
  assert.match(imageLane, /item\.review_blocked/);
  assert.match(imageLane, /item\.review_blockers\?\.join/);
  assert.match(imageLane, /!inspected\[key\] \|\| !choice \|\| reason\.trim\(\)\.length < 12/);
  assert.match(imageLane, /!item\.public_url/);
  const visualCheck = imageLane.slice(imageLane.indexOf('const runVisualCheck'), imageLane.indexOf('return ('));
  assert.doesNotMatch(visualCheck, /setChoices\(/);
  assert.doesNotMatch(visualCheck, /setInspected\(/);
});

test('the browser never contains a direct vision key or visual matching policy', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'verifyImage.ts'), 'utf8');
  assert.match(helper, /fetch\('\/api\/verify-image'/);
  assert.match(helper, /credentials: 'include'/);
  assert.doesNotMatch(helper, /window\.__GEMINI_API_KEY/);
  assert.doesNotMatch(helper, /generativelanguage\.googleapis\.com/);
});

test('seller lane shows masked source evidence and proposed verified dealer', () => {
  assert.match(source, /'sellers'/);
  assert.match(source, />\s*Sellers\s*</);
  assert.match(sellerLane, /sellerQueueUrl = `\/api\/seller-lineage-review-queue\?limit=50/);
  assert.match(sellerLane, /fetch\(sellerQueueUrl/);
  assert.match(sellerLane, /credentials:\s*'include'/);
  assert.match(sellerLane, /item\.raw_message/);
  assert.match(sellerLane, /item\.observed_name/);
  assert.match(sellerLane, /item\.source_identity_masked \|\| item\.source_identity/);
  assert.match(sellerLane, /item\.source_system/);
  assert.match(sellerLane, /item\.source_listing_type/);
  assert.match(sellerLane, /item\.source_posted_at/);
  assert.match(sellerLane, /proposedDealer\?\.display_name/);
  assert.match(sellerLane, /proposedDealer\?\.company_name/);
  assert.match(sellerLane, /type="checkbox"/);
  assert.match(sellerLane, /I confirm the source seller, this exact listing/);
  assert.match(sellerLane, /setNextCursor\(Number\.isSafeInteger\(returnedCursor\)/);
  assert.match(sellerLane, /Seller review page \{cursorHistory\.length \+ 1\}/);
  assert.doesNotMatch(sellerLane, /seller_phone|phone|email|whatsapp/i);
});

test('seller approval is fail-closed and both decisions are audited', () => {
  assert.match(sellerLane, /fetch\('\/api\/seller-lineage-review-decision'/);
  assert.match(sellerLane, /lineageId:\s*item\.lineage_id/);
  assert.match(sellerLane, /recordId,/);
  assert.match(sellerLane, /dealerId:\s*dealerId \|\| null/);
  assert.match(sellerLane, /decision,/);
  assert.match(sellerLane, /reason,/);
  assert.match(sellerLane, /reason\.length < 12/);
  assert.match(sellerLane, /decision === 'APPROVE' && \(!exactMatches\[item\.lineage_id\] \|\| !dealerId\)/);
  assert.match(sellerLane, /submit\(item, 'APPROVE'\)/);
  assert.match(sellerLane, /submit\(item, 'REJECT'\)/);
  assert.match(sellerLane, /minLength=\{12\}/);
});
