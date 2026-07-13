// NOT YET IMPLEMENTED — scaffold only. Follows the exact same shape as
// sync-lipseys.js (see that file for the full pattern: auth, fetch, allow-list
// filter via _lib/catalogSync, upsert into distributor_products).
//
// RSR Group offers both a REST API and an FTP feed. Once Shawn's RSR dealer
// account is active, log into rsrgroup.com, pull the real API docs/credentials
// from the dealer portal, and fill in login()/fetchCatalog()/normalize() below
// the same way sync-lipseys.js does. Do not guess at endpoint URLs or field
// names here — confirm them against a real authenticated response first.
//
// Expected Netlify environment variables (names TBD until real API docs are
// in hand — placeholders below):
//   RSR_USERNAME
//   RSR_PASSWORD
//   RSR_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { schedule } = require('@netlify/functions');

exports.handler = schedule('0 8 * * *', async () => {
  console.log('RSR sync skipped: not yet implemented. See comments in netlify/functions/sync-rsr.js.');
  return { statusCode: 200, body: 'RSR sync not yet implemented.' };
});
