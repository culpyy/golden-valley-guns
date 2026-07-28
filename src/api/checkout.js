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
// `products` ARE purchasable - paying online reserves it, then transfers
// either by in-person pickup or FFL-to-FFL dealer transfer (see below),
// same two options as a special order (src/api/specialOrder.js + pay.js).
//
// LEGAL REQUIREMENT, not just a UX choice: a firearm can never ship directly
// to an unlicensed consumer - federal law requires it transfer FFL-to-FFL.
// This function supports exactly two fulfillment paths for a firearm order,
// and no others:
//   'pickup'       - customer completes NICS/Form 4473 in person at Shawn's
//                     shop. Nothing ships. (The only option before this.)
//   'ffl_transfer' - customer's chosen dealer receives it and does the
//                     NICS/Form 4473 transfer themselves. Requires the
//                     receiving dealer's business name, FFL license number,
//                     phone, and address (validated below) - Shawn manually
//                     verifies that license is current (phone/fax/email
//                     copy) BEFORE shipping, tracked via orders.ffl_verified
//                     (see admin-dashboard.html's Orders tab). There is no
//                     automated/real-time FFL verification here; Shawn's
//                     manual check is the actual gate.
// A firearm-free order CAN ship directly to the customer's own address (see
// the shipping/shippingAddress handling below) - that's legal, unlike a
// firearm. shippingMethod is forced back to 'pickup' whenever hasFirearm is
// true, so a cart with any firearm in it never reaches a customer address,
// even if non-firearm items are riding along in the same cart.

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

// Unlike firearms, non-firearm items (ammo, parts, accessories) can ship
// direct to a consumer - no FFL required. Ammo specifically has real
// state/local restrictions though, sourced from our distributors' own
// dropship guidelines (see sql/direct_shipping.sql), not guessed. All of
// these are a hard block rather than a conditional (e.g. "requires adult
// signature") - simpler and safer than relying on Shawn to remember to flag
// something with his carrier every time.
const AMMO_HARD_BLOCK_STATES = new Set(['CA', 'NY', 'RI', 'DC', 'IL', 'MA', 'NJ', 'CT']);
// Maryland isn't blocked statewide - just Annapolis specifically.
const AMMO_HARD_BLOCK_CITIES = { MD: 'annapolis' };

// Firearms Shawn actually has in stock ARE purchasable through the cart -
// paying online reserves it, then it either transfers by in-person pickup
// or ships FFL-to-FFL to the customer's chosen dealer (see is_firearm/
// fulfillment handling below and the firearm-notice block in checkout.html).
// This is distinct from distributor_products_public
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

  const { items, customer, opaqueData, fulfillment, shipping } = payload || {};
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'Cart is empty.' }, 400);
  }
  if (!customer?.firstName || !customer?.lastName || !customer?.email) {
    return jsonResponse({ error: 'Missing customer name/email.' }, 400);
  }
  if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
    return jsonResponse({ error: 'Missing payment token - card was not tokenized.' }, 400);
  }
  // Validated in full once hasFirearm is known below (a non-firearm cart
  // can't request ffl_transfer at all - see the hasFirearm block).
  const requestedFulfillment = fulfillment?.method === 'ffl_transfer' ? 'ffl_transfer' : 'pickup';

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

  // A non-firearm order requesting ffl_transfer makes no sense (there's
  // nothing to transfer) - forced back to 'pickup' rather than trusted, same
  // "never trust the client" posture as everything else in this handler.
  // For an actual firearm order requesting ffl_transfer, the receiving
  // dealer's info is required server-side too - the client marks these
  // fields required, but that's UX only, not enforcement.
  const fulfillmentMethod = hasFirearm ? requestedFulfillment : 'pickup';
  let transferFfl = null;
  if (fulfillmentMethod === 'ffl_transfer') {
    const ffl = fulfillment?.ffl || {};
    const businessName = (ffl.businessName || '').trim();
    const licenseNumber = (ffl.licenseNumber || '').trim();
    const phone = (ffl.phone || '').trim();
    const address = (ffl.address || '').trim();
    if (!businessName || !licenseNumber || !phone || !address) {
      return jsonResponse({ error: 'Receiving FFL business name, license number, phone, and address are all required for a dealer transfer.' }, 400);
    }
    transferFfl = { businessName, licenseNumber, phone, address };
  }

  // Shipping choice only applies to a firearm-free order - a cart with any
  // firearm in it stays entirely on the pickup/ffl_transfer path above, even
  // if non-firearm items are riding along in the same cart. Forced back to
  // 'pickup' rather than trusted, same posture as fulfillmentMethod above.
  const requestedShipping = shipping?.method === 'ship' ? 'ship' : 'pickup';
  const shippingMethod = hasFirearm ? 'pickup' : requestedShipping;
  let shippingAddress = null;
  if (shippingMethod === 'ship') {
    const addr = shipping?.address || {};
    const line1 = (addr.line1 || '').trim();
    const line2 = (addr.line2 || '').trim();
    const city = (addr.city || '').trim();
    const state = (addr.state || '').trim().toUpperCase();
    const zip = (addr.zip || '').trim();
    if (!line1 || !city || !state || !zip) {
      return jsonResponse({ error: 'A complete shipping address (address, city, state, and ZIP) is required to ship your order.' }, 400);
    }
    const cartHasAmmo = priced.some(i => i.category === 'ammo');
    if (cartHasAmmo) {
      const blockedCity = AMMO_HARD_BLOCK_CITIES[state];
      if (AMMO_HARD_BLOCK_STATES.has(state) || (blockedCity && city.toLowerCase() === blockedCity)) {
        return jsonResponse({ error: `We can't ship ammunition to that location. Choose in-store pickup instead, or remove the ammo from your cart.` }, 400);
      }
    }
    shippingAddress = { line1, line2, city, state, zip };
  }

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
    is_firearm: hasFirearm,
    fulfillment_method: fulfillmentMethod,
    transfer_ffl_business_name: transferFfl?.businessName || null,
    transfer_ffl_license_number: transferFfl?.licenseNumber || null,
    transfer_ffl_phone: transferFfl?.phone || null,
    transfer_ffl_address: transferFfl?.address || null,
    ship_to_customer: shippingMethod === 'ship',
    shipping_line1: shippingAddress?.line1 || null,
    shipping_line2: shippingAddress?.line2 || null,
    shipping_city: shippingAddress?.city || null,
    shipping_state: shippingAddress?.state || null,
    shipping_zip: shippingAddress?.zip || null
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
    await sendOrderEmails(env, { orderNumber, customer, items: priced, total, hasFirearm, fulfillmentMethod, transferFfl, shippingMethod, shippingAddress });
  } catch (err) {
    console.error(`Order ${orderNumber} placed successfully, but confirmation emails failed:`, err);
  }

  return jsonResponse({ success: true, orderNumber, transactionId: result.transactionId, isFirearm: hasFirearm });
}

