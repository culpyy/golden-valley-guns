// NOT YET IMPLEMENTED — scaffold only. Follows the exact same shape as
// sync-lipseys.js (see that file for the full pattern: auth, fetch, allow-list
// filter via _lib/catalogSync, upsert into distributor_products).
//
// Orion Wholesale (orionfflsales.com) exposes an API at /api.php, but the
// documented usage seen during research was for order submission
// (a `send_po` method), not confirmed for catalog/inventory reads. Once
// Shawn's Orion dealer account is active, log into orionfflsales.com's dealer
// portal to find the real catalog-feed endpoint and auth scheme before writing
// login()/fetchCatalog()/normalize() here — don't assume /api.php covers
// catalog reads without checking.
//
// Expected Netlify environment variables (placeholders — confirm real values
// from Orion's dealer portal once the account is active):
//   ORION_API_KEY
//   ORION_ACCOUNT_ID
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { schedule } = require('@netlify/functions');

exports.handler = schedule('0 8 * * *', async () => {
  console.log('Orion sync skipped: not yet implemented. See comments in netlify/functions/sync-orion.js.');
  return { statusCode: 200, body: 'Orion sync not yet implemented.' };
});
