'use strict';
const {isIP}=require('node:net');

function trustedClientAddress(req) {
  // Vercel overwrites this header at its edge. Request headers alone never
  // establish proxy trust on direct or local HTTP servers.
  const onVercel=process.env.VERCEL==='1' && ['preview','production'].includes(process.env.VERCEL_ENV);
  const forwarded=req.headers?.['x-forwarded-for'];
  const address=onVercel && typeof forwarded==='string' && isIP(forwarded.trim())
    ? forwarded.trim() : req.socket?.remoteAddress;
  if(typeof address!=='string' || !isIP(address))return 'unknown';
  if(isIP(address)===4)return address;
  const canonical=new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1,-1);
  const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  return mapped ? [parseInt(mapped[1],16)>>8,parseInt(mapped[1],16)&255,parseInt(mapped[2],16)>>8,parseInt(mapped[2],16)&255].join('.') : canonical;
}
module.exports={trustedClientAddress};