async function sendOrderEmails(env, { orderNumber, customer, items, total, hasFirearm, fulfillmentMethod, transferFfl, shippingMethod, shippingAddress }) {
  const itemLines = items.map(i => `  ${i.qty} x ${i.name} - $${i.price.toFixed(2)} each`).join('\n');
  let firearmNote = '';
  if (hasFirearm && fulfillmentMethod === 'ffl_transfer') {
    firearmNote = `\n\nThis order includes a firearm, transferring to your dealer (${transferFfl.businessName}) rather than shipping to you directly - required by federal law. We'll verify their FFL is current before anything ships; they'll handle your NICS background check and ATF Form 4473 in person. If your background check is denied, you'll receive a full refund.`;
  } else if (hasFirearm) {
    firearmNote = `\n\nThis order includes a firearm - it's reserved for you but nothing ships. You'll complete a NICS background check and ATF Form 4473 in person when you pick it up. If your background check is denied, you'll receive a full refund.`;
  } else if (shippingMethod === 'ship') {
    firearmNote = `\n\nWe'll ship this order to:\n${shippingAddress.line1}${shippingAddress.line2 ? '\n' + shippingAddress.line2 : ''}\n${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}\n\nWe'll email you when it's on its way.`;
  } else {
    firearmNote = `\n\nThis order is ready for pickup at our shop whenever works for you.`;
  }

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

  let firearmAdminNote = '';
  if (hasFirearm && fulfillmentMethod === 'ffl_transfer') {
    firearmAdminNote = [
      ``,
      `FFL TRANSFER REQUESTED - DO NOT SHIP UNTIL VERIFIED.`,
      `Receiving dealer: ${transferFfl.businessName}`,
      `License #: ${transferFfl.licenseNumber}`,
      `Phone: ${transferFfl.phone}`,
      `Address: ${transferFfl.address}`,
      `Verify this FFL is current (phone/fax/email copy of license) before shipping, then mark it verified in the Orders tab.`
    ].join('\n');
  } else if (hasFirearm) {
    firearmAdminNote = `\nFirearm - pickup in person, NICS/4473 required before transfer. Nothing ships.`;
  } else if (shippingMethod === 'ship') {
    firearmAdminNote = [
      ``,
      `SHIP TO CUSTOMER:`,
      `${shippingAddress.line1}${shippingAddress.line2 ? '\n' + shippingAddress.line2 : ''}`,
      `${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}`
    ].join('\n');
  }

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
      firearmAdminNote,
      ``,
      `See the Orders tab in the admin dashboard for full details.`
    ].filter(Boolean).join('\n'),
    replyTo: customer.email
  });
}
