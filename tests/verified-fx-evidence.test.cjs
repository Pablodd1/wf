'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fetchFxSnapshot}=require('../tools/mariadb-live/fetch-fx-snapshot.cjs');
const {SUPPORTED_CURRENCIES}=require('../api/_lib/fx-rates.cjs');
const {verifyFxEvidence}=require('../tools/mariadb-live/verified-fx-evidence.cjs');
const {stableJson}=require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');
const crypto=require('node:crypto');
async function fixture() {
 const csv=['CURRENCY,TIME_PERIOD,OBS_VALUE',...SUPPORTED_CURRENCIES.filter(c=>c!=='EUR').map(c=>`${c},2026-09-04,${c==='USD'?1.2:c==='HKD'?9.36:2}`)].join('\n');
 return fetchFxSnapshot({now:new Date('2026-09-06T00:00:00Z'),fetchImpl:async()=>({ok:true,text:async()=>csv})});
}
test('retained source CSV reproduces the exact dated USD-per-unit document and hash',async()=>{
 const snapshot=await fixture();const proof=await verifyFxEvidence(snapshot);
 assert.equal(proof.document.observed_date,'2026-09-04');
 assert.equal(proof.document.usd_per_unit.HKD,1/7.8);
 assert.equal(proof.canonical_json,stableJson(proof.document));
 assert.equal(proof.evidence_hash,crypto.createHash('sha256').update(proof.canonical_json).digest('hex'));
});
test('changed conversion values, altered provider evidence, mismatched dates and unsupported rates are refused',async()=>{
 const snapshot=await fixture();
 const variants=[
  {...snapshot,usd_per_unit:{...snapshot.usd_per_unit,HKD:1}},
  {...snapshot,usd_per_unit:{...snapshot.usd_per_unit,USDT:1}},
  {...snapshot,observed_at:'2026-09-05T00:00:00Z'},
  {...snapshot,source_evidence:{...snapshot.source_evidence,raw_csv:snapshot.source_evidence.raw_csv+'\nUSD,2026-09-04,99'}},
  {...snapshot,source_evidence:{...snapshot.source_evidence,request_url:'https://example.test/quotes'}},
 ];
 for(const altered of variants) await assert.rejects(verifyFxEvidence(altered),/FX_SOURCE_EVIDENCE_UNVERIFIED/);
});
