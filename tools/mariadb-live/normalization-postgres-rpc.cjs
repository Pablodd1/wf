'use strict';
// Fixed SQL transport for the same reviewed, lease-bound normalization RPCs.
// No row mutation is performed outside the existing database functions.
function createNormalizationPostgresRpc(db) {
 return async (name,args) => {
  let query,values;
  if(name==='get_normalization_job_v2'){query='SELECT public.get_normalization_job_v2($1::text) result';values=[args.p_job_name];}
  else if(name==='claim_normalization_batch_v2'){query='SELECT public.claim_normalization_batch_v2($1::text,$2::uuid,$3::integer) result';values=[args.p_job_name,args.p_lease_id,args.p_limit];}
  else if(name==='complete_normalization_batch_v2'){query='SELECT public.complete_normalization_batch_v2($1::text,$2::uuid,$3::jsonb) result';values=[args.p_job_name,args.p_lease_id,JSON.stringify(args.p_results)];}
  else throw new Error('NORMALIZATION_SQL_FUNCTION_NOT_ALLOWED');
  try{return (await db.query(query,values)).rows[0].result;}
  catch(error){const reason=/^[a-z][a-z_]{1,100}$/.test(error.message||'')?error.message:null;
   const postgresCode=/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:null;
   throw Object.assign(new Error('NORMALIZATION_SQL_REJECTED'+(reason?'_'+reason.toUpperCase():'')),{reason,postgresCode});}
 };
}
module.exports={createNormalizationPostgresRpc};
