// Collects "pickup or transfer to my FFL" for a firearm order that was paid
// OFFLINE (USPS money order, check, cash) and so never went through the
// secure pay link, which is where that info is normally captured. See
// sql/offline_fulfillment.sql.
//
//   POST /api/admin/request-fulfillment  - emails the customer a tokenized link
//   GET  /api/fulfillment?token=         - what fulfillment.html shows
//   POST /api/fulfillment                - customer submits the form
//   POST /api/admin/set-fulfillment      - Shawn enters it himself
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { isAdminToken } from '../lib/adminAuth.js';
import { sendEmail } from '../lib/email.js';
import { emailShell, emailGreeting, emailParagraph, emailInfoBox, emailButton, emailFooterNote, escapeHtml } from '../lib/emailTemplate.js';
import { matchFfl } from './fflSearch.js';

const INVALID_LINK = "This link isn't valid.";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// A firearm order marked Paid without an Authorize.net charge, whose
// delivery info hasn't been captured yet.
export function needsFulfillmentInfo(order) {
  return !!order.is_firearm && order.status === 'paid' && !order.authorize_net_transaction_id && !order.fulfillment_submitted_at;
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export async function handleRequestFulfillment(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) return jsonResponse({ error: 'Unauthorized' }, 401);

  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: 'Invalid request.' }, 400); }
  if (!payload?.orderId) return jsonResponse({ error: 'Missing orderId.' }, 400);

  const supabase = getSupabaseAdmin(env);
  const { data: order } = await supabase.from('orders').select('*').eq('id', payload.orderId).single();
  if (!order) return jsonResponse({ error: 'Order not found.' }, 404);
  if (!needsFulfillmentInfo(order)) return jsonResponse({ error: 'This order does not need delivery info.' }, 400);
  if (!order.customer_email) return jsonResponse({ error: 'This order has no customer email on file. Use Enter Manually instead.' }, 400);

  const token = order.fulfillment_token || newToken();
  const { error: saveError } = await supabase.from('orders')
    .update({ fulfillment_token: token, fulfillment_requested_at: new Date().toISOString() })
    .eq('id', order.id);
  if (saveError) return jsonResponse({ error: 'Could not save the request.' }, 500);

  const url = `https://${env.SITE_HOSTNAME}/fulfillment.html?token=${token}`;
  const firstName = (order.customer_name || '').split(' ')[0] || 'there';
  const itemName = order.items?.[0]?.name || 'your order';
  try {
    await sendEmail(env, {
      to: order.customer_email,
      subject: `We received your payment - one quick step for order ${order.order_number}`,
      source: 'fulfillment_request',
      relatedTable: 'orders',
      relatedId: order.id,
      text: [
        `Hi ${firstName},`,
        ``,
        `We received your payment for order ${order.order_number} (${itemName}). Thank you!`,
        ``,
        `Because it includes a firearm, we need to know how you'd like to receive it: pick it up here in person, or have it transferred to your own local FFL dealer. It takes about a minute:`,
        ``,
        url,
        ``,
        `Nothing ships until this is done and any dealer is verified. Questions? Call or text us at (928) 727-0893.`,
        ``,
        `- Golden Valley Guns`
      ].join('\n'),
      html: emailShell([
        emailGreeting(firstName),
        emailParagraph(`We received your payment for order <strong>${escapeHtml(order.order_number)}</strong>. Thank you!`),
        emailInfoBox([[itemName, `$${parseFloat(order.total).toFixed(2)}`]]),
        emailParagraph(`Because it includes a firearm, we need to know how you'd like to receive it: pick it up here in person, or have it transferred to your own local FFL dealer. It takes about a minute.`),
        emailButton(url, 'Choose How You Receive It'),
        emailParagraph(`Nothing ships until this is done and any dealer is verified.`),
        emailFooterNote()
      ].join(''))
    });
  } catch (err) {
    console.error(`request-fulfillment: email failed for order ${order.order_number}:`, err);
    return jsonResponse({ success: false, emailSent: false, error: 'The email could not be sent. Try again, or use Enter Manually.' }, 502);
  }
  return jsonResponse({ success: true, emailSent: true });
}

export async function handleGetFulfillment(request, env) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (token.length < 20) return jsonResponse({ error: INVALID_LINK }, 404);
  const supabase = getSupabaseAdmin(env);
  const { data: order } = await supabase.from('orders')
    .select('order_number, items, total, is_firearm, status, fulfillment_submitted_at')
    .eq('fulfillment_token', token).maybeSingle();
  if (!order || !order.is_firearm || order.status !== 'paid') return jsonResponse({ error: INVALID_LINK }, 404);
  return jsonResponse({
    orderNumber: order.order_number,
    itemName: order.items?.[0]?.name || 'Your order',
    total: parseFloat(order.total),
    alreadySubmitted: !!order.fulfillment_submitted_at
  });
}

