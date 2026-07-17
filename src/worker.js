import { run as runLipseys } from './sync/lipseys.js';
import { run as runRsr } from './sync/rsr.js';
import { run as runDavidsons } from './sync/davidsons.js';
import { run as runOrion } from './sync/orion.js';
import { handleCheckout } from './api/checkout.js';

const SYNC_JOBS = [
  ['lipseys', runLipseys],
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
