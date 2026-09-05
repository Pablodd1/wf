'use strict';

const { createClient } = require('@supabase/supabase-js');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const url = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const email = required('AUTH_USER_EMAIL').toLowerCase();
  const password = required('AUTH_USER_PASSWORD');
  const role = required('AUTH_USER_ROLE').toLowerCase();
  if (!['dealer', 'reviewer', 'admin'].includes(role)) throw new Error('AUTH_USER_ROLE must be dealer, reviewer, or admin');
  if (password.length < 12) throw new Error('AUTH_USER_PASSWORD must contain at least 12 characters');

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  let existing = null;
  for (let page = 1; page <= 100 && !existing; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    existing = data.users.find(user => String(user.email || '').toLowerCase() === email) || null;
    if (data.users.length < 1000) break;
  }

  const attributes = {
    email,
    password,
    email_confirm: true,
    app_metadata: { ...(existing?.app_metadata || {}), role },
  };
  const result = existing
    ? await client.auth.admin.updateUserById(existing.id, attributes)
    : await client.auth.admin.createUser(attributes);
  if (result.error) throw result.error;
  process.stdout.write(`${JSON.stringify({ event: 'auth_user_provisioned', userId: result.data.user.id, email, role, created: !existing })}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'auth_user_provision_error', error: error.message })}\n`);
  process.exitCode = 1;
});
