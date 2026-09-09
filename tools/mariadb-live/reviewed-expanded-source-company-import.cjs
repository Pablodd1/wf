'use strict';
const crypto=require('node:crypto');
const {prepareCompanyDealerEvidence}=require('./company-dealer-evidence.cjs');
const {redactPublicSource}=require('../../api/_lib/source-redaction.cjs');
function refuse(code){throw new Error(code);}
function companyUuid(companyId){
 const b=crypto.createHash('sha256').update('WF_VERIFIED_SOURCE_COMPANY_V1:'+companyId).digest().subarray(0,16);
 b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
// Owner-operated reviewed import only. No HTTP handler exposes this function.
// Each public identity requires an exact admitted expanded candidate plus a full,
// authenticated company census. Directory membership alone is insufficient.
async function importReviewedExpandedSourceCompanies(db,{snapshotBytes,expectedSnapshotSha256,identities,sourcePosterPermission=null}){
 let permission=null;
 if(sourcePosterPermission){
  const {bytes,sha256}=sourcePosterPermission;
  if(!Buffer.isBuffer(bytes)||!/^[a-f0-9]{64}$/.test(sha256||'')||crypto.createHash('sha256').update(bytes).digest('hex')!==sha256)refuse('COMPANY_IMPORT_PERMISSION_HASH_MISMATCH');
  const attestation=JSON.parse(bytes.toString('utf8'));
  if(attestation.contract!=='WF_OWNER_ATTESTED_EXPANDED_POSTER_CONTACT_PERMISSION_V3'||attestation.permission_inferred!==false||attestation.scope!=='Exact source-linked posters of reviewed supported single-watch listings and unbundled watch children'||attestation.company_snapshot_sha256!==expectedSnapshotSha256||!Number.isFinite(Date.parse(attestation.recorded_at))||!attestation.owner_statement)refuse('COMPANY_IMPORT_PERMISSION_SCOPE_INVALID');
  permission={contract:attestation.contract,sha256,approval_source:'COMPANY_OWNER_ATTESTATION_OF_EXPLICIT_POSTER_PERMISSION',recorded_at:attestation.recorded_at,purpose:attestation.purpose};
 }
 if(!permission)refuse('EXPANDED_COMPANY_IMPORT_EXPLICIT_OWNER_SCOPE_REQUIRED');
 const review=prepareCompanyDealerEvidence(snapshotBytes,expectedSnapshotSha256,{includeSourcePosters:!!permission}),snapshot=JSON.parse(snapshotBytes.toString('utf8'));
 if(snapshot.capture_scope!=='COMPLETE_TABLE'||snapshot.expected_rows!==snapshot.companies.length||!Array.isArray(identities)||!identities.length||identities.length>5000)refuse('COMPANY_IMPORT_BOUNDARY_INVALID');
 const seen=new Set(),prepared=[],companyById=new Map(snapshot.companies.map(company=>[String(company.id),company]));
 for(const selected of identities){
  const key=selected.company_id+':'+selected.phone;if(seen.has(key))refuse('COMPANY_IMPORT_DUPLICATE_IDENTITY');seen.add(key);
  const found=await db.query(`SELECT * FROM wf_canonical_staging.mariadb_raw_source_rows
   WHERE source_system=$1 AND source_database=$2 AND source_table=$3 AND source_id=$4 AND source_hash=$5`,
  [selected.source_system,selected.source_database,selected.source_table,selected.first_source_id,selected.first_source_hash]);
  if(found.rows.length!==1)refuse('COMPANY_IMPORT_EXACT_RAW_MISSING');
  const raw=found.rows[0],proof=review(raw);
  // Exact expanded admission, not merely directory membership or a raw bundle.
  if(!/^[a-f0-9]{64}$/.test(selected.candidate_hash||'')||!/^[a-f0-9]{64}$/.test(selected.review_manifest_sha256||''))refuse('EXPANDED_COMPANY_IMPORT_SELECTED_CANDIDATE_REQUIRED');
  const accepted=await db.query(`SELECT c.raw_row_id,c.source_hash,c.kind,c.policy_hash,c.canonical_json,
    a.review_manifest_sha256,wf_canonical_staging.verify_expanded_candidate_content_v3(c.raw_row_id,c.policy_hash,c.canonical_json,c.candidate_hash) candidate
   FROM wf_canonical_staging.expanded_listing_candidates_v3 c
   JOIN wf_canonical_staging.expanded_candidate_admissions_v3 a USING(candidate_hash)
   WHERE c.candidate_hash=$1`,[selected.candidate_hash]);
  if(accepted.rows.length!==1)refuse('EXPANDED_COMPANY_IMPORT_ADMISSION_MISSING');
  const admitted=accepted.rows[0];
  if(admitted.raw_row_id!==raw.id||admitted.source_hash!==raw.source_hash||admitted.review_manifest_sha256!==selected.review_manifest_sha256
    ||!['SINGLE','CHILD'].includes(admitted.kind)||admitted.candidate?.decision?.trading_floor!=='TF_SUPPORTED_CANDIDATE')refuse('EXPANDED_COMPANY_IMPORT_ADMISSION_SCOPE_MISMATCH');

  if(typeof raw.raw_payload_text!=='string'||crypto.createHash('sha256').update(raw.raw_payload_text).digest('hex')!==raw.source_hash)refuse('COMPANY_IMPORT_RAW_BYTES_MISMATCH');
  if(!['EXACT_SOURCE_POSTER_CANDIDATE','VERIFIED_SOURCE_IDENTITY_CANDIDATE'].includes(proof.outcome)||proof.company_id!==selected.company_id||proof.private_phone_identity!==selected.phone||proof.company_fields_sha256!==selected.company_fields_sha256||!/^\+?[1-9]\d{7,14}$/.test(proof.private_phone_identity||''))refuse('COMPANY_IMPORT_SOURCE_PROOF_MISMATCH');
  let name=redactPublicSource(proof.source_company_name).trim();
  let publicNameEvidence=null,companyName=null;
  if(selected.public_name_review){
   const review=selected.public_name_review;
   if(['WF_EXACT_SOURCE_POSTER_LABEL_REVIEW_V3','WF_EXACT_SOURCE_POSTER_WHITESPACE_REVIEW_V3'].includes(review.contract)){
    const original=raw.raw_payload.from_name;
    const rendered=review.contract==='WF_EXACT_SOURCE_POSTER_WHITESPACE_REVIEW_V3'&&typeof original==='string'?original.replace(/\s+/gu,' ').trim():original;
    if(!permission||review.source_field!=='from_name'||review.raw_row_id!==raw.id||review.source_id!==raw.source_id||review.source_hash!==raw.source_hash
     ||typeof raw.raw_payload.from_name!=='string'||review.source_text_sha256!==crypto.createHash('sha256').update(raw.raw_payload.from_name).digest('hex')
     ||review.normalized_name!==rendered||!/^[a-f0-9]{64}$/.test(review.review_packet_sha256||''))refuse('COMPANY_IMPORT_PUBLIC_NAME_PROOF_MISMATCH');
    name=redactPublicSource(review.normalized_name).trim();publicNameEvidence=review;
   }else{
   if(review.contract!=='WF_EXACT_SOURCE_NAME_WHITESPACE_REVIEW_V1'||review.source_field!=='name'
    ||typeof proof.source_company_name!=='string'||companyById.get(selected.company_id)?.name!==proof.source_company_name
    ||review.source_text_sha256!==crypto.createHash('sha256').update(proof.source_company_name).digest('hex')
    ||review.normalized_name!==proof.source_company_name.replace(/\s+/gu,' ').trim()
    ||!/^[a-f0-9]{64}$/.test(review.review_packet_sha256||''))refuse('COMPANY_IMPORT_PUBLIC_NAME_PROOF_MISMATCH');
   name=redactPublicSource(review.normalized_name);
   publicNameEvidence=review;
   }
  }
  if(!['WF_EXACT_SOURCE_POSTER_LABEL_REVIEW_V3','WF_EXACT_SOURCE_POSTER_WHITESPACE_REVIEW_V3'].includes(publicNameEvidence?.contract))companyName=name;
  if(!name||name.length>200||/^[\d\s()+.-]+$/.test(name)||/\[.*redacted\]/.test(name)||/[\u0000-\u001f]/.test(name))refuse('COMPANY_IMPORT_PUBLIC_NAME_REQUIRES_REVIEW');
  prepared.push({id:companyUuid(proof.company_id),name,companyName,phone:proof.private_phone_identity,status:permission?'UNVERIFIED':'VERIFIED',identitySource:permission?'WF_SOURCE_POSTER_V1':'WF_VERIFIED_SOURCE_COMPANY_V1',metadata:{contract:permission?'WF_COMPLETE_SOURCE_POSTER_IDENTITY_V1':'WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1',company_id:proof.company_id,
   company_snapshot_sha256:expectedSnapshotSha256,company_fields_sha256:proof.company_fields_sha256,
   source_system:raw.source_system,source_database:raw.source_database,source_table:raw.source_table,
   evidence_raw_row_id:raw.id,evidence_source_id:raw.source_id,evidence_source_hash:raw.source_hash,
   company_observed_at:proof.company_observed_at,contact_consent_inferred:false,reviews_inferred:false,
   expanded_listing_evidence:{candidate_hash:selected.candidate_hash,kind:admitted.kind,policy_hash:admitted.policy_hash,review_manifest_sha256:selected.review_manifest_sha256},
   ...(publicNameEvidence?{public_name_review:publicNameEvidence}:{}),
   ...(permission?{source_identity_evidence:'EXACT_COMPANY_PHONE_MATCH',contact_permission_evidence:permission,dealer_verification_inferred:false}:{})}});
 }
 // Caller owns BEGIN/COMMIT/ROLLBACK for this owner-only operation.
 await db.query(`INSERT INTO wf_canonical_staging.source_company_identity_snapshots_v2(snapshot_sha256,canonical_text,document)
  VALUES($1,$2::text,$2::text::jsonb) ON CONFLICT(snapshot_sha256) DO NOTHING`,[expectedSnapshotSha256,snapshotBytes.toString('utf8')]);
 let created=0,reused=0;
 for(const p of prepared){
  const old=(await db.query('SELECT * FROM public.dealers WHERE id=$1 FOR UPDATE',[p.id])).rows[0];
  if(old){
   if(old.status!==p.status||old.display_name!==p.name||old.company_name!==p.companyName||old.metadata?.contract!==p.metadata.contract||old.metadata?.company_snapshot_sha256!==expectedSnapshotSha256||(permission&&(!old.contact_consent||old.metadata?.contact_permission_evidence?.sha256!==permission.sha256)))refuse('COMPANY_IMPORT_EXISTING_DEALER_CHANGED');
   reused++;
  }else{
   await db.query(`INSERT INTO public.dealers(id,slug,display_name,company_name,status,contact_consent,rating,review_count,verified_at,metadata,last_synced_at)
    VALUES($1,$2,$3,$8,$4,$5,NULL,0,$6,$7,now())`,[p.id,'source-company-'+p.metadata.company_id,p.name,p.status,!!permission,permission?null:p.metadata.company_observed_at,p.metadata,p.companyName]);created++;
  }
  const prior=(await db.query(`SELECT dealer_id,source_system,source_identity,metadata FROM public.dealer_source_identities
   WHERE verification_status='VERIFIED' AND upper(identity_type) IN('PHONE','WHATSAPP') AND public.normalize_seller_phone_identity(source_identity)=$1`,[p.phone])).rows;
  if(prior.length){
   if(prior.length!==1||prior[0].dealer_id!==p.id||prior[0].source_system!==p.identitySource||prior[0].metadata?.company_snapshot_sha256!==expectedSnapshotSha256||prior[0].metadata?.company_id!==p.metadata.company_id)refuse('COMPANY_IMPORT_EXISTING_PHONE_CONFLICT');
  }else await db.query(`INSERT INTO public.dealer_source_identities(dealer_id,source_system,source_identity,identity_type,verification_status,metadata)
   VALUES($1,$2,$3,'PHONE','VERIFIED',$4)`,[p.id,p.identitySource,p.phone,p.metadata]);
 }
 return {identities:prepared.length,created_dealers:created,reused_dealers:reused,company_snapshot_sha256:expectedSnapshotSha256,contact_consent_inferred:false,reviews_inferred:false};
}
module.exports={importReviewedExpandedSourceCompanies,companyUuid};
