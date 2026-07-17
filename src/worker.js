import { run as runRsr } from './sync/rsr.js';
import { run as runDavidsons } from './sync/davidsons.js';
import { run as runOrion } from './sync/orion.js';
import { handleCheckout } from './api/checkout.js';

// Lipsey's sync is PAUSED as of 2026-07-17 - their API docs require Domains
// And IP Addresses to be pre-approved before use (not done for this custom
// integration, we're not going through one of their Preferred Partners), and
// separately their docs explicitly say not to hotlink product images from
// lipseyscloud.com, which sync/lipseys.js was doing. Re-enable only after:
//   1. Submitting the API Access Request form (NOT integrating with a
//      preferred partner) with this domain + a real outbound IP
//   2. Fixing image hosting so synced photos are downloaded to our own
//      storage instead of hotlinked from lipseyscloud.com
// See sql/distributor_catalog.sql for the matching anon-access revoke.
const SYNC_JOBS = [
  ['rsr', runRsr],
  ['davidsons', runDavidsons],
  ['orion', runOrion],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
