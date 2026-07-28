// POST /api/admin/create-special-order - lets Shawn turn a "Request This
// Item" lead (distributor stock, or literally anything he's agreed to
// source) into a real, payable order. Closes the gap where those requests
// used to just be a contact_submissions message with no way to actually
// collect payment through the site - see sql/special_orders.sql for the
// full reasoning.
//
// The price is whatever Shawn types here - never derived from a client
// request or trusted distributor feed at this step, since he's the one who
// actually confirmed real availability/cost with the distributor before
// creating this. That confirmed price is exactly what the customer pays;
// there's no separate step where it could drift.
//
// LEGAL REQUIREMENT, not just a UX choice: a firearm can never ship directly
// to an unlicensed consumer - federal law requires it transfer FFL-to-FFL.
// This handler only creates the order and pay link; the customer picks
// their actual fulfillment method (pickup at Shawn's shop, or transfer to
// their own local FFL dealer) on the payment page itself - see pay.html and
// src/api/pay.js, which validate and store that choice, and
// admin-dashboard.html's Orders tab, where Shawn manually verifies a
// receiving dealer's FFL before anything ships. Nothing here accepts or
// stores a shipping address (customerName/customerEmail/customerPhone
// only, see below) - that's collected on pay.html/src/api/pay.js instead,
// once the customer picks pickup vs. ship for a non-firearm special order.
// isAmmo just tags the single line item's category so pay.js can apply the
// same real ammo shipping restrictions it uses for cart orders - it's
// meaningless (and ignored above) when isFirearm is true.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { insertOrderWithNumber } from '../lib/orderNumber.js';
import { sendEmail } from '../lib/email.js';
import { isAdminToken } from '../lib/adminAuth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleCreateSpecialOrder(request, env) {
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

  const customerName = (payload?.customerName || '').trim();
  const customerEmail = (payload?.customerEmail || '').trim();
  const customerPhone = (payload?.customerPhone || '').trim();
  const itemName = (payload?.itemName || '').trim();
  const price = parseFloat(payload?.price);
  const isFirearm = !!payload?.isFirearm;
  const isAmmo = !isFirearm && !!payload?.isAmmo;

  if (!customerName || !customerEmail || !itemName) {
    return jsonResponse({ error: 'Customer name, email, and item description are required.' }, 400);
  }
  if (!EMAIL_RE.test(customerEmail)) {
    return jsonResponse({ error: 'That doesn\'t look like a valid email address.' }, 400);
  }
  if (!Number.isFinite(price) || price <= 0) {
    return jsonResponse({ error: 'Price must be a positive number.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);
  // crypto.randomUUID() (128 bits) is the entire access control for
  // pay.html/api/pay - unguessable is the whole point, there's no login.
  const payToken = crypto.randomUUID();
  const total = Math.round(price * 100) / 100;

  const orderRow = await insertOrderWithNumber(supabase, {
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone || null,
    items: [{ id: null, name: itemName, price: total, qty: 1, category: isAmmo ? 'ammo' : null }],
    subtotal: total,
    total,
    status: 'pending',
    source: 'special_order',
    pay_token: payToken,
    is_firearm: isFirearm
  });
  const orderNumber = orderRow.order_number;

  const payUrl = `https://${env.SITE_HOSTNAME}/pay.html?token=${payToken}`;

  // Best-effort - Shawn gets the link back in the dashboard response either
  // way (see admin-dashboard.html), so an email failure here doesn't strand
  // him without a way to reach the customer.
  try {
    await sendEmail(env, {
      to: customerEmail,
      subject: `Payment link for your order - Golden Valley Guns`,
      text: [
        `Hi ${customerName.split(' ')[0]},`,
        ``,
        `Here's the payment link for the item you requested:`,
        ``,
        itemName,
        `$${total.toFixed(2)}`,
        ``,
        isFirearm
          ? `This is a firearm, so it can't ship directly to you - when you pay, you'll choose to either pick it up in person here or have it transferred to your own local FFL dealer. Either way, a NICS background check and ATF Form 4473 are required before it's yours.`
          : '',
        ``,
        payUrl,
        ``,
        `Questions? Call or text us at (928) 727-0893.`,
        ``,
        `- Golden Valley Guns`
      ].filter(Boolean).join('\n')
    });
  } catch (err) {
    console.error(`Special order ${orderNumber} created, but the payment-link email failed to send:`, err);
  }

  return jsonResponse({ success: true, orderNumber, payUrl });
}
