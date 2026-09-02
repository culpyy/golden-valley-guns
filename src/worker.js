import { run as runLipseys, backfillLipseysImages } from './sync/lipseys.js';
import { run as runRsr } from './sync/rsr.js';
import { run as runDavidsons } from './sync/davidsons.js';
import { run as runOrion, backfillOrionImages } from './sync/orion.js';
import { handleCheckout } from './api/checkout.js';
import { handleContact } from './api/contact.js';
import { handleIntake } from './api/intake.js';
import { handleNotifyBuildStatus } from './api/notifyBuildStatus.js';
import { handleUploadProductImage } from './api/uploadProductImage.js';
import { handleUploadBuildImage } from './api/uploadBuildImage.js';
import { handleUploadGalleryImage } from './api/uploadGalleryImage.js';
import { handleUploadBulletinImage } from './api/uploadBulletinImage.js';
import { handleCreateSpecialOrder } from './api/specialOrder.js';
import { handleGetPayOrder, handlePayOrder } from './api/pay.js';
import { handleRefundOrder } from './api/refundOrder.js';
import { handlePaymentDiagnostics } from './api/paymentDiagnostics.js';
import { handleGetReview, handlePostReview } from './api/reviews.js';
import { handleSendReviewInvite } from './api/sendReviewInvite.js';
import { checkRateLimit } from './lib/rateLimit.js';
import { addSecurityHeaders } from './lib/securityHeaders.js';

// Lipsey's API access approved 2026-07-18 (email confirmed: domain
// goldenvalleygunllc.com + relay/'s IP 137.131.2.233 both approved). Image
// hotlinking was already fixed before this (sync/lipseys.js downloads to
// our own R2 bucket, see src/lib/imageCache.js) - both compliance blockers
// from the 2026-07-17 pause are now cleared, sync is back on.
//
// Orion and Davidson's are NOT in this list - see ORION_SYNC_CRON and
// DAVIDSONS_SYNC_CRON below for why they run on their own separate triggers
// instead of bundled in here with the others.
const SYNC_JOBS = [
  ['lipseys', runLipseys],
  ['rsr', runRsr],
];

// Must match one entry in wrangler.jsonc's triggers.crons exactly - image
// backfilling doesn't need Lipsey's login/catalog fetch at all (just
// image_source_name values already in the DB + a fetch to their public
// image CDN), so it runs on its own much more frequent schedule instead of
// waiting on the once-daily full catalog sync. At only ~20 images from the
// daily sync alone, a several-thousand-image backlog would take the better
// part of a year to clear.
const IMAGE_BACKFILL_CRON = '*/10 * * * *';

// Orion (orionfflsales.com) went from a scaffold to fully live 2026-07-24 -
// real dealer key verified against the live API, see sync/orion.js for the
// full writeup. Originally bundled into SYNC_JOBS above, but its ~25MB
// unpaginated catalog + inventory fetch pushed that shared invocation over
// Cloudflare's per-invocation subrequest limit on the very first live run
// ("Too many subrequests by single Worker invocation" - same failure mode
// that made Lipsey's image backfill need its own cron, see
// IMAGE_BACKFILL_CRON above). Its own dedicated trigger gives it a clean
// subrequest budget instead of sharing one with Lipsey's/RSR/Davidson's.
//
// This constant's value is registered in wrangler.jsonc's triggers.crons
// again as of 2026-07-28 - was paused 2026-07-24 to 2026-07-28 pending
// review of Orion's actual dealer/API agreement, now confirmed reviewed
// (see wrangler.jsonc for the full history).
//
// catalog_manufacturers is a SHARED allow-list across every distributor, not
// per-distributor - learned this the hard way during the original testing:
// it was NOT actually empty (Lipsey's already had real manufacturers
// approved), so Orion immediately started syncing real products for every
// manufacturer name it happened to share with Lipsey's, with no
// distributor-specific review step. Re-enabling now means Orion matches
// against the full widened brand list (src/lib/catalogSync.js), by design.
const ORION_SYNC_CRON = '15 */4 * * *';

