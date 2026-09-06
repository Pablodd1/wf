'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRpc}=require('./run-frozen-normalization-v2.cjs');
const {captureSourceImageEvidence}=require('./source-image-evidence-v2.cjs');

async function run({rpc,jobName,batchSize=20,maxBatches=Infinity,onProgress=()=>{},captureImage=captureSourceImageEvidence,disposableBase}) {
 if(!jobName||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>25) throw new Error('INVALID_MATERIALIZATION_WORKER_CONFIG');
 for(let batch=0;batch<maxBatches;batch++) {
  const next=await rpc('read_materialization_workflow_batch_v2',{p_job_name:jobName,p_limit:batchSize});
  if(!next||!Array.isArray(next.members)||!next.job) throw new Error('INVALID_MATERIALIZATION_BATCH_RESPONSE');
  if(next.job.complete){onProgress(next.job);return next.job;}
  if(!next.members.length) throw new Error('MATERIALIZATION_CHECKPOINT_UNRECONCILED');
  const prepared=new Array(next.members.length);let index=0;
  // Four bounded probes at a time; source evidence never leaves this private
  // process except the reviewed fixed-origin image requests and receipt RPC.
  await Promise.all(Array.from({length:Math.min(4,next.members.length)},async()=>{
   while(index<next.members.length){
    const position=index++;const member=next.members[position];
    let evidenceHash=null,outcome='NOT_APPLICABLE';
    if(member.outcome==='NORMALIZED'){
     if(member.existing_image){evidenceHash=member.existing_image.evidence_hash;outcome=member.existing_image.verified?'VERIFIED_SOURCE_IMAGE':'SOURCE_IMAGE_UNAVAILABLE';}
     else{
      let captured;
      try{captured=await captureImage(member.raw,{disposableBase});}
      catch(error){
       if(!/^PROVENANCE_/.test(String(error.code||error.message))) throw error;
       captured={outcome:'SOURCE_PROVENANCE_REQUIRES_REVIEW',proof:null};
      }
      outcome=captured.outcome;
      if(captured.proof){
       const proof=captured.proof;
       await rpc('stage_source_image_evidence_v2',{p_document:proof.document,p_canonical_json:proof.canonical_json,p_evidence_hash:proof.evidence_hash});
       evidenceHash=proof.evidence_hash;
      }
     }
    }
    prepared[position]={raw_row_id:member.raw_row_id,proposal_hash:member.proposal_hash,
     image_evidence_hash:evidenceHash,image_probe_outcome:outcome};
   }
  }));
  const committed=await rpc('commit_materialization_workflow_batch_v2',{p_job_name:jobName,
   p_expected_cursor:next.job.cursor_raw_row_id,p_request_id:crypto.randomUUID(),p_members:prepared});
  if(!committed?.job) throw new Error('INVALID_MATERIALIZATION_COMMIT_RESPONSE');
  onProgress(committed.job);if(committed.job.complete)return committed.job;
 }
 return rpc('get_materialization_workflow_v2',{p_job_name:jobName});
}
async function main(env=process.env){
 if(env.WF_MATERIALIZATION_EXECUTE!=='true') throw new Error('MATERIALIZATION_EXECUTION_FLAG_REQUIRED');
 if(!env.WF_MATERIALIZATION_JOB||!env.WF_MATERIALIZATION_PROGRESS_FILE) throw new Error('MATERIALIZATION_JOB_AND_PROGRESS_FILE_REQUIRED');
 const file=path.resolve(env.WF_MATERIALIZATION_PROGRESS_FILE);fs.mkdirSync(path.dirname(file),{recursive:true});
 const onProgress=job=>{
  const progress={job_name:job.job_name,normalization_job_name:job.normalization_job_name,expected_rows:job.expected_rows,
   processed_rows:job.processed_rows,eligible_rows:job.eligible_rows,review_rows:job.review_rows,bundle_rows:job.bundle_rows,
   quarantine_rows:job.quarantine_rows,error_rows:job.error_rows,complete:job.complete,updated_at:job.updated_at,publication_performed:false};
  fs.writeFileSync(file+'.tmp',JSON.stringify(progress,null,2));fs.renameSync(file+'.tmp',file);console.log(JSON.stringify(progress));
 };
 await run({rpc:createRpc(env),jobName:env.WF_MATERIALIZATION_JOB,
  batchSize:env.WF_MATERIALIZATION_BATCH_SIZE?Number(env.WF_MATERIALIZATION_BATCH_SIZE):20,
  disposableBase:env.DISPOSABLE_IMAGE_BASE_URL||undefined,onProgress});
}
if(require.main===module) main().catch(error=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'MATERIALIZATION_WORKER_FAILED');process.exitCode=1;});
module.exports={run};
