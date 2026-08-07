// Sends via Resend's HTTP API. Switched from Cloudflare Email Routing's
// send_email binding (2026-08-06) because that binding can only deliver to
// verified account addresses without a Workers Paid plan + domain onboarding
// - meaning it could never actually reach real customers. Resend has no such
// restriction once the sending domain is DNS-verified (see the DKIM/SPF/DMARC
// records added to the goldenvalleygunsllc.com zone).
const SEND_FROM = 'noreply@goldenvalleygunsllc.com';

export async function sendEmail(env, { to = 'goldenvalleyguns@gmail.com', subject, text, html, replyTo, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
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

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }
}
