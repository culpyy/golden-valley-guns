import { run as runRsr } from './sync/rsr.js';
import { run as runDavidsons } from './sync/davidsons.js';
import { run as runOrion } from './sync/orion.js';
import { handleCheckout } from './api/checkout.js';

// Lipsey's sync is PAUSED as of 2026-07-17 - their API docs require Domains
// And IP Addresses to be pre-approved before use (not done for this custom
// integration, we're not going through one of their Preferred Partners).
// Submitted the API Access Request form (NOT via a preferred partner) with
// this domain + relay/'s static IP on 2026-07-18, waiting on approval.
// Image hotlinking (their other explicit rule - do not hotlink lipseyscloud.com)
// is already fixed: sync/lipseys.js now downloads to our own R2 bucket, see
// src/lib/imageCache.js and the /distributor-images route below.
// Re-add 'lipseys' to SYNC_JOBS once the access request is approved. See
// sql/distributor_catalog.sql for the matching anon-access revoke to reverse too.
const SYNC_JOBS = [
  ['rsr', runRsr],
  ['davidsons', runDavidsons],
  ['orion', runOrion],
];

export default {
  async fetch(request, env) {
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
  },

  async scheduled(event, env, ctx) {
    for (const [name, run] of SYNC_JOBS) {
      ctx.waitUntil(
        run(env)
          .then(count => console.log(`${name} sync complete: ${count ?? 0} items upserted.`))
          .catch(err => console.error(`${name} sync failed:`, err))
      );
    }
  },
};
