// POST /api/notify-build-status - replaces admin-dashboard.html's old
// EmailJS integration, which pointed at placeholder account IDs
// (YOUR_EMAILJS_PUBLIC_KEY etc.) that were never actually filled in, so it
// silently did nothing on every build status change. Now sends through the
// same Resend-based email path as the contact form and order confirmations
// (src/lib/email.js).
//
// The dashboard already trusts Supabase RLS (is_admin()) to gate who can
// edit a build in the first place - this endpoint re-checks that same
// admin-ness server-side (via the caller's Supabase access token) rather
// than trusting the client, since anyone who could reach this Worker route
// directly would otherwise be able to make it send arbitrary emails "from"
// this domain to any build's customer_email on file.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { sendEmail } from '../lib/email.js';
import { isAdminToken } from '../lib/adminAuth.js';
import { emailShell, emailGreeting, emailParagraph, emailInfoBox, emailFooterNote, escapeHtml } from '../lib/emailTemplate.js';

const STATUS_LABELS = {
  'intake': 'Intake', 'parts-ordered': 'Parts Ordered', 'in-progress': 'In Progress',
  'testing': 'Testing', 'atf-filed': 'ATF Filed', 'atf-approved': 'ATF Approved', 'ready': 'Ready'
};

const STATUS_DESCRIPTIONS = {
  'intake':        'Checked in - being assessed',
  'parts-ordered': 'Waiting on parts',
  'in-progress':   'On the bench',
  'testing':       'Function check',
  'atf-filed':     'ATF pending approval',
  'atf-approved':  'ATF approved - ready to transfer',
  'ready':         'Done - ready for pickup'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleNotifyBuildStatus(request, env) {
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

  const { buildId } = payload || {};
  if (!buildId) return jsonResponse({ error: 'Missing buildId.' }, 400);

  const supabase = getSupabaseAdmin(env);
  const { data: build, error } = await supabase.from('builds').select('*').eq('id', buildId).single();
  if (error || !build) return jsonResponse({ error: 'Build not found.' }, 404);
  if (!build.customer_email) return jsonResponse({ error: 'No customer email on file for this build.' }, 400);

  const statusLabel = STATUS_LABELS[build.status] || build.status;
  const statusDesc = STATUS_DESCRIPTIONS[build.status] || '';

  const firstName = (build.customer_name || 'there').split(' ')[0];
  await sendEmail(env, {
    to: build.customer_email,
    subject: `Update on your build: ${build.title} - ${statusLabel}`,
    text: [
      `Hi ${build.customer_name || 'there'},`,
      ``,
      `Your build "${build.title}" has an update:`,
      ``,
      `Status: ${statusLabel}`,
      statusDesc,
      ``,
      `Track your build anytime at goldenvalleygunsllc.com/track.html using code ${build.tracking_code}.`,
      ``,
      `Questions? Call us at (928) 727-0893.`,
      ``,
      `- Golden Valley Guns`
    ].filter(Boolean).join('\n'),
    html: emailShell([
      emailGreeting(firstName),
      emailParagraph(`Your build <strong>"${escapeHtml(build.title)}"</strong> has an update:`),
      emailInfoBox([['Status', statusLabel], [statusDesc ? 'Details' : null, statusDesc]]),
      emailParagraph(`Track your build anytime at <a href="https://goldenvalleygunsllc.com/track.html" style="color:#8B6914;">goldenvalleygunsllc.com/track.html</a> using code <strong>${escapeHtml(build.tracking_code)}</strong>.`),
      emailFooterNote()
    ].join(''))
  });

  return jsonResponse({ success: true });
}
