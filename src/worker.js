import { run as runLipseys, backfillLipseysImages } from './sync/lipseys.js';
import { run as runRsr } from './sync/rsr.js';
import { run as runDavidsons } from './sync/davidsons.js';
import { run as runOrion } from './sync/orion.js';
import { handleCheckout } from './api/checkout.js';
import { checkRateLimit } from './lib/rateLimit.js';
import { addSecurityHeaders } from './lib/securityHeaders.js';

// Lipsey's API access approved 2026-07-18 (email confirmed: domain
// goldenvalleygunllc.com + relay/'s IP 137.131.2.233 both approved). Image
// hotlinking was already fixed before this (sync/lipseys.js downloads to
// our own R2 bucket, see src/lib/imageCache.js) - both compliance blockers
// from the 2026-07-17 pause are now cleared, sync is back on.
const SYNC_JOBS = [
  ['lipseys', runLipseys],
  ['rsr', runRsr],
  ['davidsons', runDavidsons],
  ['orion', runOrion],
];

// Must match one entry in wrangler.jsonc's triggers.crons exactly - image
// backfilling doesn't need Lipsey's login/catalog fetch at all (just
// image_source_name values already in the DB + a fetch to their public
// image CDN), so it runs on its own much more frequent schedule instead of
// waiting on the once-daily full catalog sync. At only ~20 images from the
// daily sync alone, a several-thousand-image backlog would take the better
// part of a year to clear.
const IMAGE_BACKFILL_CRON = '*/10 * * * *';

async function route(request, env) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/distributor-images/')) {
    const key = url.pathname.slice('/distributor-images/'.length);
    const object = await env.DISTRIBUTOR_IMAGES.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        // Immutable - each sync only ever writes a given key once (skips if
        // already present), so a long-lived cache is always safe here.
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }

  if (url.pathname === '/api/checkout' && request.method === 'POST') {
    // Checkout endpoints are a standard target for card-testing/carding
    // fraud (submit many stolen card numbers to find which ones work) -
    // 5 attempts per 10 minutes per IP is generous for a real customer
    // (who'd rarely retry that many times) but meaningfully throttles that.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `checkout:${ip}`, { limit: 5, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Please try again later or contact us directly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleCheckout(request, env);
    } catch (err) {
      console.error('Checkout failed:', err);
      return new Response(JSON.stringify({ error: 'Checkout failed. Please try again or contact us.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const response = await route(request, env);
    return addSecurityHeaders(response);
  },

  async scheduled(event, env, ctx) {
    if (event.cron === IMAGE_BACKFILL_CRON) {
      ctx.waitUntil(
        backfillLipseysImages(env)
          .then(count => console.log(`lipseys image backfill: ${count} images cached.`))
          .catch(err => console.error('lipseys image backfill failed:', err))
      );
      return;
    }

    for (const [name, run] of SYNC_JOBS) {
      ctx.waitUntil(
        run(env)
          .then(count => console.log(`${name} sync complete: ${count ?? 0} items upserted.`))
          .catch(err => console.error(`${name} sync failed:`, err))
      );
    }
  },
};
