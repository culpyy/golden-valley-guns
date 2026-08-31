// Sends via Resend's HTTP API. Switched from Cloudflare Email Routing's
// send_email binding (2026-08-06) because that binding can only deliver to
// verified account addresses without a Workers Paid plan + domain onboarding
// - meaning it could never actually reach real customers. Resend has no such
// restriction once the sending domain is DNS-verified (see the DKIM/SPF/DMARC
// records added to the goldenvalleygunsllc.com zone).
import { getSupabaseAdmin } from './supabaseAdmin.js';

const SEND_FROM = 'noreply@goldenvalleygunsllc.com';

// Every send gets logged to `email_log` (sql/email_log.sql), sent or failed -
// added 2026-08-31 after a customer said he never got his ready-for-pickup
// email and there was no way to check without a Resend dashboard login.
// Best-effort and fully isolated from the actual send: a logging hiccup
// must never mask the real Resend error or make a successful send look
// like it failed, so this never throws.
async function logEmailAttempt(env, { to, subject, source, relatedTable, relatedId, status, errorMessage }) {
  try {
    const supabase = getSupabaseAdmin(env);
    await supabase.from('email_log').insert({
      sent_to: to,
      subject: subject || null,
      source: source || null,
      status,
      error_message: errorMessage || null,
      related_table: relatedTable || null,
      related_id: relatedId || null
    });
  } catch (err) {
    console.error('email_log insert failed (send itself is unaffected):', err);
  }
}

export async function sendEmail(env, { to = 'goldenvalleyguns@gmail.com', subject, text, html, replyTo, attachments, source, relatedTable, relatedId }) {
  let res, errBody;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Golden Valley Guns <${SEND_FROM}>`,
        to,
        subject,
        text,
        ...(html ? { html } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments ? { attachments } : {})
      })
    });
  } catch (err) {
    await logEmailAttempt(env, { to, subject, source, relatedTable, relatedId, status: 'failed', errorMessage: `Network error: ${err.message}` });
    throw err;
  }

  if (!res.ok) {
    errBody = await res.text().catch(() => '');
    await logEmailAttempt(env, { to, subject, source, relatedTable, relatedId, status: 'failed', errorMessage: `Resend API error (${res.status}): ${errBody}` });
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }

  await logEmailAttempt(env, { to, subject, source, relatedTable, relatedId, status: 'sent' });
}
