'use strict';
const {getClient}=require('./_lib/supabase');
const {contactRateLimited,sharedContactBudget,emitContactAudit}=require('./listing-contact');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const identity=req.query?.id,channel=req.query?.channel;
 if(typeof identity!=='string'||!/^[a-z0-9][a-z0-9_-]{0,159}$/i.test(identity)||!['whatsapp',undefined].includes(channel))return res.status(400).json({error:'Valid dealer identity and channel required'});
 if(process.env.VITE_USE_CANARY_V2!=='true')return res.status(404).json({error:'Contact unavailable'});
 if(contactRateLimited(req)){res.setHeader('Retry-After','600');return res.status(429).json({error:'Too many contact requests. Try again later.'});}
 try{
  const client=getClient();if(!await sharedContactBudget(client,req)){res.setHeader('Retry-After','600');return res.status(429).json({error:'Too many contact requests. Try again later.'});}
  const {data:profile,error}=await client.rpc('get_approved_dealer_profile_v2',{p_identity:identity,p_limit:1,p_after_id:null,p_publication_revision:null});
  if(error)throw error;
  if(!profile?.dealer)return res.status(404).json({error:'Verified dealer profile not found'});
  const contact=profile.stats?.verified_contact_info;
  const available=profile.dealer.source_system==='WATCHFACTS_VERIFIED_DEALERS'
   &&profile.listing_linkage_status==='EXACT_PUBLISHED_SOURCE_LINKAGE'&&Number(profile.listing_total)>0
   &&contact?.verification_status==='VERIFIED'&&/^\+?[1-9]\d{7,14}$/.test(contact.phone||'');
  if(!available)return res.status(channel?403:200).json({success:true,contact_available:false});
  if(!channel)return res.status(200).json({success:true,contact_available:true,contact_action:'/api/dealer-contact?id='+encodeURIComponent(profile.dealer.id)+'&channel=whatsapp'});
  const message='Hello, I found your profile on WatchFacts / Curated Luxury and would like to ask about your listings.';
  const url=new URL('https://wa.me/'+contact.phone.replace(/^\+/,''));url.searchParams.set('text',message);
  emitContactAudit('CONTACT_ALLOWED',{surface:'dealer-profile',channel:'whatsapp',result:'CONSENTED_SOURCE_LINKED_PROFILE'});
  res.setHeader('Location',url.href);return res.status(302).end();
 }catch(error){return res.status(error.statusCode===503?503:500).json({error:'Unable to verify dealer contact'});}
};
