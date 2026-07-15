import { createClient } from '@supabase/supabase-js';

// Service-role client for sync jobs only. Never ship this key to the browser —
// it bypasses the RLS lockdown on distributor_products.
export function getSupabaseAdmin(env) {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (wrangler.jsonc vars / wrangler secret).');
  }
  return createClient(url, serviceKey);
}
