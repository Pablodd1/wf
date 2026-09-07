'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {Client}=require('./test-dependencies.cjs')('pg');
const {prepareChunk,ingestChunk}=require('../mariadb-live/immutable-snapshot-ingestion.cjs');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {verifySourceContent}=require('../mariadb-live/content-provenance.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});await db.connect();
 try{
  assert.equal((await db.query("SELECT to_regnamespace('wf_disposable_legacy') IS NOT NULL ok")).rows[0].ok,true);
  const scope='SYNTHETIC-INGEST-'+crypto.randomUUID();
  const raw=[{id:'SYNTHETIC-001',description:'  SYNTHETIC WTS Rolex 126610LN USD 12000\n',synthetic_fixture:true},
   {id:'SYNTHETIC-002',description:'SYNTHETIC null\u0000 character evidence',synthetic_fixture:true}];
  const bytes=Buffer.from(raw.map(stableJson).join('\n')+'\n');
  const chunk={rows:2,first_id:raw[0].id,last_id:raw[1].id,canonical_sha256:hash(bytes),canonical_bytes:bytes.length};
  const manifest={contract:'WF_IMMUTABLE_SOURCE_SNAPSHOT_V2',status:'COMPLETE',isolation:'REPEATABLE READ / CONSISTENT SNAPSHOT / READ ONLY',
   started_at:'2026-09-07T00:00:00.000Z',source_system:scope,source_database:'disposable',source_table:'auctions',rows:2,expected_rows:2,minimum_id:raw[0].id,maximum_id:raw[1].id,chunks:[chunk]};
  const canonical=stableJson(manifest),digest=hash(canonical);
  await db.query('SELECT public.register_immutable_source_snapshot($1,$2)',[canonical,digest]);
  assert.throws(()=>prepareChunk(Buffer.from(bytes.toString().replace('12000','99999')),chunk,manifest),/SNAPSHOT_CHUNK_BYTES_INVALID/);
  const records=prepareChunk(bytes,chunk,manifest);
  assert.equal(records[0].raw_message,raw[0].description);assert.equal(verifySourceContent(records[1]).lossless,true);
  const first=await ingestChunk(db,{manifestSha256:digest,chunkIndex:0,records});assert.equal(first.new_rows,2);
  const replay=await ingestChunk(db,{manifestSha256:digest,chunkIndex:0,records});assert.equal(replay.new_rows,0);assert.equal(replay.identical_rows,2);
  const stored=(await db.query('SELECT * FROM wf_canonical_staging.mariadb_raw_source_rows WHERE source_system=$1 ORDER BY source_id',[scope])).rows;
  assert.equal(stored.length,2);assert.equal(stored[0].raw_message,raw[0].description);
  for(let i=0;i<2;i++){assert.equal(stored[i].raw_payload_text,stableJson(raw[i]));assert.equal(stored[i].source_created_on,null);verifySourceContent(stored[i]);}
  assert.equal(Buffer.from(stored[1].raw_payload._lossless_raw_evidence.original_payload_base64,'base64').toString('utf8'),stableJson(raw[1]));
  const job=(await db.query('SELECT public.create_immutable_snapshot_normalization_job($1,$2) result',[digest,scope])).rows[0].result;assert.equal(Number(job.expected_rows),2);
  const result={status:'PASS',synthetic_only:true,production_mutations:0,checks:['Tampered chunk bytes rejected before ingestion','Source whitespace preserved','Null-byte payload preserved in lossless evidence','Raw canonical bytes survive PostgreSQL round trip','Exact retries reuse two rows without mutation','Unknown source timestamps stay null','Verified chunk creates exact two-row normalization job']};
  if(process.env.DISPOSABLE_REPORT_PATH)fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await db.end();}
}
main().catch(e=>{console.error('SNAPSHOT_INGESTION_TEST_FAILED',e.code||e.name);process.exitCode=1;});
