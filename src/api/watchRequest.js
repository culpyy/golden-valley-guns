// POST /api/watch-request - a customer asks to be notified when a specific
// out-of-stock distributor item comes back. Writes straight to
// stock_watch_requests via the service_role key (same reasoning as
// contact.js/intake.js: this is customer PII, RLS blocks anon entirely).
// No email fires here - src/lib/catalogSync.js's notifyStockWatchers,
// called after every distributor sync, emails Shawn once the linked item's
// quantity_available is found > 0.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { checkRateLimit } from '../lib/rateLimit.js';

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

export async function handleWatchRequest(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  // Honeypot - same convention as contact.js/intake.js.
  if (payload?._gotcha) {
    return jsonResponse({ success: true });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { allowed, retryAfterSeconds } = await checkRateLimit(env, `watch:${ip}`, { limit: 5, windowSeconds: 600 });
  if (!allowed) {
    return jsonResponse({ error: 'Too many requests sent. Please try again later or call us directly.' }, 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  const { distributorProductId, distributor, productName, name, email, phone } = payload || {};
  if (!distributorProductId || !distributor || !productName || !name || !email) {
    return jsonResponse({ error: 'Please fill in all required fields.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);
  const { error: insertError } = await supabase.from('stock_watch_requests').insert({
    distributor_product_id: distributorProductId,
    distributor,
    product_name: productName,
    customer_name: name,
    customer_email: email,
    customer_phone: phone || null
  });
  // A bad/stale distributorProductId (item removed from distributor_products
  // between page load and submit) trips the foreign key - a normal enough
  // occurrence on a 30k-row catalog synced every few hours, not worth a 500.
  if (insertError) {
    if (insertError.code === '23503') {
      return jsonResponse({ error: 'That item is no longer available to watch - please refresh and try again.' }, 409);
    }
    throw insertError;
  }

  return jsonResponse({ success: true });
}
