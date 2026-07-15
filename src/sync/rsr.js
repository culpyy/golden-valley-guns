// NOT YET IMPLEMENTED — scaffold only. Follows the exact same shape as
// sync/lipseys.js (see that file for the full pattern: auth, fetch, allow-list
// filter via lib/catalogSync, upsert into distributor_products).
//
// RSR Group offers both a REST API and an FTP feed. Once Shawn's RSR dealer
// account is active, log into rsrgroup.com, pull the real API docs/credentials
// from the dealer portal, and fill in login()/fetchCatalog()/normalize() below
// the same way sync/lipseys.js does. Do not guess at endpoint URLs or field
// names here — confirm them against a real authenticated response first.
//
// Expected secrets (names TBD until real API docs are in hand — placeholders
// below), set with `wrangler secret put NAME`:
//   RSR_USERNAME
//   RSR_PASSWORD
//   RSR_API_KEY

export async function run() {
  console.log('RSR sync skipped: not yet implemented. See comments in src/sync/rsr.js.');
  return 0;
}
