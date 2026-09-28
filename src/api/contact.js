// POST /api/contact - replaces Formspree (see sql/contact_submissions.sql
// for why). Writes the submission to Supabase and emails it to Shawn via
// Resend, in that order - the DB write is the durable record, email is the
// notification. If the email send fails, the
// submission is still saved and visible to whoever checks the table/admin
// dashboard, rather than being lost the way a Formspree-only flow would be.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { sendEmail } from '../lib/email.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { emailShell, emailParagraph, emailInfoBox, emailButton, emailFooterNote, escapeHtml } from '../lib/emailTemplate.js';

const SUBJECT_LABELS = {
  build: 'Custom Build Inquiry',
  gunsmithing: 'Gunsmithing / Repair',
  parts: 'Parts Work',
  transfer: 'FFL Transfer',
  buysell: 'Buy / Sell / Trade',
  order: 'Shop / Parts Order',
  other: 'Other'
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

export async function handleContact(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  // Honeypot - a real visitor never fills this in (it's off-screen).
  // Return a normal-looking success so bots don't learn to avoid it.
  if (payload?._gotcha) {
    return jsonResponse({ success: true });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { allowed, retryAfterSeconds } = await checkRateLimit(env, `contact:${ip}`, { limit: 5, windowSeconds: 600 });
  if (!allowed) {
    return jsonResponse({ error: 'Too many messages sent. Please try again later or call us directly.' }, 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  const { fname, lname, email, phone, subject, message } = payload || {};
  if (!fname || !lname || !email || !subject || !message) {
    return jsonResponse({ error: 'Please fill in all required fields.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);
  const { error: insertError } = await supabase.from('contact_submissions').insert({
    first_name: fname,
    last_name: lname,
    email,
    phone: phone || null,
    subject,
    message
  });
  if (insertError) throw insertError;

  const subjectLabel = SUBJECT_LABELS[subject] || subject;
  try {
    const replySubject = encodeURIComponent(`Re: Website inquiry: ${subjectLabel}`);
    const mailtoUrl = `mailto:${email}?subject=${replySubject}`;
    await sendEmail(env, {
      // Reply-To set to the customer's own address so most mail clients'
      // Reply button lands in the customer's inbox directly. Some clients
      // (confirmed: iOS Mail, 2026-09-28 - Shawn's reply bounced back to
      // noreply@ instead) don't reliably honor Reply-To, so the HTML body
      // below also has a mailto: button as a client-independent fallback -
      // that one always addresses correctly since it doesn't depend on the
      // receiving client parsing Reply-To at all.
      replyTo: email,
      subject: `Website inquiry: ${subjectLabel} - ${fname} ${lname}`,
      source: 'contact_form',
      text: [
        `New contact form submission from goldenvalleygunsllc.com`,
        ``,
        `Name: ${fname} ${lname}`,
        `Email: ${email}`,
        `Phone: ${phone || '(not provided)'}`,
        `Subject: ${subjectLabel}`,
        ``,
        `Message:`,
        message,
        ``,
        `Reply directly: ${mailtoUrl}`
      ].join('\n'),
      html: emailShell([
        emailParagraph(`New contact form submission from goldenvalleygunsllc.com`),
        emailInfoBox([
          ['Name', `${fname} ${lname}`],
          ['Email', email],
          ['Phone', phone || '(not provided)'],
          ['Subject', subjectLabel]
        ]),
        emailParagraph(`<strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}`),
        emailButton(mailtoUrl, `Reply to ${escapeHtml(fname)}`),
        emailFooterNote(`If "Reply" in your mail app doesn't go to ${escapeHtml(email)}, use the button above instead. `)
      ].join(''))
    });
  } catch (err) {
    // The submission is already saved above - don't fail the whole request
    // (and show the customer an error) just because the email notification
    // didn't go out. Log it so it's not silently missed either.
    console.error('Contact form email send failed (submission was still saved):', err);
  }

  return jsonResponse({ success: true });
}
