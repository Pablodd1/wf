'use strict';
const {captureSourceImageEvidence}=require('./source-image-evidence-v2.cjs');
// Retry only transient transport/service failures on the exact original URL.
// Callers persist priorProofs before proof so the failed attempt remains evidence.
async function captureSourceImageWithRetry(raw,options={}){
 const first=await captureSourceImageEvidence(raw,options),d=first.proof?.document;
 if(first.outcome!=='SOURCE_IMAGE_UNAVAILABLE'||!d)return first;
 const statuses=[d.head_status,d.get_status];
 const transient=statuses.some(s=>s===0||s===429||(s>=500&&s<=599));
 const permanent=statuses.some(s=>s>=400&&s<500&&s!==429);
 if(!transient||permanent)return first;
 await (options.wait||(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(statuses.includes(429)?2000:500);
 const second=await captureSourceImageEvidence(raw,options);
 return {...second,priorProofs:[first.proof]};
}
module.exports={captureSourceImageWithRetry};
