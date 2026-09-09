'use strict';

// A complete source-shaped claim controls block boundaries. It does not prove
// a manufacturer/catalog relationship or authorize publication of that token.
function extendedReferenceClaim(token) {
  return /^(?:[12]\d{4,5}|52\d{3})(?:LN|LV|LB|BLRO|BLNR|CHNR|GRNR|VTNR|SARU|SABR|SACO|SATS|SANR|SAFUBL|RBOW|TBR|RBR|TEM|SRBR)?-\d{3,4}$/i.test(token);
}

// Broad request verbs may address currency or another object. An explicit
// unrelated object is never a wanted-watch heading. RM alone is intentionally
// absent from the currency list because it is also a supported maker token.
const foreignObject = /\b(?:RMB|CNY|USD|USDT|HKD|EUR|EURO|EUROS|GBP|AED|CHF|SGD|JPY|AUD|CAD|MYR|SAR|YUAN|RENMINBI|DOLLARS?|DIRHAMS?|POUNDS?|YEN)\b|人民[币幣]|港[币幣]|美元|美金|欧元|歐元|人民币|人民幣/iu;
function foreignCurrencyExchangeLine(text) {
  const body = String(text).replace(/^[^\p{L}\p{N}]+/u, '');
  return /^(?:(?:looking\s+for|looking\s+to\s+buy|want\s+to\s+buy|seeking|wanted|LF|need(?:ed)?)\b|求(?:购|購|收)?)/iu.test(body)
    && foreignObject.test(body)
    && !/\b(?:watch(?:es)?|wristwatch(?:es)?|timepieces?)\b|手表|手錶|腕表|腕錶/iu.test(body);
}

function fullStickerDefinitionSpans(text) {
  const spans=[];
  const forward=/(?<![\p{L}\p{N}])FS(?:\s+(?:no\s*bcode|no\s*barcode|nobcode))?\s*(?:=|:|means)\s*full\s+stickers?\b/giu;
  const reverse=/\bfull\s+stickers?\s*(?:=|:|means)\s*FS(?![\p{L}\p{N}])/giu;
  for(const pattern of [forward,reverse])for(const m of String(text).matchAll(pattern))spans.push({start:m.index,end:m.index+m[0].length,quote:m[0]});
  if(!spans.length&&/^[\s*_()=:/.-]*(?:FS[\s*_()=:/.-]*full\s+stickers?|full\s+stickers?[\s*_()=:/.-]*FS)[\s*_()=:/.-]*$/iu.test(text))spans.push({start:0,end:text.length,quote:text});
  return spans;
}
const nonIntentFullStickersLine=text=>fullStickerDefinitionSpans(text).length>0;
// Caller removes exact maker tokens. Only explicit unrelated request objects
// are classified; model families and ordinary offer/request modifiers retain
// the previous parser's header behavior. An accessory scope is a hold, because
// the references below it can identify accessories rather than whole watches.
function nonwatchIntentObject(textWithoutMakers) {
  const text=String(textWithoutMakers).replace(/^[^\p{L}\p{N}]+/u,'');
  const cue=/^(?:(?:WTB|NTQ|WTS|FS|LF|want\s+to\s+buy|looking\s+(?:for|to\s+buy)|seeking|wanted|want\s+to\s+sell|for\s+sale|selling)\b|求购|求購|求收|收购|寻找|尋找|找表|找貨)[\s:/*_-]*/iu.exec(text);
  if(!cue)return null;
  const object=text.slice(cue[0].length);
  if(/^(?:(?:a|an|the|any|some|new|used|original|genuine|OEM|English|sport|sports|watch|warranty|guarantee|presentation|inner|outer|black|white|blue|green|brown|red|large|small|medium|old|style|size|[MSL]|\d+[xX])\b[\s/-]*){0,8}(?:booklets?|manuals?|card\s*holders?|boxes|box|straps?|bracelets?|links?|dials?)\b/iu.test(object))return 'NONWATCH_ACCESSORY_REQUEST';
  if(/^(?:(?:a|an|the|any|some|new|wholesale|shipping|business|reliable|trusted|long[- ]term|cooperative)\b\s*){0,6}(?:buyers?|jobs?|employment|employees?|staff|suppliers?|partners?|agents?|distributors?)\b/iu.test(object))return 'NONWATCH_BUSINESS_OR_SERVICE_REQUEST';
  return null;
}
module.exports = { extendedReferenceClaim, foreignCurrencyExchangeLine, nonwatchIntentObject, nonIntentFullStickersLine, fullStickerDefinitionSpans };