// Shared by the customer form and Shawn's manual entry. Validates like
// pay.js does, annotates the receiving FFL against the ATF list, saves it
// (ffl_verified stays false, the same "do not ship" gate as online orders)
// and alerts Shawn.
async function applyFulfillment(env, order, fulfillment, source) {
  const supabase = getSupabaseAdmin(env);
  const method = fulfillment?.method === 'ffl_transfer' ? 'ffl_transfer' : 'pickup';
  const update = {
    fulfillment_method: method,
    fulfillment_submitted_at: new Date().toISOString(),
    fulfillment_source: source
  };
  let ffl = null;
  if (method === 'ffl_transfer') {
    const f = fulfillment.ffl || {};
    const businessName = (f.businessName || '').trim().slice(0, 200);
    const licenseNumber = (f.licenseNumber || '').trim().slice(0, 40);
    const phone = (f.phone || '').trim().slice(0, 40);
    const address = (f.address || '').trim().slice(0, 300);
    const email = (f.email || '').trim().slice(0, 200);
    if (!businessName || !phone || !address) {
      return { error: 'Dealer business name, phone, and address are required.', status: 400 };
    }
    const atf = await matchFfl(env, { licenseNumber, phone });
    ffl = { businessName, licenseNumber: licenseNumber || atf.license || '', phone, address, email, atfMatch: atf.match, atfNote: atf.note };
    Object.assign(update, {
      transfer_ffl_business_name: ffl.businessName,
      transfer_ffl_license_number: ffl.licenseNumber || null,
      transfer_ffl_phone: ffl.phone,
      transfer_ffl_address: ffl.address,
      transfer_ffl_email: ffl.email || null,
      transfer_ffl_atf_match: ffl.atfMatch ?? null,
      transfer_ffl_atf_note: ffl.atfNote || null,
      ffl_verified: false,
      ffl_verified_at: null
    });
  }
  const { error } = await supabase.from('orders').update(update).eq('id', order.id);
  if (error) {
    console.error(`fulfillment: save failed for order ${order.order_number}:`, error);
    return { error: 'Something went wrong saving that. Please try again or contact us.', status: 500 };
  }

  // Alert Shawn only for customer submissions; when he entered it himself
  // he already knows.
  if (source === 'customer') {
    const lines = ffl ? [
      `Receiving dealer: ${ffl.businessName}`,
      `License #: ${ffl.licenseNumber || '(not provided)'}`,
      ffl.atfNote ? `ATF list check: ${ffl.atfNote}` : `ATF list check: no match found, verify manually.`,
      `Phone: ${ffl.phone}`,
      ffl.email ? `Email: ${ffl.email}` : '',
      `Address: ${ffl.address}`,
      `DO NOT SHIP UNTIL VERIFIED. Verify in the Orders tab.`
    ].filter(Boolean) : [`Customer will pick up in person. NICS/4473 required. Nothing ships.`];
    try {
      await sendEmail(env, {
        subject: `Delivery info received: order ${order.order_number} (${order.customer_name})`,
        source: 'fulfillment_admin_notice',
        relatedTable: 'orders',
        relatedId: order.id,
        text: [`${order.customer_name} chose how to receive order ${order.order_number} (paid offline).`, ``, ...lines].join('\n')
      });
    } catch (err) {
      console.error('fulfillment: admin notice email failed (data saved):', err);
    }
  }
  return { ok: true, method, ffl };
}

export async function handlePostFulfillment(request, env) {
  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: 'Invalid request.' }, 400); }
  const token = payload?.token || '';
  if (token.length < 20) return jsonResponse({ error: INVALID_LINK }, 404);
  const supabase = getSupabaseAdmin(env);
  const { data: order } = await supabase.from('orders').select('*').eq('fulfillment_token', token).maybeSingle();
  if (!order || !needsFulfillmentInfo(order)) {
    return jsonResponse({ error: "This link has already been used or isn't valid. Contact us if you need to change something." }, 409);
  }
  const result = await applyFulfillment(env, order, payload.fulfillment, 'customer');
  if (result.error) return jsonResponse({ error: result.error }, result.status);
  return jsonResponse({ success: true, method: result.method });
}

export async function handleSetFulfillment(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) return jsonResponse({ error: 'Unauthorized' }, 401);
  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: 'Invalid request.' }, 400); }
  const supabase = getSupabaseAdmin(env);
  const { data: order } = await supabase.from('orders').select('*').eq('id', payload?.orderId || '').maybeSingle();
  if (!order) return jsonResponse({ error: 'Order not found.' }, 404);
  if (!needsFulfillmentInfo(order)) return jsonResponse({ error: 'This order does not need delivery info.' }, 400);
  const result = await applyFulfillment(env, order, payload.fulfillment, 'admin');
  if (result.error) return jsonResponse({ error: result.error }, result.status);
  return jsonResponse({ success: true, method: result.method });
}
