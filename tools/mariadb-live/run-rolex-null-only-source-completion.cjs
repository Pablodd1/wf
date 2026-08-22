#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getClient } = require('../../api/_lib/supabase');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function args(argv) {
  const value = {};
  for (let i=0;i<argv.length;i+=2) value[argv[i].replace(/^--/,'')]=argv[i+1];
  if (!['canary','full','rollback'].includes(value.mode) || !value['run-key'] || !value.confirm) throw new Error('mode, run-key, and confirm required');
  return value;
}
function exactConfirm(o) {
  const expected=o.mode==='canary'?`ACTIVATE_CANARY_${o['run-key']}`:o.mode==='full'?`ACTIVATE_FULL_${o['run-key']}`:`ROLLBACK_${o['run-key']}`;
  if (o.confirm!==expected) throw new Error(`Exact confirmation required: ${expected}`);
}
function mergeManifest(manifest) {
  if (manifest?.contract!=='watchfacts-rolex-null-only-candidates-v1' || manifest.project_ref!=='qnsafosakvonzgfcsphh') throw new Error('Invalid candidate manifest');
  const records=new Map();
  for (const row of manifest.prices||[]) records.set(row.listing_id,{...row});
  for (const row of manifest.images||[]) records.set(row.listing_id,{...(records.get(row.listing_id)||{}),...row});
  return [...records.values()].sort((a,b)=>a.listing_id.localeCompare(b.listing_id));
}
function canary(records) {
  const selected=[];
  for (const predicate of [r=>r.proposed_price_usd&&r.proposed_image_url,r=>r.proposed_price_usd,r=>r.proposed_image_url]) {
    const found=records.find(row=>predicate(row)&&!selected.includes(row)); if(found) selected.push(found);
  }
  for (const row of records) { if(selected.length>=10) break; if(!selected.includes(row)) selected.push(row); }
  return selected.sort((a,b)=>a.listing_id.localeCompare(b.listing_id));
}
function proposal(row) {
  const keep=['listing_id','raw_message_version_id','source_record_id','source_hash','source_candidate_hash','normalized_reference',
    'proposed_price_usd','source_price_amount','source_currency','currency_evidence','conversion_rate','conversion_timestamp',
    'conversion_source','proposed_image_url','source_media_key','source_media_sha256','image_verified_at'];
  const value={}; for(const key of keep) if(row[key]!==null&&row[key]!==undefined&&row[key]!=='') value[key]=row[key];
  if (!/^[0-9a-f-]{36}$/i.test(value.listing_id||'') || !/^[0-9a-f]{64}$/.test(value.source_hash||'')
    || !/^[0-9a-f]{64}$/.test(value.source_candidate_hash||'') || (!value.proposed_price_usd&&!value.proposed_image_url)) throw new Error('Invalid proposal');
  const canonical=stable(value); return {...value,proposal_canonical:canonical,proposal_sha256:sha256(canonical)};
}
async function rpc(client,name,input) { const {data,error}=await client.rpc(name,input); if(error) throw new Error(`${name}: ${error.message||error}`); return data; }

async function managementQuery(sql) {
  const response=await fetch('https://api.supabase.com/v1/projects/qnsafosakvonzgfcsphh/database/query',{
    method:'POST',headers:{authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'content-type':'application/json'},
    body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(300000)});
  const body=await response.text(); if(!response.ok) throw new Error(`Null-only preflight failed ${response.status}: ${body.slice(0,300)}`);
  return JSON.parse(body);
}
async function stillMissing(records,minimum=Number.POSITIVE_INFINITY) {
  const output=[];
  for(let offset=0;offset<records.length;offset+=500){
    const page=records.slice(offset,offset+500);
    const ids=page.map(row=>{if(!/^[0-9a-f-]{36}$/i.test(row.listing_id)) throw new Error('Invalid listing ID');return `'${row.listing_id}'::uuid`;}).join(',');
    const current=await managementQuery(`SELECT id::text,COALESCE(price_usd,price_normalized,0)>0 has_price,
      NULLIF(btrim(COALESCE(image_url,source_media_url_candidate,'')),'') IS NOT NULL has_image
      FROM staging.listings WHERE id IN (${ids});`);
    const byId=new Map(current.map(row=>[row.id,row]));
    for(const original of page){
      const state=byId.get(original.listing_id); if(!state) continue;
      const row={...original};
      if(state.has_price){for(const key of ['proposed_price_usd','source_price_amount','source_currency','currency_evidence','conversion_rate','conversion_timestamp','conversion_source']) delete row[key];}
      if(state.has_image){for(const key of ['proposed_image_url','source_media_key','source_media_sha256','image_verified_at']) delete row[key];}
      if(row.proposed_price_usd||row.proposed_image_url) output.push(row);
    }
    if(output.length>=minimum) break;
  }
  return output;
}

async function main() {
  const o=args(process.argv.slice(2)); exactConfirm(o);
  if(String(process.env.SUPABASE_URL||'').replace(/\/$/,'')!=='https://qnsafosakvonzgfcsphh.supabase.co') throw new Error('Refusing non-QNSA target');
  const client=getClient();
  if(o.mode==='rollback') { const result=await rpc(client,'rollback_qnsa_rolex_null_only_completion',{p_run_key:o['run-key']}); process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  const file=path.resolve(o.manifest||'candidate-manifest.json'); const bytes=fs.readFileSync(file);
  const digest=sha256(bytes); if(digest!==o['manifest-sha256']) throw new Error('Candidate manifest checksum mismatch');
  const all=mergeManifest(JSON.parse(bytes));
  const eligible=await stillMissing(all,o.mode==='canary'?20:Number.POSITIVE_INFINITY);
  const chosen=(o.mode==='canary'?canary(eligible):eligible).map(proposal);
  if(!chosen.length) throw new Error('No deterministic null-only candidates');
  await rpc(client,'begin_qnsa_rolex_null_only_completion',{p_run_key:o['run-key'],p_mode:o.mode.toUpperCase(),p_manifest_sha256:digest,p_expected_count:chosen.length});
  for(let offset=0;offset<chosen.length;offset+=500) await rpc(client,'stage_qnsa_rolex_null_only_completion',{p_run_key:o['run-key'],p_records:chosen.slice(offset,offset+500)});
  await rpc(client,'finalize_qnsa_rolex_null_only_completion',{p_run_key:o['run-key']});
  const result=await rpc(client,'activate_qnsa_rolex_null_only_completion',{p_run_key:o['run-key']});
  process.stdout.write(`${JSON.stringify({event:'rolex_null_only_completion',mode:o.mode,manifest_sha256:digest,
    selected:chosen.length,prices:chosen.filter(r=>r.proposed_price_usd).length,images:chosen.filter(r=>r.proposed_image_url).length,
    result,raw_text_logged:false,contact_values_logged:false})}\n`);
}
if (require.main === module) main().catch(error=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});

module.exports={canary,mergeManifest,proposal,stable};
