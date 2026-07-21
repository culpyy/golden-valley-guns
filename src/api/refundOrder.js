// POST /api/admin/refund-order - full refunds only, deliberately no partial-
// amount option (keeps the status model simple - 'refunded' means the whole
// thing came back, no separate partial-refund bookkeeping to get wrong).
// This is what closes the loop on the most common real scenario for a
// special-order firearm: buyer pays online, then fails the in-person NICS
// check - store policy (see sql/special_orders.sql / pay.html's terms
// notice) is a full refund of the item in that case, same as reputable FFL
// dealers advertise. Without this, Shawn would have no way to actually
// return the money through the system - only mark a status label that
// doesn't move any funds, which is worse than doing nothing since it looks
// resolved when it isn't.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { refundTransaction } from '../lib/authorizeNet.js';
import { isAdminToken } from '../lib/adminAuth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleRefundOrder(request, env) {
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
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) return jsonResponse({ error: 'Order not found.' }, 404);

  if (order.status !== 'paid') {
    return jsonResponse({ error: `Only paid orders can be refunded (this one is "${order.status}").` }, 400);
  }
  if (!order.authorize_net_transaction_id) {
    return jsonResponse({ error: 'No payment transaction on file for this order - nothing to refund through Authorize.net.' }, 400);
  }

  const result = await refundTransaction(env, {
    transactionId: order.authorize_net_transaction_id,
    amount: parseFloat(order.total)
  });

  if (!result.approved) {
    return jsonResponse({ error: result.errorText || 'Refund failed.' }, 402);
  }

  const { error: updateError } = await supabase.from('orders').update({
    status: 'refunded'
  }).eq('id', order.id);
  if (updateError) {
    // The refund itself already succeeded at Authorize.net by this point -
    // don't report failure to Shawn (that would risk him trying again and
    // double-refunding), just log the mismatch for manual reconciliation.
    console.error(`Order ${order.order_number} refunded at Authorize.net but status update failed:`, updateError);
  }

  return jsonResponse({ success: true, orderNumber: order.order_number });
}
