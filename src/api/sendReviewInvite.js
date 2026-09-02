// POST /api/admin/send-review-invite - triggers src/lib/reviews.js from the
// admin dashboard's "Mark Paid (cash/other)" button, since that path does a
// direct client-side Supabase write with no server request otherwise to
// hook the invite off of. src/api/pay.js calls sendReviewInvite() directly
// instead (already server-side there). Admin-gated the same way
// notify-build-status.js is, since this sends an email "from" this domain.
import { isAdminToken } from '../lib/adminAuth.js';
import { sendReviewInvite } from '../lib/reviews.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleSendReviewInvite(request, env) {
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

  const result = await sendReviewInvite(env, buildId);
  return jsonResponse(result);
}
