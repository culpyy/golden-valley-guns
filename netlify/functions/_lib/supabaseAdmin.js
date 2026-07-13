const { createClient } = require('@supabase/supabase-js');

// Service-role client for sync jobs only. Never ship this key to the browser —
// it bypasses the RLS lockdown on distributor_products.
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as Netlify environment variables.');
  }
  return createClient(url, serviceKey);
}

module.exports = { getSupabaseAdmin };
