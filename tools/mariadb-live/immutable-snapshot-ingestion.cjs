'use strict';
const crypto=require('node:crypto');
const {stableJson,sanitizeLosslessPayload}=require('./lossless-payload-sanitizer.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

// The caller supplies a verified immutable snapshot chunk. Never consult the
// changing source database or reconstruct a date cursor during this copy.
function prepareChunk(canonicalBytes,chunk,manifest){
 if(!Buffer.isBuffer(canonicalBytes)||hash(canonicalBytes)!==chunk.canonical_sha256||canonicalBytes.length!==chunk.canonical_bytes)
  throw new Error('SNAPSHOT_CHUNK_BYTES_INVALID');
 const text=canonicalBytes.toString('utf8');if(!text.endsWith('\n'))throw new Error('SNAPSHOT_CHUNK_TERMINATOR_INVALID');
 const lines=text.slice(0,-1).split('\n');if(lines.length!==chunk.rows||lines.length<1||lines.length>5000)throw new Error('SNAPSHOT_CHUNK_COUNT_INVALID');
 let previous='';
 const records=lines.map(line=>{
  const original=JSON.parse(line);
  if(stableJson(original)!==line||typeof original.id!=='string'||original.id<=previous)throw new Error('SNAPSHOT_CANONICAL_ID_INVALID');
  previous=original.id;
  const transport=sanitizeLosslessPayload(original),payload=transport.sanitizedObj;
  return {source_system:manifest.source_system,source_database:manifest.source_database,source_table:manifest.source_table,
   source_id:original.id,source_record_id:original.id,source_hash:hash(line),raw_sha256:hash(line),raw_payload_text:line,
   raw_payload:payload,raw_message:payload.description??null,raw_message_source:'description',captured_at:manifest.started_at,
   hash_algorithm:'sha256',canonicalization_version:'v1-json-keys-sorted-compact'};
 });
 if(records[0].source_id!==chunk.first_id||previous!==chunk.last_id)throw new Error('SNAPSHOT_CHUNK_ENDPOINT_INVALID');
 return records;
}

async function ingestChunk(db,{manifestSha256,chunkIndex,records,onBatch=()=>{}}){
 if(!/^[a-f0-9]{64}$/.test(manifestSha256)||!Number.isSafeInteger(chunkIndex)||chunkIndex<0||!Array.isArray(records)||records.length<1||records.length>5000)
  throw new Error('SNAPSHOT_INGEST_ARGUMENT_INVALID');
 const ids=[];let inserted=0;
 // Committed raw rows remain immutable if a later batch fails. A retry reuses
 // the exact source/hash tuple; the final chunk binding is atomic and checked.
 for(let offset=0;offset<records.length;offset+=250){
  const batch=records.slice(offset,offset+250);
  await db.query('BEGIN');
  try{
   const saved=await db.query(`WITH incoming AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(source_system text,source_database text,source_table text,
     source_id text,source_record_id text,source_hash text,raw_sha256 text,raw_payload_text text,raw_payload jsonb,
     raw_message text,raw_message_source text,captured_at timestamptz,hash_algorithm text,canonicalization_version text)
   ) INSERT INTO wf_canonical_staging.mariadb_raw_source_rows
    (source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,
     raw_payload,raw_message,raw_message_source,captured_at,hash_algorithm,canonicalization_version)
   SELECT source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,
     raw_payload,raw_message,raw_message_source,captured_at,hash_algorithm,canonicalization_version FROM incoming
   ON CONFLICT(source_system,source_database,source_table,source_id,source_hash) DO NOTHING RETURNING id`,[JSON.stringify(batch)]);
   const resolved=await db.query(`SELECT r.id,r.source_id,r.source_hash FROM jsonb_to_recordset($1::jsonb)
    AS x(source_system text,source_database text,source_table text,source_id text,source_hash text,raw_payload_text text)
    JOIN wf_canonical_staging.mariadb_raw_source_rows r ON
    (r.source_system,r.source_database,r.source_table,r.source_id,r.source_hash)=
    (x.source_system,x.source_database,x.source_table,x.source_id,x.source_hash)
    WHERE r.raw_payload_text=x.raw_payload_text ORDER BY r.source_id COLLATE "C"`,[JSON.stringify(batch)]);
   if(resolved.rows.length!==batch.length)throw new Error('SNAPSHOT_EXISTING_RAW_CONTENT_MISMATCH');
   await db.query('COMMIT');inserted+=saved.rowCount;ids.push(...resolved.rows.map(r=>r.id));
   await onBatch({committed_rows:ids.length,new_rows:inserted});
  }catch(error){await db.query('ROLLBACK');throw error;}
 }
 const bound=await db.query('SELECT public.bind_immutable_source_snapshot_chunk($1,$2,$3::uuid[]) AS result',[manifestSha256,chunkIndex,ids]);
 return {rows:records.length,new_rows:inserted,identical_rows:records.length-inserted,binding:bound.rows[0].result};
}
module.exports={prepareChunk,ingestChunk};
