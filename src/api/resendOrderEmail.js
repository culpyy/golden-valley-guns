// POST /api/admin/resend-order-email - lets Shawn re-send a customer's
// order email on demand instead of the only options being "hope they check
// spam" or manually relaying the info himself. Reconstructs the same
// customer-facing email checkout.js/pay.js/specialOrder.js originally sent,
// entirely from data already stored on the order row - no separate
// "original email content" needs to be kept around for this to work.
//
// Which email depends on the order's current state:
//   status 'pending' + has a pay_token -> the payment link email again
//   status 'paid'/'refunded'            -> the paid confirmation again
// Anything else (no pay_token on a pending order, or a cancelled/failed
// order with nothing to confirm) has no real email to resend.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { isAdminToken } from '../lib/adminAuth.js';
import { sendEmail } from '../lib/email.js';
import { emailShell, emailGreeting, emailParagraph, emailInfoBox, emailOrderSummary, emailButton, emailFooterNote } from '../lib/emailTemplate.js';
import { buildInvoicePdf, bytesToBase64 } from '../lib/pdf.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleResendOrderEmail(request, env) {
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
  if (!order.customer_email) return jsonResponse({ error: 'This order has no customer email on file.' }, 400);

  const items = order.items || [];
  const itemName = items[0]?.name || 'Your order';
  const customerName = order.customer_name || '';
  const firstName = customerName.split(' ')[0] || 'there';

  if (order.status === 'pending') {
    if (!order.pay_token) {
      return jsonResponse({ error: 'This order has no payment link to resend (not a special order awaiting payment).' }, 400);
    }
    const payUrl = `https://${env.SITE_HOSTNAME}/pay.html?token=${order.pay_token}`;
    await sendEmail(env, {
      to: order.customer_email,
      subject: `Payment link for your order - Golden Valley Guns`,
      source: 'special_order_payment_link',
      relatedTable: 'orders',
      relatedId: order.id,
      text: [
        `Hi ${firstName},`,
        ``,
        `Here's the payment link for your order:`,
        ``,
        `Order #${order.order_number}`,
        itemName,
        `$${parseFloat(order.total).toFixed(2)}`,
        ``,
        order.is_firearm
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
        emailParagraph(`Here's the payment link for your order <strong>#${order.order_number}</strong>:`),
        emailInfoBox([[itemName, `$${parseFloat(order.total).toFixed(2)}`]]),
        emailButton(payUrl, 'Pay Now'),
        order.is_firearm
          ? emailParagraph(`This is a firearm, so it can't ship directly to you - when you pay, you'll choose to either pick it up in person here or have it transferred to your own local FFL dealer. Either way, a NICS background check and ATF Form 4473 are required before it's yours.`)
          : '',
        emailFooterNote()
      ].join(''))
    });
    return jsonResponse({ success: true, emailType: 'payment_link' });
  }

  if (order.status === 'paid' || order.status === 'refunded') {
    const fulfillmentMethod = order.fulfillment_method || 'pickup';
    const transferFfl = fulfillmentMethod === 'ffl_transfer' ? {
      businessName: order.transfer_ffl_business_name,
      address: order.transfer_ffl_address
    } : null;
    const shippingMethod = order.ship_to_customer ? 'ship' : 'pickup';
    const shippingAddress = order.ship_to_customer ? {
      line1: order.shipping_line1, line2: order.shipping_line2,
      city: order.shipping_city, state: order.shipping_state, zip: order.shipping_zip
    } : null;

    let firearmNote = '', firearmNoteHtml = '';
    if (order.is_firearm && fulfillmentMethod === 'ffl_transfer' && transferFfl?.businessName) {
      firearmNote = `\n\nThis order includes a firearm, transferring to your dealer (${transferFfl.businessName}, ${transferFfl.address}) rather than shipping to you directly - required by federal law.`;
      firearmNoteHtml = emailParagraph(`This order includes a firearm, transferring to your dealer rather than shipping to you directly - required by federal law.`) +
        emailInfoBox([['Dealer', transferFfl.businessName], ['Address', transferFfl.address]]);
    } else if (order.is_firearm) {
      firearmNote = `\n\nThis order includes a firearm - it's reserved for you but nothing ships. You'll complete a NICS background check and ATF Form 4473 in person when you pick it up.`;
      firearmNoteHtml = emailParagraph(`This order includes a firearm - it's reserved for you but nothing ships. You'll complete a NICS background check and ATF Form 4473 in person when you pick it up.`);
    } else if (shippingMethod === 'ship' && shippingAddress) {
      firearmNote = `\n\nWe'll ship this order to:\n${shippingAddress.line1}${shippingAddress.line2 ? '\n' + shippingAddress.line2 : ''}\n${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}`;
      firearmNoteHtml = emailParagraph(`We'll ship this order to the address below.`) +
        emailInfoBox([['Address', [shippingAddress.line1, shippingAddress.line2, `${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}`].filter(Boolean).join(', ')]]);
    } else {
      firearmNote = `\n\nThis order is ready for pickup at our shop whenever works for you.`;
      firearmNoteHtml = emailParagraph(`This order is ready for pickup at our shop whenever works for you.`);
    }

    let invoiceAttachment;
    try {
      const pdfBytes = await buildInvoicePdf({
        orderNumber: order.order_number, date: new Date(order.created_at),
        customerName, customerEmail: order.customer_email, customerPhone: order.customer_phone,
        items, subtotal: order.subtotal ?? order.total, taxAmount: order.tax_amount || 0, total: order.total,
        isFirearm: order.is_firearm, fulfillmentMethod, transferFfl, shippingMethod, shippingAddress
      });
      invoiceAttachment = [{ filename: `invoice-${order.order_number}.pdf`, content: bytesToBase64(pdfBytes) }];
    } catch (err) {
      console.error(`Order ${order.order_number} resend: invoice PDF generation failed (email will still send without it):`, err);
    }

    const isSpecialOrder = order.source === 'special_order';
    await sendEmail(env, {
      to: order.customer_email,
      subject: isSpecialOrder ? `Payment confirmed: ${order.order_number} - Golden Valley Guns` : `Order confirmed: #${order.order_number} - Golden Valley Guns`,
      source: isSpecialOrder ? 'special_order_payment_confirmation' : 'order_confirmation',
      relatedTable: 'orders',
      relatedId: order.id,
      text: [
        `Hi ${firstName},`,
        ``,
        `Here's your order confirmation:`,
        ``,
        `Order #${order.order_number}`,
        itemName,
        `Total: $${parseFloat(order.total).toFixed(2)}`,
        firearmNote,
        ``,
        `Your invoice is attached to this email.`,
        ``,
        `Questions? Call or text us at (928) 727-0893.`,
        ``,
        `- Golden Valley Guns`
      ].join('\n'),
      html: emailShell([
        emailGreeting(firstName),
        emailParagraph(`Here's your order confirmation for <strong>#${order.order_number}</strong>:`),
        emailOrderSummary(items, [['Total', parseFloat(order.total)]]),
        firearmNoteHtml,
        emailParagraph(`Your invoice is attached to this email.`),
        emailFooterNote()
      ].join('')),
      attachments: invoiceAttachment
    });
    return jsonResponse({ success: true, emailType: 'confirmation' });
  }

  return jsonResponse({ error: `Can't resend an email for an order in "${order.status}" status.` }, 400);
}
