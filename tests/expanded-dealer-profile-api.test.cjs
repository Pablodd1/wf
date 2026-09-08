'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let data;
const dependency=require.resolve('../api/_lib/supabase');
require.cache[dependency]={id:dependency,filename:dependency,loaded:true,exports:{getClient:()=>({rpc:async name=>{assert.equal(name,'get_approved_dealer_profile_v2');return{data,error:null};}})}};
const handler=require('../api/dealer-profile');
async function invoke(){const old=process.env.VITE_USE_CANARY_V2;process.env.VITE_USE_CANARY_V2='true';const result={};const res={setHeader(){},status(status){result.status=status;return this;},json(body){result.body=body;return this;}};try{await handler({method:'GET',query:{id:'source-poster'}},res);return result;}finally{if(old===undefined)delete process.env.VITE_USE_CANARY_V2;else process.env.VITE_USE_CANARY_V2=old;}}
test('source-poster profile retains reviewed child context, unresolved source budget and unknown counts',async()=>{
 data={dealer:{id:'source-poster',source_system:'WATCHFACTS_SOURCE_POSTERS',display_name:'Source label',rating:null,review_count:null,whatsapp_group_count:null,verified_at:null},
  listing_linkage_status:'EXACT_PUBLISHED_SOURCE_LINKAGE',listing_total:1,publication_revision:725,
  stats:{wts_count:0,wtb_count:1,group_count:null,current_counts_scope:'CURRENT_TRADING_FLOOR_VISIBLE_LISTINGS',verified_contact_info:{phone:'+12025550123',verification_status:'VERIFIED'}},
  listings:[{id:'WF-C-synthetic',parent_listing_id:'WF-parent',child_index:1,raw_message:'WTB Rolex 126334 budget $9000',listing_type:'WTB',original_price_role:'BUYER_BUDGET',currency:null,price_raw:9000,price_usd:null,source_price_text:'$9000',image_url:null}],reviews:[],groups:[]};
 const response=await invoke();assert.equal(response.status,200);const p=response.body;
 assert.equal(p.source_provenance.source_system,'WATCHFACTS_SOURCE_POSTERS');assert.equal(p.dealer.verified_at,null);assert.equal(p.dealer.rating,null);assert.equal(p.dealer.review_count,null);
 assert.equal(p.group_details_status,'UNAVAILABLE');assert.equal(p.stats.group_count,null);assert.equal(p.stats.verified_contact_info,null);
 assert.equal(p.stats.contact_action,'/api/dealer-contact?id=source-poster&channel=whatsapp');assert.doesNotMatch(JSON.stringify(p),/12025550123/);
 assert.equal(p.listings[0].raw_message,data.listings[0].raw_message);assert.equal(p.listings[0].parent_listing_id,'WF-parent');assert.equal(p.listings[0].image_url,null);assert.equal(p.listings[0].display_price,'$9000');assert.equal(p.listings[0].price_usd,null);assert.equal(p.listings[0].original_price_role,'BUYER_BUDGET');
});
test('dated source feedback count and captured entries remain distinct without stars or contact details',async()=>{
 data={dealer:{id:'source-poster',source_system:'WATCHFACTS_SOURCE_POSTERS',rating:null,review_count:22,feedback_captured_at:'2026-08-12T00:00:00Z',captured_review_entries:3,whatsapp_group_count:null},stats:{group_count:null},listings:[],groups:[],reviews:[{reviewer:'Source reviewer',sentiment:'Positive',rating:null}],publication_revision:725,listing_total:0,listing_linkage_status:'EXACT_PUBLISHED_SOURCE_LINKAGE'};
 const {body}=await invoke();assert.equal(body.dealer.review_count,22);assert.equal(body.dealer.captured_review_entries,3);assert.equal(body.dealer.feedback_captured_at,'2026-08-12T00:00:00Z');assert.equal(body.dealer.rating,null);assert.equal(body.reviews[0].rating,null);assert.equal(body.stats.contact_action,null);
});
