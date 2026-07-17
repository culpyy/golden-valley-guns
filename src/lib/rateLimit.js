// Best-effort per-key rate limiting backed by Workers KV. Not perfectly
// atomic under concurrent requests (KV reads/writes can race, letting a
// burst slip a little over the limit) - that's an acceptable tradeoff here,
// the goal is throttling abuse (e.g. card-testing against /api/checkout),
// not strict enforcement. A Durable Object would give real atomicity but
// is more machinery than this needs.
//
// Returns { allowed, retryAfterSeconds }. Caller decides what to do with a
// blocked request (typically a 429 response).
export async function checkRateLimit(env, key, { limit, windowSeconds }) {
  const kvKey = `ratelimit:${key}`;
  const existing = await env.RATE_LIMIT.get(kvKey, { type: 'json' });

  if (!existing || existing.resetAt <= Date.now()) {
    const resetAt = Date.now() + windowSeconds * 1000;
    await env.RATE_LIMIT.put(kvKey, JSON.stringify({ count: 1, resetAt }), { expirationTtl: windowSeconds });
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - Date.now()) / 1000) };
  }

  const remainingTtl = Math.max(1, Math.ceil((existing.resetAt - Date.now()) / 1000));
  await env.RATE_LIMIT.put(kvKey, JSON.stringify({ count: existing.count + 1, resetAt: existing.resetAt }), { expirationTtl: remainingTtl });
  return { allowed: true };
}
