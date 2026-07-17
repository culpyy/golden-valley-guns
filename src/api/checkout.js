// POST /api/checkout - the only route this Worker serves besides static
// assets (see src/worker.js). Takes a cart + customer info + an Accept.js
// opaque payment token from checkout.html, re-verifies everything server-side
// against Supabase (never trust client-submitted prices/eligibility), charges
// the card via Authorize.net, and records the result in `orders`.
//
// Only Shawn's own hand-curated parts (`products` table, category != 'firearms')
// are purchasable here - see sql/orders.sql for why. Distributor stock and
// firearms of any kind are rejected even if a tampered request includes them.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { chargeCreditCard } from '../lib/authorizeNet.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function generateOrderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `GVG-ORD-${stamp}-${rand}`;
}

function isPurchasable(product) {
  return product.category !== 'firearms' && (product.stock === 'in_stock' || product.stock === 'limited');
}

export async function handleCheckout(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const { items, customer, opaqueData } = payload || {};
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'Cart is empty.' }, 400);
  }
  if (!customer?.firstName || !customer?.lastName || !customer?.email) {
    return jsonResponse({ error: 'Missing customer name/email.' }, 400);
  }
  if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
    return jsonResponse({ error: 'Missing payment token - card was not tokenized.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);

  const ids = items.map(i => i.id);
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*')
    .in('id', ids);
  if (productsError) throw productsError;

  const byId = new Map(products.map(p => [p.id, p]));
  const priced = [];
  for (const line of items) {
    const product = byId.get(line.id);
    const qty = parseInt(line.qty, 10);
    if (!product || !Number.isFinite(qty) || qty < 1) {
      return jsonResponse({ error: `Item ${line.id} is no longer available.` }, 400);
    }
    if (!isPurchasable(product)) {
      return jsonResponse({ error: `${product.name} can't be purchased online - firearms require an in-person FFL transfer.` }, 400);
    }
    priced.push({ id: product.id, name: product.name, price: parseFloat(product.price), qty });
  }

  const subtotal = priced.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = Math.round(subtotal * 100) / 100;
  const orderNumber = generateOrderNumber();

  // Order row is written BEFORE the card is charged, not after. Charging
  // first and persisting second means a transient failure on the insert
  // (after Authorize.net already approved the charge) leaves no record of
  // it anywhere - the customer sees a generic failure, has no way to know
  // they were actually charged, and the only thing the UI suggests is
  // "try again," which charges them a second time (Authorize.net gets no
  // idempotency key from this integration, so a retry is a brand-new
  // transaction). Writing 'pending' first means the record exists
  // regardless of what happens next; the failure window left afterward
  // (the UPDATE below failing right after this INSERT just succeeded, on
  // the same table/connection) is far smaller than "call an external
  // payment API, then hope our own database write afterward succeeds."
  const { data: orderRow, error: insertError } = await supabase.from('orders').insert({
    order_number: orderNumber,
    customer_name: `${customer.firstName} ${customer.lastName}`,
    customer_email: customer.email,
    customer_phone: customer.phone || null,
    items: priced,
    subtotal: total,
    total,
    status: 'pending'
  }).select().single();
  if (insertError) throw insertError;

  const result = await chargeCreditCard(env, {
    opaqueData,
    amount: total,
    orderNumber,
    items: priced,
    customer
  });

  const { error: updateError } = await supabase.from('orders').update({
    status: result.approved ? 'paid' : 'failed',
    authorize_net_transaction_id: result.transactionId,
    authorize_net_response: result.raw
  }).eq('id', orderRow.id);
  if (updateError) {
    // The charge attempt already happened and its outcome is known - don't
    // let a follow-up DB error mask that from the customer as a generic
    // failure (which would invite a duplicate charge via retry). The
    // 'pending' row still exists with the order number for manual
    // reconciliation even though it doesn't reflect the final status yet.
    console.error(`Order ${orderNumber} status update failed after charge (approved=${result.approved}):`, updateError);
    if (result.approved) {
      return jsonResponse({ success: true, orderNumber, transactionId: result.transactionId });
    }
    return jsonResponse({ error: result.errorText, orderNumber }, 402);
  }

  if (!result.approved) {
    return jsonResponse({ error: result.errorText, orderNumber }, 402);
  }
  return jsonResponse({ success: true, orderNumber, transactionId: result.transactionId });
}
