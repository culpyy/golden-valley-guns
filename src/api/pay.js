// GET/POST /api/pay - the customer-facing half of special orders (see
// sql/special_orders.sql and src/api/specialOrder.js for how these get
// created). The pay_token in the URL is the entire access control - there's
// no login for a one-time customer payment link, same spirit as builds'
// tracking codes.
//
// The charge amount is never accepted from the client anywhere in this
// flow - GET returns it for display, POST re-reads it server-side from the
// order row by token. A tampered request body has no lever to pull on price.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { chargeCreditCard } from '../lib/authorizeNet.js';
import { sendEmail } from '../lib/email.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Deliberately generic for any status that isn't payable, rather than
// distinguishing "already paid" from "cancelled" from "not found" in the
// response - the token is a bearer credential, no reason to hand back more
// information than the page needs to render a sensible message.
function orderPublicView(order) {
  return {
    orderNumber: order.order_number,
    itemName: order.items?.[0]?.name || 'Order',
    total: order.total,
    isFirearm: order.is_firearm,
    status: order.status
  };
}

export async function handleGetPayOrder(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return jsonResponse({ error: 'Missing token.' }, 400);

  const supabase = getSupabaseAdmin(env);
  const { data: order } = await supabase.from('orders').select('*').eq('pay_token', token).single();
  if (!order) return jsonResponse({ error: 'Payment link not found.' }, 404);

  return jsonResponse(orderPublicView(order));
}

export async function handlePayOrder(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  const { token, customer, opaqueData } = payload || {};
  if (!token) return jsonResponse({ error: 'Missing token.' }, 400);
  if (!customer?.firstName || !customer?.lastName || !customer?.email) {
    return jsonResponse({ error: 'Missing customer name/email.' }, 400);
  }
  if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
    return jsonResponse({ error: 'Missing payment token - card was not tokenized.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);

  // Atomic claim - only one concurrent request can flip a given order from
  // 'pending' to 'processing'. Without this, two near-simultaneous submits
  // on the same link (a customer double-clicking Pay, or two tabs) could
  // both pass a plain read-check and both charge the card. This conditional
  // update is the actual lock: a losing request gets 0 rows back and is
  // rejected before ever calling Authorize.net, so at most one charge
  // attempt ever happens per order.
  const { data: claimed, error: claimError } = await supabase
    .from('orders')
    .update({ status: 'processing' })
    .eq('pay_token', token)
    .eq('status', 'pending')
    .select()
    .single();

  if (claimError || !claimed) {
    // Distinguish "never existed" from "exists but not payable right now"
    // only for the customer-facing message - both are equally unpayable.
    const { data: existing } = await supabase.from('orders').select('status').eq('pay_token', token).single();
    if (!existing) return jsonResponse({ error: 'Payment link not found.' }, 404);
    if (existing.status === 'paid') return jsonResponse({ error: 'This order has already been paid.' }, 409);
    return jsonResponse({ error: 'This payment link is no longer active. Contact us if you think that\'s wrong.' }, 409);
  }

  // Confirm/update contact info to whoever's actually paying, in case Shawn
  // only had partial details (e.g. just a phone number) when he created the
  // order, or there's a typo to fix. Card is never re-verified against this
  // (Authorize.net doesn't require name match), it's just record-keeping.
  const customerName = `${customer.firstName} ${customer.lastName}`;
  await supabase.from('orders').update({
    customer_name: customerName,
    customer_email: customer.email,
    customer_phone: customer.phone || claimed.customer_phone
  }).eq('id', claimed.id);

  // Wrapped in try/catch, not just relying on chargeCreditCard's own return
  // value - if it THROWS instead of returning a normal decline (Authorize.net
  // times out, network failure, etc.), the order must still come back out of
  // 'processing'. Without this, an exception here would skip the revert
  // entirely and leave the order permanently stuck - the customer's link
  // would say "no longer active" forever with no way to retry, even though
  // nothing was ever actually charged.
  let result;
  try {
    result = await chargeCreditCard(env, {
      opaqueData,
      amount: claimed.total,
      orderNumber: claimed.order_number,
      items: claimed.items,
      customer
    });
  } catch (err) {
    console.error(`Special order ${claimed.order_number} charge attempt threw:`, err);
    await supabase.from('orders').update({ status: 'pending' }).eq('id', claimed.id);
    return jsonResponse({ error: 'Payment failed. Please try again or contact us.' }, 500);
  }

  // Declined - revert to 'pending' (not left stuck in 'processing') so the
  // customer can retry with a different card using the same link.
  const { error: updateError } = await supabase.from('orders').update({
    status: result.approved ? 'paid' : 'pending',
    authorize_net_transaction_id: result.transactionId,
    authorize_net_response: result.raw
  }).eq('id', claimed.id);
  if (updateError) {
    console.error(`Special order ${claimed.order_number} status update failed after charge (approved=${result.approved}):`, updateError);
  }

  if (!result.approved) {
    return jsonResponse({ error: result.errorText, orderNumber: claimed.order_number }, 402);
  }

  try {
    await sendPaymentConfirmationEmails(env, { order: claimed, customer, customerName });
  } catch (err) {
    console.error(`Special order ${claimed.order_number} paid successfully, but confirmation emails failed:`, err);
  }

  return jsonResponse({ success: true, orderNumber: claimed.order_number, transactionId: result.transactionId });
}

async function sendPaymentConfirmationEmails(env, { order, customer, customerName }) {
  const itemName = order.items?.[0]?.name || 'Order';
  const firearmNote = order.is_firearm
    ? `\n\nThis includes a firearm - you'll complete a NICS background check and ATF Form 4473 in person when you pick it up. Nothing transfers until that's done.`
    : '';

  await sendEmail(env, {
    to: customer.email,
    subject: `Payment confirmed: ${order.order_number} - Golden Valley Guns`,
    text: [
      `Hi ${customer.firstName},`,
      ``,
      `Your payment for order ${order.order_number} is confirmed:`,
      ``,
      itemName,
      `$${order.total.toFixed(2)}`,
      firearmNote,
      ``,
      `We'll be in touch about pickup. Questions? Call or text us at (928) 727-0893.`,
      ``,
      `- Golden Valley Guns`
    ].join('\n')
  });

  await sendEmail(env, {
    subject: `Special order paid: ${order.order_number} (${customerName})`,
    text: [
      `Payment received on a special order.`,
      ``,
      `Order #: ${order.order_number}`,
      `Customer: ${customerName}`,
      `Email: ${customer.email}`,
      `Phone: ${customer.phone || order.customer_phone || '(not provided)'}`,
      ``,
      itemName,
      `$${order.total.toFixed(2)}`,
      order.is_firearm ? `\nFirearm - NICS/4473 required in person before transfer.` : '',
      ``,
      `See the Orders tab in the admin dashboard for full details.`
    ].filter(Boolean).join('\n'),
    replyTo: customer.email
  });
}
