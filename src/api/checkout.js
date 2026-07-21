// POST /api/checkout - the only route this Worker serves besides static
// assets (see src/worker.js). Takes a cart + customer info + an Accept.js
// opaque payment token from checkout.html, re-verifies everything server-side
// against Supabase (never trust client-submitted prices/eligibility), charges
// the card via Authorize.net, and records the result in `orders`.
//
// Only Shawn's own hand-curated items (`products` table) are purchasable
// here - see sql/orders.sql for why. Distributor stock isn't confirmed-real
// inventory and stays on the "Request This Item" contact-form path (rejected
// server-side even if a tampered request includes an id from that table,
// since the lookup below only ever queries `products`). Firearms in
// `products` ARE purchasable - paying online reserves it, but it's a
// pay-online/pick-up-in-person flow, never shipped: NICS/Form 4473 happen in
// person at pickup, same as a special order (src/api/specialOrder.js).

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { chargeCreditCard } from '../lib/authorizeNet.js';
import { sendEmail } from '../lib/email.js';
import { insertOrderWithNumber } from '../lib/orderNumber.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Firearms Shawn actually has in stock ARE purchasable through the cart -
// paying online reserves it, but it never ships. NICS/Form 4473 happen in
// person at pickup (see is_firearm handling below and the firearm-notice
// block in checkout.html). This is distinct from distributor_products_public
// (7,000+ items that aren't confirmed-real inventory) and from firearms
// still sourced through a special order (src/api/specialOrder.js) - both of
// those stay on the "Request"/contact-form path untouched.
function rejectionReasonFor(product) {
  if (product.stock !== 'in_stock' && product.stock !== 'limited') {
    return `${product.name} is no longer available.`;
  }
  return null;
}

// Atomic - see sql/atomic_stock_reservation.sql for why this has to be a
// single SQL UPDATE with the quantity check in the WHERE clause rather than
// a JS-level "read, check, write." Confirmed via a live burst test
// (2026-07-20) that the previous read-then-write approach let 8/8
// concurrent requests pass a 3-unit stock check simultaneously - this is
// the actual fix, not a narrower race window.
async function reserveStock(supabase, id, qty) {
  const { data, error } = await supabase.rpc('reserve_product_stock', { p_id: id, p_qty: qty });
  if (error) throw error;
  return data === true;
}

