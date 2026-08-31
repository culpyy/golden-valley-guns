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
import { emailShell, emailGreeting, emailParagraph, emailInfoBox, emailButton, emailFooterNote } from '../lib/emailTemplate.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Backstop for a build-linked special order forces isFirearm server-side
// (see orderIsFirearm below), but a freeform special order - the actual
// "Request This Item" path this endpoint exists for - has no equivalent:
// isFirearm there is entirely Shawn's own checkbox, and a forgotten
// checkbox on a real firearm is the one way this system could legally ship
// a gun straight to an unlicensed customer. This is a deliberately
// over-inclusive keyword net, not a firearm classifier - false positives
// just cost Shawn one extra confirmation click, so there's no reason to be
// narrow about what's in it.
const FIREARM_KEYWORDS = [
  'rifle', 'pistol', 'revolver', 'shotgun', 'firearm', 'handgun', 'carbine', 'sbr', 'sbs',
  'ar-15', 'ar15', 'ak-47', 'ak47', 'kalashnikov', 'glock', 'sig sauer', 'smith & wesson',
  's&w', 'colt', 'beretta', 'mossberg', 'savage', 'ruger', 'remington', 'springfield',
  'cz-', 'fn ', 'hk ', 'heckler', 'walther', 'taurus', 'kimber', 'uzi', 'mac-10', 'mac10',
  'mp5', 'm4 ', 'm16', '1911', 'ppsh', 'dp-27', 'dp27', 'sten', 'pm-12', 'pm12', 'fal',
  ' g3', 'wasr', 'receiver', 'class 3', 'nfa', 'suppressor', 'silencer', 'sbg', 'gun'
];
function looksLikeFirearm(name) {
  const lower = ` ${name.toLowerCase()} `;
  return FIREARM_KEYWORDS.some(kw => lower.includes(kw));
}

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
  // Optional - set only when this special order was generated from the
  // Builds tab's "Get Paid" button (admin-dashboard.html), so the build can
  // be linked back to the resulting order/pay link. Every row in `builds`
  // represents an actual firearm build, so isFirearm is force-true from the
  // client for that path - re-asserted here too rather than trusted blindly,
  // same "never trust the client" posture as checkout.js/pay.js.
  const buildId = payload?.buildId || null;

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

  let build = null;
  if (buildId) {
    const { data, error: buildError } = await supabase.from('builds').select('id, payment_status').eq('id', buildId).single();
    if (buildError || !data) {
      return jsonResponse({ error: 'Build not found.' }, 404);
    }
    build = data;
  }
  // Every build IS a firearm - force this regardless of what the client sent,
  // same "never trust the client" posture as checkout.js/pay.js.
  const orderIsFirearm = buildId ? true : isFirearm;

  // A build-linked order is already forced firearm above, so this only ever
  // fires on a freeform special order Shawn typed isFirearm=false for. If
  // the description reads like an actual gun, refuse to create a directly-
  // shippable order until he explicitly confirms it isn't one - closes off
  // the "forgot to check the box" failure mode instead of just hoping he
  // didn't. confirmNotFirearm is a deliberate second action, not something
  // that can be pre-set once and forgotten (the admin form resets it with
  // everything else after every submission).
  if (!orderIsFirearm && looksLikeFirearm(itemName) && !payload?.confirmNotFirearm) {
    return jsonResponse({
      error: `"${itemName}" looks like it might be a firearm. If it is, check "This is a firearm" - it can never ship directly to a customer, only pickup or FFL transfer. If it's genuinely not a firearm, confirm and create it again.`,
      needsFirearmConfirmation: true
    }, 400);
  }

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
    is_firearm: orderIsFirearm
  });
  const orderNumber = orderRow.order_number;

  const payUrl = `https://${env.SITE_HOSTNAME}/pay.html?token=${payToken}`;

  if (build) {
    const { error: buildUpdateError } = await supabase.from('builds').update({
      order_id: orderRow.id,
      payment_status: 'invoiced',
      pay_url: payUrl
    }).eq('id', build.id);
    if (buildUpdateError) {
      // The order itself already exists and is fully payable at this point -
      // don't fail the request over a bookkeeping-only mismatch, just log it
      // for manual reconciliation (same posture as the order-status-update
      // failure paths in checkout.js/pay.js/refundOrder.js).
      console.error(`Order ${orderNumber} created for build ${build.id}, but linking the build back failed:`, buildUpdateError);
    }
  }

  // Best-effort - Shawn gets the link back in the dashboard response either
  // way (see admin-dashboard.html), so an email failure here doesn't strand
  // him without a way to reach the customer.
  try {
    const firstName = customerName.split(' ')[0];
    await sendEmail(env, {
      to: customerEmail,
      subject: `Payment link for your order - Golden Valley Guns`,
      source: 'special_order_payment_link',
      relatedTable: 'orders',
      relatedId: orderRow.id,
      text: [
        `Hi ${firstName},`,
        ``,
        `Here's the payment link for your order:`,
        ``,
        `Order #${orderNumber}`,
        itemName,
        `$${total.toFixed(2)}`,
        ``,
        orderIsFirearm
          ? `This is a firearm, so it can't ship directly to you - when you pay, you'll choose to either pick it up in person here or have it transferred to your own local FFL dealer. Either way, a NICS background check and ATF Form 4473 are required before it's yours.`
          : '',
        ``,
        payUrl,
        ``,
        `Questions? Call or text us at (928) 727-0893.`,
        ``,
        `- Golden Valley Guns`
      ].filter(Boolean).join('\n'),
      html: emailShell([
        emailGreeting(firstName),
        emailParagraph(`Here's the payment link for your order <strong>#${orderNumber}</strong>:`),
        emailInfoBox([[itemName, `$${total.toFixed(2)}`]]),
        emailButton(payUrl, 'Pay Now'),
        orderIsFirearm
          ? emailParagraph(`This is a firearm, so it can't ship directly to you - when you pay, you'll choose to either pick it up in person here or have it transferred to your own local FFL dealer. Either way, a NICS background check and ATF Form 4473 are required before it's yours.`)
          : '',
        emailFooterNote()
      ].join(''))
    });
  } catch (err) {
    console.error(`Special order ${orderNumber} created, but the payment-link email failed to send:`, err);
  }

  return jsonResponse({ success: true, orderNumber, payUrl });
}
