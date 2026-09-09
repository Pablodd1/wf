'use strict';

// General source-role boundaries. Recognizing a possible next reference is
// deliberately separate from establishing that reference's manufacturer.
const POLICY_VERSION = 'source-offer-boundaries-and-price-roles-v5';
const number = '\\d[\\d.,]*(?:[ \\t]*[KM])?';
function urlSpans(text) {
  // A source link remains evidence text; path/product numbers inside that link
  // are not an independent claim about a watch offered in this message.
  return [...String(text).matchAll(/(?<![\p{L}\p{N}])(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+/giu)]
    .map(m=>({start:m.index,end:m.index+m[0].length,quote:m[0],reason:'EXPLICIT_URL_NOT_REFERENCE'}));
}
function additionalReferenceBoundary(key) {
  return /^\d{4,5}[A-Z]\/[A-Z0-9]{4,6}-[A-Z0-9]{3,6}$/i.test(key)
    || /^M?\d{5}[A-Z0-9]*-\d{4}$/i.test(key)
    || /^[345678]\d{3}(?:\/\d{1,4}[A-Z]+|[A-Z]+\/\d{1,4}[A-Z]*)(?:-\d{3})?$/i.test(key);
}
function taggedIdentifierSpans(text) {
  const found=[];
  for(const line of String(text).matchAll(/[^\r\n\u2028\u2029]+/g)) {
    const m=/^[ \t*_]*🔖[ \t]*([A-Z0-9][A-Z0-9-]{2,24})[ \t*_]*$/i.exec(line[0]);
    if(m&&/\d/.test(m[1])) {const start=line.index+m[0].indexOf(m[1]);found.push({start,end:start+m[1].length,quote:m[1],reason:'TAGGED_IDENTIFIER_ROLE_NOT_ESTABLISHED'});}
  }
  return found;
}
function puritySpans(text) {
  const found=[];
  // An unpriced material descriptor is not a multiplier. An actual '$18K'
  // quote remains money even when a gold description follows it.
  const pattern=/(?<![\p{L}\p{N}.$€£])(?:9|10|14|18|21|22|24)[ \t]*K(?:T)?(?=[ \t]*(?:(?:yellow|white|rose|pink|red)[ \t]+)?(?:gold|YG|WG|RG|PG)\b)/giu;
  for(const m of String(text).matchAll(pattern)) found.push({start:m.index,end:m.index+m[0].length,quote:m[0],reason:'EXPLICIT_GOLD_PURITY_NOT_PRICE'});
  return found;
}
function supplementalPriceClaims(text) {
  const found=[];
  // A currency code immediately qualifying the same dollar amount is explicit
  // evidence. Multiple contradictory codes remain separate claims for review.
  const qualified=new RegExp('(?<![A-Z0-9])((?:HKD|USD|SGD|AUD|CAD|NZD))[ \\t]*\\$[ \\t]*('+number+')(?![A-Z0-9])','gi');
  for(const m of String(text).matchAll(qualified)) found.push({start:m.index,end:m.index+m[0].length,quote:m[0],raw_number:/\d[\d.,]*/.exec(m[2])[0],had_multiplier:/[KM]$/i.test(m[2]),currency:m[1].toUpperCase(),price_role:'UNLABELLED',reason:'EXPLICIT_CURRENCY_QUALIFIED_DOLLAR_AMOUNT'});
  for(const line of String(text).matchAll(/[^\r\n\u2028\u2029]+/g)) {
    const m=new RegExp('^[ \\t*_]*💰[ \\t]*('+number+')[ \\t]*(?:\\+[ \\t]*(?:🏷️?|label|shipping))?[ \\t*_]*$','i').exec(line[0]);
    if(m){const start=line.index+m[0].indexOf(m[1]);found.push({start,end:start+m[1].length,quote:m[1],raw_number:/\d[\d.,]*/.exec(m[1])[0],had_multiplier:/[KM]$/i.test(m[1]),currency:null,price_role:'EXPLICIT_ASK',explicit_sale_role:true,reason:'EXPLICIT_MONEY_LABEL_AMOUNT_CURRENCY_UNESTABLISHED'});}
  }
  return found;
}
const isDecoratedCondition = text => /^[^\p{L}\p{N}]*(?:(?:condition)[ \t]*[:=-]?[ \t]*)?(brand[ \t]+new|unworn|used|pre[- ]owned|new)[^\p{L}\p{N}]*$/iu.exec(text);
function affirmativeAvailabilityHeader(text) {
  const value=String(text);
  if(value.length>120||/\?|\b(?:WTB|NTQ|wanted|want|looking|seeking|need|required|request|not|no|out\s+of|sold\s+out)\b/i.test(value))return false;
  return /\b(?:ready[ \t]+stock|in[ \t]+stock|stock[ \t]+list|ready[ \t]+in[ \t]+hong[ \t]*kong)\b/i.test(value);
}
function sameReferenceTitleRestatement(activeText,nextLine,previousRefs,nextRefs) {
  if(!/^Title\s*:/i.test(nextLine)||previousRefs.length!==1||nextRefs.length!==1||previousRefs[0].reference!==nextRefs[0].reference)return false;
  const ref=previousRefs[0];
  // Only a bare reference heading followed by its explicitly labelled title.
  // Same-reference priced observations and ordinary repeated units stay apart.
  return activeText.slice(0,ref.start).replace(/[^\p{L}\p{N}]/gu,'')==='' && activeText.slice(ref.end).replace(/[^\p{L}\p{N}]/gu,'')==='';
}
module.exports={POLICY_VERSION,urlSpans,additionalReferenceBoundary,taggedIdentifierSpans,puritySpans,supplementalPriceClaims,isDecoratedCondition,affirmativeAvailabilityHeader,sameReferenceTitleRestatement};
