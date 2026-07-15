// NOT YET IMPLEMENTED — scaffold only. Follows the exact same shape as
// sync/lipseys.js (see that file for the full pattern: auth, fetch, allow-list
// filter via lib/catalogSync, upsert into distributor_products).
//
// Davidson's/Gallery of Guns is primarily an FTP catalog drop rather than a
// REST API. Cloudflare Workers has no built-in FTP client and no raw TCP
// sockets for passive-mode FTP, so this will likely need to be fetched a
// different way than the other three (e.g. Davidson's may offer an HTTPS
// download link for the same feed — check the dealer portal once the account
// is active — or this job may need to live somewhere other than a Worker).
//
// Expected secrets (placeholders — confirm real values from Davidson's dealer
// portal once the account is active), set with `wrangler secret put NAME`:
//   DAVIDSONS_FTP_HOST
//   DAVIDSONS_FTP_USER
//   DAVIDSONS_FTP_PASSWORD
//   DAVIDSONS_FTP_PATH

export async function run() {
  console.log("Davidson's sync skipped: not yet implemented. See comments in src/sync/davidsons.js.");
  return 0;
}
