/**
 * Centralized Supabase configuration.
 * All frontend components should import from here instead of hardcoding keys.
 *
 * Uses VITE_ env vars (safe for browser bundles — anon key only).
 * Service role key is NEVER exposed here (server-side only).
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

export const REQ_HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

export const REQ_HEAD = {
  ...REQ_HEADERS,
  'Prefer': 'count=exact',
};
