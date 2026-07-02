module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      supabase_url: process.env.SUPABASE_URL ? 'set' : 'missing',
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'missing'
    }
  });
};
