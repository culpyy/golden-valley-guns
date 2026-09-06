// POST /api/admin/add-tracking - Shawn buys shipping labels outside this
// site (UPS/USPS/FedEx directly), so there was previously no way to record
// a tracking number or let the customer know one existed. Requested
// directly by Shawn after his wife flagged customers weren't getting
// tracking info. Admin-gated the same way notify-build-status.js is.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { isAdminToken } from '../lib/adminAuth.js';
import { sendEmail } from '../lib/email.js';
import { emailShell, emailGreeting, emailParagraph, emailInfoBox, emailButton, emailFooterNote, escapeHtml } from '../lib/emailTemplate.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Builds a real tracking link so the customer doesn't have to retype the
// number into the carrier's own site - "Other" carriers just get the plain
// number shown, no guessed URL.
function trackingUrl(carrier, number) {
  const n = encodeURIComponent(number);
  switch (carrier) {
    case 'USPS': return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'UPS': return `https://www.ups.com/track?tracknum=${n}`;
    case 'FedEx': return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    default: return null;
  }
}

export async function handleAddTracking(request, env) {
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

  const { orderId, carrier, trackingNumber } = payload || {};
  if (!orderId || !carrier || !trackingNumber) {
    return jsonResponse({ error: 'Missing orderId, carrier, or trackingNumber.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);
  const { data: order, error: fetchError } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (fetchError || !order) return jsonResponse({ error: 'Order not found.' }, 404);

  const { error: updateError } = await supabase.from('orders').update({
    carrier,
    tracking_number: trackingNumber,
    shipped_at: new Date().toISOString()
  }).eq('id', orderId);
  if (updateError) return jsonResponse({ error: updateError.message }, 500);

  const url = trackingUrl(carrier, trackingNumber);
  const firstName = (order.customer_name || 'there').split(' ')[0];
  // FFL-transfer orders ship to the receiving DEALER, not the end customer -
  // the wording has to reflect that or "your order has shipped" reads as if
  // a firearm just showed up at the customer's front door, which would be a
  // real compliance-sounding scare for no reason.
  const destinationNote = order.fulfillment_method === 'ffl_transfer'
    ? `It's on its way to ${order.transfer_ffl_business_name || 'your receiving dealer'} - they'll reach out once it arrives to schedule your transfer.`
    : `It's on its way to the address on file.`;

  try {
    await sendEmail(env, {
      to: order.customer_email,
      subject: `Your order ${order.order_number} has shipped`,
      source: 'order_shipped',
      relatedTable: 'orders',
      relatedId: order.id,
      text: [
        `Hi ${order.customer_name || 'there'},`,
        ``,
        `Your order ${order.order_number} has shipped.`,
        destinationNote,
        ``,
        `Carrier: ${carrier}`,
        `Tracking number: ${trackingNumber}`,
        url ? `Track it here: ${url}` : '',
        ``,
        `Questions? Call us at (928) 727-0893.`,
        ``,
        `- Golden Valley Guns`
      ].filter(Boolean).join('\n'),
      html: emailShell([
        emailGreeting(firstName),
        emailParagraph(`Your order <strong>${escapeHtml(order.order_number)}</strong> has shipped. ${escapeHtml(destinationNote)}`),
        emailInfoBox([['Carrier', carrier], ['Tracking Number', trackingNumber]]),
        url ? emailButton(url, 'Track Your Package') : '',
        emailFooterNote()
      ].join(''))
    });
  } catch (err) {
    // The tracking info is already saved either way - a failed email here
    // shouldn't make the admin think the save itself failed.
    return jsonResponse({ success: true, emailSent: false, emailError: err.message });
  }

  return jsonResponse({ success: true, emailSent: true });
}
