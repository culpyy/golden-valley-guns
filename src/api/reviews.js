// GET/POST /api/reviews - the customer-facing half of the review flow
// (src/lib/reviews.js sends the invite email with the token). Same pattern
// as src/api/pay.js's pay_token handling: the raw `reviews` table is
// admin-only (sql/reviews.sql), so review.html never queries Supabase
// directly with the anon key - it goes through here, which uses the
// service_role key server-side. The token in the URL is the entire access
// control, same as pay_token.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleGetReview(request, env) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return jsonResponse({ error: 'Missing token.' }, 400);

  const supabase = getSupabaseAdmin(env);
  const { data: review } = await supabase
    .from('reviews')
    .select('build_title, customer_name, status')
    .eq('token', token)
    .single();

  if (!review) return jsonResponse({ error: 'Review link not found.' }, 404);
  return jsonResponse({
    buildTitle: review.build_title,
    customerName: review.customer_name,
    // 'invited' is the only state review.html should show the form for -
    // 'pending'/'approved'/'rejected' all mean this token already submitted
    // once, so the page shows a "you already reviewed this" state instead.
    alreadySubmitted: review.status !== 'invited'
  });
}

export async function handlePostReview(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  const { token, rating, text } = payload || {};
  if (!token) return jsonResponse({ error: 'Missing token.' }, 400);
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return jsonResponse({ error: 'Rating must be 1-5.' }, 400);
  }
  const reviewText = (text || '').trim().slice(0, 4000);

  const supabase = getSupabaseAdmin(env);
  const { data: existing } = await supabase.from('reviews').select('id, status').eq('token', token).single();
  if (!existing) return jsonResponse({ error: 'Review link not found.' }, 404);
  if (existing.status !== 'invited') return jsonResponse({ error: 'This review has already been submitted.' }, 409);

  const { error } = await supabase
    .from('reviews')
    .update({ rating: ratingNum, review_text: reviewText, status: 'pending', submitted_at: new Date().toISOString() })
    .eq('id', existing.id);
  if (error) return jsonResponse({ error: 'Could not save your review - please try again.' }, 500);

  return jsonResponse({ success: true });
}
