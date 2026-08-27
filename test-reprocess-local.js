async function run() {
const mod = await import("./api/reprocess.js");
const reprocess = mod.default || mod;
const req = {
  method: "POST",
  body: {
    mode: "batch",
    limit: 1,
    records: [["wa_0","Rolex","116500LN","White",0,0,"New","USD","rolex daytona 116500ln white new $30k",64,"HUMAN",[],2026]]
  },
  headers: {
    "authorization": "Bearer temp_admin_reprocess_token_4892",
    "x-forwarded-for": "127.0.0.1"
  }
};
const res = {
  status: (code) => { console.log("Status:", code); return res; },
  json: (data) => { console.log("JSON:", data); return res; },
  setHeader: (k, v) => { console.log("Header:", k, v); return res; }
};
await reprocess(req, res);
}
run().catch(console.error);
