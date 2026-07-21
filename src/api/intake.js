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
  const { error: insertError } = await supabase.from('intake_submissions').insert({
    name,
    email: email || null,
    phone: phone || null,
    service,
    firearm_type: firearmType || null,
    caliber: caliber || null,
    is_nfa: !!isNfa,
    notes: notes || null
  });
  if (insertError) throw insertError;

  const serviceLabel = SERVICE_LABELS[service] || service;
  // Best-effort - the submission is already saved above, an email hiccup
  // shouldn't fail the customer's request (same reasoning as contact.js).
  try {
    await sendEmail(env, {
      subject: `Incoming shipment: ${serviceLabel} - ${name}`,
      text: [
        `Someone filled out the intake form for a shipment on the way.`,
        ``,
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

  return jsonResponse({ success: true });
}
