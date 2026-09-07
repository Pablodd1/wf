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
// Each public identity requires an exact persisted listing plus a full,
// authenticated company census. Directory membership alone is insufficient.
async function importReviewedSourceCompanies(db,{snapshotBytes,expectedSnapshotSha256,identities,sourcePosterPermission=null}){
 let permission=null;
 if(sourcePosterPermission){
  const {bytes,sha256}=sourcePosterPermission;
  if(!Buffer.isBuffer(bytes)||!/^[a-f0-9]{64}$/.test(sha256||'')||crypto.createHash('sha256').update(bytes).digest('hex')!==sha256)refuse('COMPANY_IMPORT_PERMISSION_HASH_MISMATCH');
  const attestation=JSON.parse(bytes.toString('utf8'));
  if(attestation.contract!=='WF_OWNER_ATTESTED_POSTER_CONTACT_PERMISSION_V1'||attestation.permission_inferred!==false||attestation.scope!=='All exact source-linked posters of eligible single listings'||attestation.company_snapshot_sha256!==expectedSnapshotSha256||!Number.isFinite(Date.parse(attestation.recorded_at))||!attestation.owner_statement)refuse('COMPANY_IMPORT_PERMISSION_SCOPE_INVALID');
  permission={contract:attestation.contract,sha256,approval_source:'COMPANY_OWNER_ATTESTATION_OF_EXPLICIT_POSTER_PERMISSION',recorded_at:attestation.recorded_at,purpose:attestation.purpose};
 }
 const review=prepareCompanyDealerEvidence(snapshotBytes,expectedSnapshotSha256,{includeSourcePosters:!!permission}),snapshot=JSON.parse(snapshotBytes.toString('utf8'));
 if(snapshot.capture_scope!=='COMPLETE_TABLE'||snapshot.expected_rows!==snapshot.companies.length||!Array.isArray(identities)||!identities.length||identities.length>5000)refuse('COMPANY_IMPORT_BOUNDARY_INVALID');
 const seen=new Set(),prepared=[];
 for(const selected of identities){
  const key=selected.company_id+':'+selected.phone;if(seen.has(key))refuse('COMPANY_IMPORT_DUPLICATE_IDENTITY');seen.add(key);
  const found=await db.query(`SELECT * FROM wf_canonical_staging.mariadb_raw_source_rows
   WHERE source_system=$1 AND source_database=$2 AND source_table=$3 AND source_id=$4 AND source_hash=$5`,
  [selected.source_system,selected.source_database,selected.source_table,selected.first_source_id,selected.first_source_hash]);
  if(found.rows.length!==1)refuse('COMPANY_IMPORT_EXACT_RAW_MISSING');
  const raw=found.rows[0],proof=review(raw);
  if(typeof raw.raw_payload_text!=='string'||crypto.createHash('sha256').update(raw.raw_payload_text).digest('hex')!==raw.source_hash)refuse('COMPANY_IMPORT_RAW_BYTES_MISMATCH');
  if(proof.outcome!==(permission?'EXACT_SOURCE_POSTER_CANDIDATE':'VERIFIED_SOURCE_IDENTITY_CANDIDATE')||proof.company_id!==selected.company_id||proof.private_phone_identity!==selected.phone||proof.company_fields_sha256!==selected.company_fields_sha256||!/^\+?[1-9]\d{7,14}$/.test(proof.private_phone_identity||''))refuse('COMPANY_IMPORT_SOURCE_PROOF_MISMATCH');
  const name=redactPublicSource(proof.source_company_name).trim();
  if(!name||name.length>200||/^[\d\s()+.-]+$/.test(name)||/\[.*redacted\]/.test(name)||/[\u0000-\u001f]/.test(name))refuse('COMPANY_IMPORT_PUBLIC_NAME_REQUIRES_REVIEW');
  prepared.push({id:companyUuid(proof.company_id),name,phone:proof.private_phone_identity,status:permission?'UNVERIFIED':'VERIFIED',identitySource:permission?'WF_SOURCE_POSTER_V1':'WF_VERIFIED_SOURCE_COMPANY_V1',metadata:{contract:permission?'WF_COMPLETE_SOURCE_POSTER_IDENTITY_V1':'WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1',company_id:proof.company_id,
   company_snapshot_sha256:expectedSnapshotSha256,company_fields_sha256:proof.company_fields_sha256,
   source_system:raw.source_system,source_database:raw.source_database,source_table:raw.source_table,
   evidence_raw_row_id:raw.id,evidence_source_id:raw.source_id,evidence_source_hash:raw.source_hash,
   company_observed_at:proof.company_observed_at,contact_consent_inferred:false,reviews_inferred:false,
   ...(permission?{source_identity_evidence:'EXACT_COMPANY_PHONE_MATCH',contact_permission_evidence:permission,dealer_verification_inferred:false}:{})}});
 }
 // Caller owns BEGIN/COMMIT/ROLLBACK for this owner-only operation.
 await db.query(`INSERT INTO wf_canonical_staging.source_company_identity_snapshots_v2(snapshot_sha256,canonical_text,document)
  VALUES($1,$2::text,$2::text::jsonb) ON CONFLICT(snapshot_sha256) DO NOTHING`,[expectedSnapshotSha256,snapshotBytes.toString('utf8')]);
 let created=0,reused=0;
 for(const p of prepared){
  const old=(await db.query('SELECT * FROM public.dealers WHERE id=$1 FOR UPDATE',[p.id])).rows[0];
  if(old){
   if(old.status!==p.status||old.display_name!==p.name||old.metadata?.contract!==p.metadata.contract||old.metadata?.company_snapshot_sha256!==expectedSnapshotSha256||(permission&&(!old.contact_consent||old.metadata?.contact_permission_evidence?.sha256!==permission.sha256)))refuse('COMPANY_IMPORT_EXISTING_DEALER_CHANGED');
   reused++;
  }else{
   await db.query(`INSERT INTO public.dealers(id,slug,display_name,company_name,status,contact_consent,rating,review_count,verified_at,metadata,last_synced_at)
    VALUES($1,$2,$3,$3,$4,$5,NULL,0,$6,$7,now())`,[p.id,'source-company-'+p.metadata.company_id,p.name,p.status,!!permission,permission?null:p.metadata.company_observed_at,p.metadata]);created++;
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
module.exports={importReviewedSourceCompanies,companyUuid};
