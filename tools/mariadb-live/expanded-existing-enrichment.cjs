'use strict';
// Pure proposed changes. The root executor must bind the current PostgreSQL
// beforeimage and reviewed source/version hashes before applying a proposal.
const assert=require('node:assert/strict');
const {verifySourceContent}=require('./content-provenance.cjs');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),empty=x=>x===null||x===undefined;
const PRICE_FIELDS=['original_price_text','original_price_amount','original_price_currency','original_price_role','price_usd','fx_rate','fx_source','fx_date'];
const PRICE_STATE=['price_status','price_research_eligible','included_in_statistics','statistics_exclusion_reason'];
const PRICE_ONLY_EXCLUSIONS=new Set(['PRICE_NOT_SUPPLIED','UNRESOLVED_CURRENCY','SOURCE_CURRENCY_NOT_ESTABLISHED','FX_RATE_UNAVAILABLE']);
const SOURCE_TIME=/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/;
function validSourceCalendar(value){const m=/^(\d{4})-(\d{2})-(\d{2})T/.exec(value);if(!m)return false;const [year,month,day]=m.slice(1).map(Number);const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];return year>0&&month>=1&&month<=12&&day>=1&&day<=days[month-1];}
function sameAmount(a,b){if(empty(a)||empty(b))return empty(a)&&empty(b);return decimal(a)===decimal(b);}
function decimal(value){const s=String(value);assert.match(s,/^\d+(?:\.\d+)?$/,'EXACT_DECIMAL_REQUIRED');const [whole,fraction='']=s.split('.');const w=whole.replace(/^0+(?=\d)/,'');const f=fraction.replace(/0+$/,'');return w+(f?'.'+f:'');}
function proposeExistingEnrichment({current,staged,candidate=null,materialized=null}){
 verifySourceContent(staged);const raw=staged.raw_payload;
 assert.equal(current.source_id,staged.source_id);assert.equal(current.source_hash,staged.source_hash);
 assert.equal(current.parent_listing_id,null);assert.equal(current.child_index,null);assert.equal(current.is_bundle,false);
 assert.equal(current.category,'WATCH');assert.ok(['WTS','WTB'].includes(current.intent));
 if(staged.id)assert.equal(current.raw_message_id,staged.id);
 assert.ok(['description','title','comments'].some(k=>typeof raw[k]==='string'&&raw[k]===current.raw_message_text),'EXACT_CURRENT_RAW_FIELD_REQUIRED');
 const patch={},preserved=[],conflicts=[];
 const add=(field,value)=>{if(empty(value))return;if(empty(current[field]))patch[field]=value;else if(!same(current[field],value))preserved.push(field);};
 add('source_listing_status',empty(raw.status)?null:String(raw.status));
 add('source_created_at_text',empty(raw.created_on)?null:String(raw.created_on));
 if(Object.hasOwn(raw,'deleted_on'))add('source_deleted',!empty(raw.deleted_on)&&String(raw.deleted_on)!=='');
 if(typeof raw.country==='string'&&raw.country.trim())add('location_country',raw.country.trim());
 const region=[raw.location,raw.region].find(v=>typeof v==='string'&&v.trim());if(region)add('location_region',region.trim());
 // Preserve source wall-clock text. A timestamp requires an explicit zone.
 if(typeof raw.created_on==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.created_on)){
  if(SOURCE_TIME.test(raw.created_on)&&validSourceCalendar(raw.created_on))add('source_created_at',raw.created_on);else conflicts.push('INVALID_EXPLICIT_SOURCE_TIMESTAMP');
 }
 if(candidate){const f=candidate.fields;
  assert.equal(candidate.source_id,staged.source_id);assert.equal(candidate.source_hash,staged.source_hash);
  if(candidate.kind!=='SINGLE'||candidate.decision.trading_floor!=='TF_SUPPORTED_CANDIDATE'||candidate.decision.reasons.length
    ||!['brand','reference','intent'].every(k=>same(current[k],f[k])))conflicts.push('CANDIDATE_IDENTITY_OR_SCOPE_REQUIRES_REVIEW');
  else{
   for(const k of ['model','dial_color','year','condition']){if(!empty(current[k])&&!empty(f[k])&&!same(current[k],f[k]))conflicts.push(k);else add(k,f[k]);}
   if(materialized){assert.equal(materialized.listing_id,current.listing_id);assert.equal(materialized.source_id,current.source_id);assert.equal(materialized.source_hash,current.source_hash);assert.equal(materialized.raw_message_id,current.raw_message_id);assert.equal(materialized.parent_listing_id,null);assert.equal(materialized.child_index,null);
    for(const k of ['brand','reference','intent'])assert.equal(materialized[k],current[k]);
    assert.ok(sameAmount(materialized.original_price_amount,f.original_price_amount));assert.equal(materialized.original_price_currency,f.original_price_currency);assert.equal(materialized.original_price_role,f.original_price_role);
    const amountConflict=!empty(current.original_price_amount)&&!sameAmount(current.original_price_amount,materialized.original_price_amount);
    const currencyConflict=!empty(current.original_price_currency)&&current.original_price_currency!==materialized.original_price_currency;
    const roleConflict=!empty(current.original_price_role)&&current.original_price_role!==materialized.original_price_role;
    if(amountConflict||currencyConflict||roleConflict)conflicts.push('ORIGINAL_PRICE_CONFLICT');
    else{
     // Never revalue an existing verified price merely because a newer FX
     // document is available. Existing nonnull fields retain their evidence.
     const hasVerifiedUsd=!empty(current.price_usd);
     for(const k of PRICE_FIELDS){if(hasVerifiedUsd&&['price_usd','fx_rate','fx_source','fx_date'].includes(k))continue;add(k,materialized[k]);}
     if(!hasVerifiedUsd&&!empty(materialized.original_price_amount)){
      if(!same(current.price_status,materialized.price_status))patch.price_status=materialized.price_status;
      if(current.intent==='WTS'&&(empty(current.statistics_exclusion_reason)||PRICE_ONLY_EXCLUSIONS.has(current.statistics_exclusion_reason))){
       for(const k of PRICE_STATE.filter(k=>k!=='price_status'))if(!same(current[k],materialized[k]))patch[k]=materialized[k];
      }else if(current.intent==='WTS')conflicts.push('PRESERVED_NON_PRICE_RESEARCH_EXCLUSION');
     }
     if(current.intent==='WTB'){assert.equal(materialized.price_research_eligible,false);assert.equal(materialized.included_in_statistics,false);}
    }
   }
  }
 }
 const after={...current,...patch};
 for(const k of ['listing_id','source_id','source_hash','raw_message_id','raw_message_text','description','image_url','thumbnail_url','image_key','brand','reference','intent','seller_id','parent_listing_id','child_index'])assert.ok(same(after[k],current[k]),'IMMUTABLE_EXISTING_FIELD_CHANGED');
 return {patch,after,changed_fields:Object.keys(patch).sort(),preserved_fields:[...new Set(preserved)].sort(),review_reasons:[...new Set(conflicts)].sort()};
}
module.exports={proposeExistingEnrichment,sameAmount};