async function releaseStock(supabase, id, qty) {
  const { error } = await supabase.rpc('release_product_stock', { p_id: id, p_qty: qty });
  if (error) console.error(`Failed to release ${qty} of ${id} back to stock:`, error);
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

  // Aggregate by id first - a cart never produces duplicate lines for the
  // same item (js/cart.js merges qty on repeat add-to-cart), but a crafted
  // request could split one item across multiple lines to make each line's
  // qty individually pass eligibility checks below even though the combined
  // total is what actually gets reserved. Aggregating first means every
  // downstream check sees the true total being requested per product.
  const qtyById = new Map();
  for (const line of items) {
    const qty = parseInt(line.qty, 10);
    if (!line?.id || !Number.isFinite(qty) || qty < 1) {
      return jsonResponse({ error: `Item ${line?.id ?? ''} is no longer available.` }, 400);
    }
    qtyById.set(line.id, (qtyById.get(line.id) || 0) + qty);
  }

  const byId = new Map(products.map(p => [p.id, p]));
  const priced = [];
  for (const [id, qty] of qtyById) {
    const product = byId.get(id);
    if (!product) {
      return jsonResponse({ error: `Item ${id} is no longer available.` }, 400);
    }
    const rejectionReason = rejectionReasonFor(product);
    if (rejectionReason) {
      return jsonResponse({ error: rejectionReason }, 400);
    }
    priced.push({ id: product.id, name: product.name, price: parseFloat(product.price), qty, category: product.category });
  }
  const hasFirearm = priced.some(i => i.category === 'firearms');

  // Reserve every item atomically BEFORE ever attempting a charge - a card
  // is never charged for something that isn't actually held for this
  // customer first. If any item in the cart can't be reserved (someone else
  // just bought the last one), roll back whatever WAS reserved earlier in
  // this same request and bail before touching Authorize.net at all.
  const reserved = [];
  for (const item of priced) {
    const ok = await reserveStock(supabase, item.id, item.qty);
    if (!ok) {
      await Promise.all(reserved.map(r => releaseStock(supabase, r.id, r.qty)));
      return jsonResponse({ error: `${item.name} just sold out - please update your cart and try again.` }, 409);
    }
    reserved.push(item);
  }

  const subtotal = priced.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = Math.round(subtotal * 100) / 100;

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
  const orderRow = await insertOrderWithNumber(supabase, {
    customer_name: `${customer.firstName} ${customer.lastName}`,
    customer_email: customer.email,
    customer_phone: customer.phone || null,
    items: priced,
    subtotal: total,
    total,
    status: 'pending',
    is_firearm: hasFirearm
  });
  const orderNumber = orderRow.order_number;

  const result = await chargeCreditCard(env, {
    opaqueData,
    amount: total,
    orderNumber,
    items: priced,
    customer
  });

  // Declined/errored - the reservation already taken above must be given
  // back, otherwise a failed charge would permanently hold stock hostage
  // for no reason.
  if (!result.approved) {
    await Promise.all(priced.map(item => releaseStock(supabase, item.id, item.qty)));
  }

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

  // Best-effort - the sale itself is already final at this point (charged,
  // recorded, and stock already decremented via the reservation above), so
  // an email hiccup shouldn't turn into a customer-facing checkout failure.
  try {
    await sendOrderEmails(env, { orderNumber, customer, items: priced, total, hasFirearm });
  } catch (err) {
    console.error(`Order ${orderNumber} placed successfully, but confirmation emails failed:`, err);
  }

  return jsonResponse({ success: true, orderNumber, transactionId: result.transactionId, isFirearm: hasFirearm });
}

async function sendOrderEmails(env, { orderNumber, customer, items, total, hasFirearm }) {
  const itemLines = items.map(i => `  ${i.qty} x ${i.name} - $${i.price.toFixed(2)} each`).join('\n');
  const firearmNote = hasFirearm
    ? `\n\nThis order includes a firearm - it's reserved for you but nothing ships. You'll complete a NICS background check and ATF Form 4473 in person when you pick it up. If your background check is denied, you'll receive a full refund.`
    : '';

  await sendEmail(env, {
    to: customer.email,
    subject: `Order confirmed: #${orderNumber} - Golden Valley Guns`,
    text: [
      `Hi ${customer.firstName},`,
      ``,
      `Thanks for your order! Here's your confirmation:`,
      ``,
      `Order #${orderNumber}`,
      ``,
      itemLines,
      ``,
      `Total: $${total.toFixed(2)}`,
      firearmNote,
      ``,
      `We'll be in touch if there's anything else needed to get your order ready. Questions? Call us at (928) 727-0893.`,
      ``,
      `- Golden Valley Guns`
    ].join('\n')
  });

  await sendEmail(env, {
    subject: `New order #${orderNumber} (${customer.firstName} ${customer.lastName})`,
    text: [
      `New paid order on the website.`,
      ``,
      `Order #${orderNumber}`,
      `Customer: ${customer.firstName} ${customer.lastName}`,
      `Email: ${customer.email}`,
      `Phone: ${customer.phone || '(not provided)'}`,
      ``,
      itemLines,
      ``,
      `Total: $${total.toFixed(2)}`,
      hasFirearm ? `\nFirearm - NICS/4473 required in person before transfer. Nothing ships.` : '',
      ``,
      `See the Orders tab in the admin dashboard for full details.`
    ].filter(Boolean).join('\n'),
    replyTo: customer.email
  });
}
