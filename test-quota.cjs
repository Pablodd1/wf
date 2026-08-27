const { getClient } = require("./api/_lib/supabase.js");
async function run() {
  const client = getClient();
  const { data, error } = await client.rpc("consume_ai_api_quota", {
    p_route: "test",
    p_client_hash: "testhash",
    p_limit: 5,
    p_window_seconds: 60
  });
  console.log({data, error});
}
run();
