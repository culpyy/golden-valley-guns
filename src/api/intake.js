// POST /api/intake - saves what used to be a pure print-and-mail form
// (intake.html) into intake_submissions, so Shawn can see a shipment coming
// before the box actually shows up, and jump straight to creating a Build
// from it (admin-dashboard.html's Intake tab) instead of re-typing
// everything off the printed slip by hand. The slip itself is unchanged -
// this runs alongside it, not instead of it.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { sendEmail } from '../lib/email.js';
import { checkRateLimit } from '../lib/rateLimit.js';

const SERVICE_LABELS = {
  custom_build: 'Custom Build',
  parts_kit: 'Parts Kit Build',
  gunsmithing: 'Gunsmithing / Repair',
  transfer: 'FFL Transfer',
  other: 'Other'
};

// Excludes 0/O/1/I - the whole point of this code is a customer hand-writing
// it on a box, so ambiguous characters defeat the purpose.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateIntakeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
  return `SHIP-${code}`;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

export async function handleIntake(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  // Honeypot - same pattern as contact.js, a real visitor never fills this
  // in (it's off-screen). Return a normal-looking success so bots don't
  // learn to avoid it.
  if (payload?._gotcha) {
    return jsonResponse({ success: true });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { allowed, retryAfterSeconds } = await checkRateLimit(env, `intake:${ip}`, { limit: 5, windowSeconds: 600 });
  if (!allowed) {
    return jsonResponse({ error: 'Too many submissions. Please try again later or call us directly.' }, 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  const { name, email, phone, service, firearmType, caliber, isNfa, notes } = payload || {};
  if (!name || !service || (!email && !phone)) {
    return jsonResponse({ error: 'Please add your name, a service type, and at least an email or phone number.' }, 400);
  }

  const supabase = getSupabaseAdmin(env);
  // Tiny retry loop for the rare unique-constraint collision on intake_code -
  // same defensive pattern as tracking-code generation in admin-dashboard.html,
  // just with random codes instead of sequential ones (no shared counter to
  // race over, so 3 attempts is already generous for how unlikely a real
  // collision is at 33^6 possible codes).
  let intakeCode, insertError;
  for (let attempt = 0; attempt < 3; attempt++) {
    intakeCode = generateIntakeCode();
    ({ error: insertError } = await supabase.from('intake_submissions').insert({
      name,
      email: email || null,
      phone: phone || null,
      service,
      firearm_type: firearmType || null,
      caliber: caliber || null,
      is_nfa: !!isNfa,
      notes: notes || null,
      intake_code: intakeCode
    }));
    if (!insertError || insertError.code !== '23505') break;
  }
  if (insertError) throw insertError;

  const serviceLabel = SERVICE_LABELS[service] || service;
  // Best-effort - the submission is already saved above, an email hiccup
  // shouldn't fail the customer's request (same reasoning as contact.js).
  try {
    await sendEmail(env, {
      subject: `Incoming shipment: ${serviceLabel} - ${name} [${intakeCode}]`,
      text: [
        `Someone filled out the intake form for a shipment on the way.`,
        ``,
        `Reference code: ${intakeCode}`,
        `Name: ${name}`,
        `Email: ${email || '(not provided)'}`,
        `Phone: ${phone || '(not provided)'}`,
        `Service: ${serviceLabel}`,
        firearmType ? `Firearm Type: ${firearmType}` : '',
        caliber ? `Caliber: ${caliber}` : '',
        isNfa ? `NFA item: yes` : '',
        ``,
        notes ? `Notes:\n${notes}` : '',
        ``,
        `See the Intake tab in the admin dashboard for full details.`
      ].filter(Boolean).join('\n')
    });
  } catch (err) {
    console.error('Intake notification email failed (submission was still saved):', err);
  }

  // Customer confirmation - only sent if they gave an email, since some
  // customers only leave a phone number. This is the backup copy of the
  // reference code and shipping instructions in case the printed slip gets
  // lost or they never printed it at all. Same best-effort posture as
  // Shawn's notification above - independent try/catch so one email
  // failing never blocks the other, and neither blocks the saved submission.
  let emailSent = false;
  if (email) {
    try {
      await sendEmail(env, {
        to: email,
        subject: `Your shipping reference code: ${intakeCode} - Golden Valley Guns`,
        text: [
          `Hi ${name.split(' ')[0]},`,
          ``,
          `Thanks for letting us know something's headed our way. Here's your reference code:`,
          ``,
          intakeCode,
          ``,
          `Before you ship it, print this email (or just write the code down) and put it inside the box.`,
          ``,
          `Ship to:`,
          `Golden Valley Guns LLC`,
          `7088 W Jupiter Dr`,
          `Golden Valley, AZ 86413`,
          ``,
          `What you told us:`,
          `Service: ${serviceLabel}`,
          firearmType ? `Firearm Type: ${firearmType}` : '',
          caliber ? `Caliber: ${caliber}` : '',
          isNfa ? `NFA item: yes` : '',
          notes ? `Notes: ${notes}` : '',
          ``,
          `Questions, or shipping an NFA item? Call or text us first at (928) 727-0893.`,
          ``,
          `- Golden Valley Guns`
        ].filter(Boolean).join('\n')
      });
      emailSent = true;
    } catch (err) {
      console.error('Intake customer confirmation email failed (submission was still saved):', err);
    }
  }

  return jsonResponse({ success: true, intakeCode, emailSent });
}
