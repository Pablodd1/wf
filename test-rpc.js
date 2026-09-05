import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY="(.*?)"/)?.[1] || env.match(/VITE_SUPABASE_ANON_KEY=([^\n]+)/)?.[1];
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL="(.*?)"/)?.[1] || env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\n]+)/)?.[1] || "https://qnsafosakvonzgfcsphh.supabase.co";
console.log("url:", url, "key:", anonKey?.substring(0,10));
const client = createClient(url, anonKey);
async function run() {
  const { data, error } = await client.rpc("consume_ai_api_quota", { p_route: "test", p_client_hash: "testhash", p_limit: 5, p_window_seconds: 60 });
  console.log("Error:", error);
}
run();
