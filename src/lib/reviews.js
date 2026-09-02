// Sends the one-time review-invite email once a build is genuinely done
// (see sql/reviews.sql for the gating rationale). Called from both places
// builds.payment_status can flip to 'paid': src/api/pay.js (online pay-
// link) and the admin dashboard's "Mark Paid (cash/other)" button (via
// POST /api/admin/send-review-invite below, since that path is a direct
// client-side Supabase write with no server request to hook otherwise).
//
// Idempotent by design (reviews.build_id is unique, see sql/reviews.sql) -
// safe to call this on every payment-completion path without tracking
// "have we already invited this build" anywhere else. A failed insert from
// the unique constraint is treated as "already invited," not an error.
import { getSupabaseAdmin } from './supabaseAdmin.js';
import { sendEmail } from './email.js';
import { emailShell, emailGreeting, emailParagraph, emailButton, emailFooterNote, escapeHtml } from './emailTemplate.js';

function randomToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

export async function sendReviewInvite(env, buildId) {
  const supabase = getSupabaseAdmin(env);
  const { data: build } = await supabase.from('builds').select('*').eq('id', buildId).single();
  if (!build) return { sent: false, reason: 'Build not found.' };
  if (!build.customer_email) return { sent: false, reason: 'No customer email on file.' };
  // status !== 'ready' would mean payment_status somehow flipped to 'paid'
  // before the build itself was actually done - shouldn't happen given how
  // both write paths work today, but a review invite for an unfinished
  // build would be nonsensical, so this stays a hard gate rather than an
  // assumption.
  if (build.status !== 'ready' || build.payment_status !== 'paid') {
    return { sent: false, reason: 'Build is not both Ready and paid yet.' };
  }

  const token = randomToken();
  const { error: insertError } = await supabase.from('reviews').insert({
    build_id: build.id,
    token,
    customer_name: build.customer_name,
    build_title: build.title
  });
  if (insertError) {
    // 23505 = unique_violation - reviews.build_id already has a row, i.e.
    // this build was already invited (by the other trigger path, or a
    // retry). Not a real failure.
    if (insertError.code === '23505') return { sent: false, reason: 'Already invited.' };
    return { sent: false, reason: insertError.message };
  }

  const firstName = (build.customer_name || 'there').split(' ')[0];
  const reviewUrl = `https://${env.SITE_HOSTNAME}/review.html?token=${token}`;
  await sendEmail(env, {
    to: build.customer_email,
    subject: `How'd we do on your ${build.title}?`,
    source: 'review_invite',
    relatedTable: 'builds',
    relatedId: build.id,
    text: [
      `Hi ${build.customer_name || 'there'},`,
      ``,
      `Your build "${build.title}" is all done - thanks for trusting us with it.`,
      ``,
      `If you've got a minute, we'd really appreciate a quick review:`,
      reviewUrl,
      ``,
      `- Golden Valley Guns`
    ].join('\n'),
    html: emailShell([
      emailGreeting(firstName),
      emailParagraph(`Your build <strong>"${escapeHtml(build.title)}"</strong> is all done - thanks for trusting us with it.`),
      emailParagraph(`If you've got a minute, we'd really appreciate a quick review:`),
      emailButton(reviewUrl, 'Leave a Review'),
      emailFooterNote()
    ].join(''))
  });

  return { sent: true };
}
