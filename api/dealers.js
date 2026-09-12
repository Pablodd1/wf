"use strict";
const { getClient } = require('./_lib/supabase');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');

function publicDealer(row, sourceRank = null) {
  const fields=['id','slug','display_name','company_name','country_code','city','rating','review_count',
    'whatsapp_group_count','avatar_url','profile_summary','verified_at','member_since',
    'source_system','listing_linkage_status','stats'];
  const safe=Object.fromEntries(fields.map(field=>[field,row[field] ?? null]));
  safe.source_rank=sourceRank;
  for(const field of ['display_name','company_name','profile_summary']) {
    if(typeof safe[field]==='string') safe[field]=redactPublicSource(safe[field]);
  }
  return safe;
}

function integer(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error('invalid_query');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error('invalid_query');
  return parsed;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({ error:'Method not allowed' });
  let page, pageSize, mode, search;
  try {
    page=integer(req.query?.page,1,100000);
    pageSize=integer(req.query?.pageSize,24,100);
    mode=String(req.query?.mode || 'all');
    if (!['all','rated','top-rated'].includes(mode)) throw new Error('invalid_query');
    search=String(req.query?.q || '').trim();
    if(search.length>100) throw new Error('invalid_query');
  } catch { return res.status(400).json({error:'Invalid dealer query'}); }
  try {
    const {data,error}=await getClient().rpc('get_approved_dealer_directory',{
      p_search:search || null,p_rated:mode!=='all',p_limit:pageSize,p_offset:(page-1)*pageSize,
    });
    if(error) throw error;
    if(!data || !Array.isArray(data.dealers) || !['total','all_total','rated_total'].every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)
      || data.rated_total>data.all_total || data.total!==data[mode==='all'?'all_total':'rated_total']) throw new Error('directory_reconciliation_failed');
    const dealers=data.dealers.map((row,index)=>publicDealer(row,mode==='all'?null:(page-1)*pageSize+index+1));
    return res.status(200).json({success:true,page,pageSize,total:data.total,dealers,
      source:'approved-canonical-database',reconciliation:{all_dealers_total:data.all_total,
      rated_dealers_total:data.rated_total,rated_is_filtered_from_all:true}});
  } catch { return res.status(503).json({success:false,error:'Dealer directory temporarily unavailable'}); }
};
module.exports.publicDealer=publicDealer;
