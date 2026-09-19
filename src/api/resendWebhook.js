// POST /api/webhooks/resend - Resend calls this whenever an email's real
// delivery outcome changes (delivered, bounced, complained, delayed). Before
// this, email_log's "sent" status only ever meant "Resend's API accepted the
// request" - there was no way to know what actually happened after, which is
// exactly what let "the customer says they never got it" become a real
// investigation instead of a checkable fact. This closes that loop: every
// event updates the matching email_log row (matched by the resend_id
// captured at send time, see src/lib/email.js) with what really happened.
//
// Signature verification follows the Svix webhook standard (Resend's
// webhooks are Svix-based) - see https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests.
// Required secret: RESEND_WEBHOOK_SECRET (wrangler secret put), the
// "Signing Secret" shown on this webhook's page at resend.com/webhooks.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { sendEmail } from '../lib/email.js';

// Sources where a bounce/complaint means a real person - customer or Shawn -
// never got payment-critical information. A bounce on these gets Shawn an
// immediate heads-up so he can call/text instead of finding out when the
// customer complains. Not every email source needs this (a bounced review
// invite isn't urgent), so this stays a deliberate allow-list.
const PAYMENT_CRITICAL_SOURCES = new Set([
  'order_confirmation',
  'order_admin_notice',
  'special_order_payment_link'
]);

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvixSignature(env, { svixId, svixTimestamp, svixSignature, rawBody }) {
  if (!env.RESEND_WEBHOOK_SECRET) throw new Error('RESEND_WEBHOOK_SECRET is not set - wrangler secret put RESEND_WEBHOOK_SECRET (get the value from resend.com/webhooks).');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject anything older than 5 minutes - Svix's own replay-protection
  // recommendation, since a captured valid request would otherwise stay
  // forever-replayable.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(svixTimestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const secretBytes = base64ToBytes(env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(new Uint8Array(sigBytes));

  // svix-signature can list multiple space-separated "v1,<base64>" values
  // (secret rotation support) - a match against any of them is valid.
  return svixSignature.split(' ').some(entry => {
    const [, sig] = entry.split(',');
    return sig && timingSafeEqual(sig, expected);
  });
}

const EVENT_TO_STATUS = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed'
};

export async function handleResendWebhook(request, env) {
  const rawBody = await request.text();

  const verified = await verifySvixSignature(env, {
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
    rawBody
  });
  if (!verified) {
    return new Response(JSON.stringify({ error: 'Invalid signature.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const deliveryStatus = EVENT_TO_STATUS[payload?.type];
  const resendId = payload?.data?.email_id;
  if (!deliveryStatus || !resendId) {
    // Not an event we track (e.g. email.clicked/opened) - ack so Resend
    // doesn't keep retrying something we deliberately don't handle.
    return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const supabase = getSupabaseAdmin(env);
  const detail = payload?.data?.bounce?.message || payload?.data?.reason || null;

  const { data: updatedRows, error } = await supabase
    .from('email_log')
    .update({ delivery_status: deliveryStatus, delivery_status_at: new Date().toISOString(), delivery_detail: detail })
    .eq('resend_id', resendId)
    .select('sent_to, subject, source, related_table, related_id');

  if (error) {
    console.error('resend webhook: email_log update failed:', error);
    return new Response(JSON.stringify({ error: 'DB update failed.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const row = updatedRows?.[0];
  if (row && (deliveryStatus === 'bounced' || deliveryStatus === 'complained') && PAYMENT_CRITICAL_SOURCES.has(row.source)) {
    try {
      await sendEmail(env, {
        subject: `Email ${deliveryStatus} - ${row.subject || row.source}`,
        text: [
          `A payment-related email genuinely failed to reach its recipient - this needs a phone call or text, not just a resend.`,
          ``,
          `To: ${row.sent_to}`,
          `Subject: ${row.subject || '(none)'}`,
          `Reason: ${detail || deliveryStatus}`,
          row.related_table && row.related_id ? `Related: ${row.related_table} ${row.related_id}` : null
        ].filter(Boolean).join('\n'),
        source: 'delivery_failure_alert'
      });
    } catch (err) {
      // Best-effort - the email_log row itself is already the source of
      // truth even if this admin nudge fails to send.
      console.error('resend webhook: bounce alert email failed to send:', err);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
