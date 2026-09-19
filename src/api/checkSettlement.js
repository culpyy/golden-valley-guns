// POST /api/admin/check-settlement - on-demand version of the daily
// settlement sync (src/lib/settlementSync.js), for checking one order right
// now instead of waiting for the next cron tick (e.g. right after a real
// charge, like verifying test-mode was genuinely off).
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { isAdminToken } from '../lib/adminAuth.js';
import { checkOrderSettlement } from '../lib/settlementSync.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleCheckSettlement(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  const { orderId } = payload || {};
  if (!orderId) return jsonResponse({ error: 'Missing orderId.' }, 400);

  const supabase = getSupabaseAdmin(env);
  const { data: order, error } = await supabase.from('orders').select('id, order_number, authorize_net_transaction_id').eq('id', orderId).single();
  if (error || !order) return jsonResponse({ error: 'Order not found.' }, 404);
  if (!order.authorize_net_transaction_id) return jsonResponse({ error: 'No payment transaction on file for this order.' }, 400);

  const result = await checkOrderSettlement(env, order);
  return jsonResponse({ success: true, ...result });
}
