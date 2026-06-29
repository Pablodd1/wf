import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NjI2MzEsImV4cCI6MjA5NzEzODYzMX0.ymAvXzEXu1Tz8gEec9RBmM3VtYQ9NdzQ0BCPvtb9jKQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true },
});
