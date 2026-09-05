'use strict';

const { buildSidecarPage } = require('./build-three-brand-fx-sidecar.cjs');
const { validateFxSnapshot } = require('./build-three-brand-price-correction.cjs');
const { boundedInteger } = require('./lib.cjs');
const { jsonSql, managementQuery, sqlLiteral } = require('./run-two-brand-price-correction.cjs');

async function run(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = {
    accessToken: env.SUPABASE_ACCESS_TOKEN, projectRef: env.SUPABASE_PROJECT_REF,
    expectedProjectRef: env.EXPECTED_PROJECT_REF, normalizationRunKey: env.NORMALIZED_RUN_KEY,
    runKey: env.SIDECAR_RUN_KEY, policyVersion: env.SIDECAR_POLICY_VERSION || 'three-brand-fx-sidecar-v1',
    discoveryPages: boundedInteger(env.SIDECAR_MAX_DISCOVERY_PAGES, 1, 1, 500, 'SIDECAR_MAX_DISCOVERY_PAGES'),
    processingPages: boundedInteger(env.SIDECAR_MAX_PROCESSING_PAGES, 1, 1, 500, 'SIDECAR_MAX_PROCESSING_PAGES'),
    pageSize: boundedInteger(env.SIDECAR_PAGE_SIZE, 100, 1, 500, 'SIDECAR_PAGE_SIZE'),
  };
  if (!config.accessToken || config.projectRef !== config.expectedProjectRef) throw new Error('Pinned project credentials are unavailable');
  if (![config.normalizationRunKey,config.runKey,config.policyVersion].every(v=>/^[A-Za-z0-9._:-]{1,100}$/.test(v||''))) throw new Error('Invalid sidecar key');
  const fx = validateFxSnapshot(options.fxSnapshot);
  let result = await managementQuery(config,`SELECT public.start_three_brand_fx_sidecar(${sqlLiteral(config.runKey)},${sqlLiteral(config.normalizationRunKey)},${sqlLiteral(config.policyVersion)},${jsonSql(fx)}) AS run`,false,fetchImpl);
  let state=result?.[0]?.run;
  for(let i=0;state?.status==='DISCOVERING'&&i<config.discoveryPages;i++){
    result=await managementQuery(config,`SELECT public.discover_three_brand_fx_sidecar_candidates(${sqlLiteral(config.runKey)},${config.pageSize}) AS run`,false,fetchImpl);
    state=result?.[0]?.run;
  }
  for(let i=0;['READY','RUNNING'].includes(state?.status)&&i<config.processingPages;i++){
    const pageResult=await managementQuery(config,`SELECT public.three_brand_fx_sidecar_page(${sqlLiteral(config.runKey)},${config.pageSize}) AS page`,false,fetchImpl);
    const page=pageResult?.[0]?.page; if(!page?.records?.length) throw new Error('Non-complete sidecar returned empty page');
    const built=buildSidecarPage(page.records,fx,{normalizationRunKey:config.normalizationRunKey,correctionRunKey:config.runKey,previousCursor:page.previous_cursor});
    if(built.corrected_rows){
      const applied=await managementQuery(config,`SELECT public.apply_three_brand_fx_sidecar_batch(${sqlLiteral(config.runKey)},${sqlLiteral(built.batch_token)},${jsonSql(built.records)}) AS result`,false,fetchImpl);
      if(Number(applied?.[0]?.result?.written_rows)!==built.corrected_rows||Number(applied?.[0]?.result?.staging_row_delta)!==0||Number(applied?.[0]?.result?.raw_version_row_delta)!==0) throw new Error('Sidecar write did not reconcile');
    }
    result=await managementQuery(config,`SELECT public.advance_three_brand_fx_sidecar(${sqlLiteral(config.runKey)},${built.previous_cursor?`${sqlLiteral(built.previous_cursor)}::uuid`:'NULL::uuid'},${sqlLiteral(built.next_cursor)}::uuid,${built.scanned_rows},${built.corrected_rows},${built.skipped_rows}) AS run`,false,fetchImpl);
    state=result?.[0]?.run;
  }
  return {status:state?.status,census_rows:Number(state?.census_rows||0),scanned_rows:Number(state?.scanned_rows||0),corrected_rows:Number(state?.corrected_rows||0),skipped_rows:Number(state?.skipped_rows||0),activated:false};
}

module.exports={run};
