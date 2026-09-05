const handler = require('./api/reviewed-market-inventory.js');
const req = {
  method: 'GET',
  query: { limit: '5' },
  headers: {}
};
const res = {
  setHeader: () => {},
  status: (code) => {
    return {
      json: (data) => console.log('Response JSON:', code, JSON.stringify(data, null, 2))
    };
  }
};
process.env.SUPABASE_URL = 'https://qnsafosakvonzgfcsphh.supabase.co';
process.env.SUPABASE_ANON_KEY = 'YOUR_KEY_HERE'; // wait, I don't need this if the API reads it from .env, but I don't have .env!
handler(req, res).catch(console.error);