// Davidson's moved off the shared SYNC_JOBS cron 2026-08-07, same reasoning
// as Orion above (see sync/davidsons.js's commit history for the actual
// "Too many subrequests" incident this caused once it joined that shared
// invocation). Unlike Orion, Davidson's per-run work is cheap once a cycle's
// raw CSV is cached (see CATALOG_CACHE_KEY in sync/davidsons.js) - each
// chunked run is just a Supabase read + parse/normalize ~1500 CSV lines +
// upsert, no external distributor request at all except on the run that
// starts a new cycle. That cheapness is why this runs far more often than
// ORION_SYNC_CRON's 4-hour cadence: at CHUNK_SIZE=1500 against a ~10,550-row
// catalog (~7 runs/cycle), 20 minutes means a full cycle finishes in ~2.3
// hours instead of the ~28 hours it took sharing the 4-hour SYNC_JOBS cron.
const DAVIDSONS_SYNC_CRON = '*/20 * * * *';

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

  if (url.pathname.startsWith('/product-images/')) {
    // Photos Shawn uploads for his own products (uploadProductImage.js) -
    // same R2 bucket as distributor images, just a different key prefix and
    // a route name that doesn't lie about what's actually being served.
    const key = 'products/' + url.pathname.slice('/product-images/'.length);
    const object = await env.DISTRIBUTOR_IMAGES.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }

  if (url.pathname.startsWith('/build-images/')) {
    // Photos Shawn uploads for completed builds (uploadBuildImage.js), shown
    // on gallery.html - same R2 bucket/prefix pattern as product images.
    const key = 'builds/' + url.pathname.slice('/build-images/'.length);
    const object = await env.DISTRIBUTOR_IMAGES.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }

  if (url.pathname.startsWith('/gallery-images/')) {
    // Photos Shawn uploads via the standalone Gallery tab
    // (uploadGalleryImage.js) - not attached to any build, own R2 key
    // prefix so it can never collide with /build-images/.
    const key = 'gallery/' + url.pathname.slice('/gallery-images/'.length);
    const object = await env.DISTRIBUTOR_IMAGES.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }

  if (url.pathname.startsWith('/bulletin-images/')) {
    // Photos Shawn uploads for "What We're Building Next" ideas
    // (uploadBulletinImage.js) - same R2 bucket/prefix pattern as the
    // other admin-uploaded image types.
    const key = 'bulletin/' + url.pathname.slice('/bulletin-images/'.length);
    const object = await env.DISTRIBUTOR_IMAGES.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }

  if (url.pathname === '/api/admin/upload-gallery-image' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `upload-gallery-image:${ip}`, { limit: 50, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many uploads. Try again shortly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleUploadGalleryImage(request, env);
    } catch (err) {
      console.error('Gallery image upload failed:', err);
      return new Response(JSON.stringify({ error: 'Upload failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/upload-build-image' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `upload-build-image:${ip}`, { limit: 20, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many uploads. Try again shortly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleUploadBuildImage(request, env);
    } catch (err) {
      console.error('Build image upload failed:', err);
      return new Response(JSON.stringify({ error: 'Upload failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/upload-product-image' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `upload-image:${ip}`, { limit: 20, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many uploads. Try again shortly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleUploadProductImage(request, env);
    } catch (err) {
      console.error('Product image upload failed:', err);
      return new Response(JSON.stringify({ error: 'Upload failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/upload-bulletin-image' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `upload-bulletin-image:${ip}`, { limit: 20, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many uploads. Try again shortly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleUploadBulletinImage(request, env);
    } catch (err) {
      console.error('Bulletin image upload failed:', err);
      return new Response(JSON.stringify({ error: 'Upload failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/create-special-order' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `create-special-order:${ip}`, { limit: 20, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleCreateSpecialOrder(request, env);
    } catch (err) {
      console.error('Special order creation failed:', err);
      return new Response(JSON.stringify({ error: 'Failed to create special order.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/refund-order' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `refund-order:${ip}`, { limit: 10, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleRefundOrder(request, env);
    } catch (err) {
      console.error('Refund failed:', err);
      return new Response(JSON.stringify({ error: 'Refund failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/payment-diagnostics' && request.method === 'GET') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `payment-diagnostics:${ip}`, { limit: 10, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handlePaymentDiagnostics(request, env);
    } catch (err) {
      console.error('Payment diagnostics failed:', err);
      return new Response(JSON.stringify({ error: 'Diagnostics failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/pay' && request.method === 'GET') {
    // Read-only lookup by token - generous but still bounded, mainly to
    // blunt token-guessing attempts rather than protect against real customers.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `pay-lookup:${ip}`, { limit: 30, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleGetPayOrder(request, env);
    } catch (err) {
      console.error('Pay order lookup failed:', err);
      return new Response(JSON.stringify({ error: 'Something went wrong.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/pay' && request.method === 'POST') {
    // Same reasoning as /api/checkout - a card-testing target, throttle it
    // the same way.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `pay:${ip}`, { limit: 5, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Please try again later or contact us directly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handlePayOrder(request, env);
    } catch (err) {
      console.error('Payment failed:', err);
      return new Response(JSON.stringify({ error: 'Payment failed. Please try again or contact us.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
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

  if (url.pathname === '/api/contact' && request.method === 'POST') {
    try {
      return await handleContact(request, env);
    } catch (err) {
      console.error('Contact form submission failed:', err);
      return new Response(JSON.stringify({ error: 'Something went wrong. Please call us instead.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/intake' && request.method === 'POST') {
    try {
      return await handleIntake(request, env);
    } catch (err) {
      console.error('Intake submission failed:', err);
      return new Response(JSON.stringify({ error: 'Something went wrong. Please call us instead.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/notify-build-status' && request.method === 'POST') {
    // Admin-only route, but still rate-limited per IP as a floor in case the
    // admin-token check in notifyBuildStatus.js is ever bypassed some other
    // way - matches the defense-in-depth pattern already used for
    // checkout/contact rather than trusting a single layer of protection.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `notify-build:${ip}`, { limit: 20, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleNotifyBuildStatus(request, env);
    } catch (err) {
      console.error('Build status notification failed:', err);
      return new Response(JSON.stringify({ error: 'Failed to send notification.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/reviews' && request.method === 'GET') {
    // Read-only lookup by token, same reasoning as /api/pay's GET.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `review-lookup:${ip}`, { limit: 30, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleGetReview(request, env);
    } catch (err) {
      console.error('Review lookup failed:', err);
      return new Response(JSON.stringify({ error: 'Something went wrong.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/reviews' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `review-submit:${ip}`, { limit: 10, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Please try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handlePostReview(request, env);
    } catch (err) {
      console.error('Review submission failed:', err);
      return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (url.pathname === '/api/admin/send-review-invite' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, retryAfterSeconds } = await checkRateLimit(env, `send-review-invite:${ip}`, { limit: 20, windowSeconds: 600 });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) }
      });
    }

    try {
      return await handleSendReviewInvite(request, env);
    } catch (err) {
      console.error('Review invite failed:', err);
      return new Response(JSON.stringify({ error: 'Failed to send invite.' }), {
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
      ctx.waitUntil(
        backfillOrionImages(env)
          .then(count => console.log(`orion image backfill: ${count} images cached.`))
          .catch(err => console.error('orion image backfill failed:', err))
      );
      return;
    }

    if (event.cron === ORION_SYNC_CRON) {
      ctx.waitUntil(
        runOrion(env)
          .then(count => console.log(`orion sync complete: ${count ?? 0} items upserted.`))
          .catch(err => console.error('orion sync failed:', err))
      );
      return;
    }

    if (event.cron === DAVIDSONS_SYNC_CRON) {
      ctx.waitUntil(
        runDavidsons(env)
          .then(count => console.log(`davidsons sync complete: ${count ?? 0} items upserted.`))
          .catch(err => console.error('davidsons sync failed:', err))
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
