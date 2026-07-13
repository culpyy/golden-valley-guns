// NOT YET IMPLEMENTED — scaffold only. Follows the exact same shape as
// sync-lipseys.js (see that file for the full pattern: auth, fetch, allow-list
// filter via _lib/catalogSync, upsert into distributor_products).
//
// Davidson's/Gallery of Guns is primarily an FTP catalog drop rather than a
// REST API. Once Shawn's Davidson's dealer account is active, this will need
// an FTP client (e.g. `basic-ftp` — add it to package.json) to download and
// parse the feed instead of a fetch() call, roughly:
//
//   const ftp = require('basic-ftp');
//   const client = new ftp.Client();
//   await client.access({ host, user, password, secure: true });
//   await client.downloadTo('/tmp/davidsons-feed.csv', DAVIDSONS_FTP_PATH);
//   // then parse the CSV/XML into the same normalize() shape sync-lipseys.js uses
//
// Expected Netlify environment variables (placeholders — confirm real values
// from Davidson's dealer portal once the account is active):
//   DAVIDSONS_FTP_HOST
//   DAVIDSONS_FTP_USER
//   DAVIDSONS_FTP_PASSWORD
//   DAVIDSONS_FTP_PATH
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { schedule } = require('@netlify/functions');

exports.handler = schedule('0 8 * * *', async () => {
  console.log("Davidson's sync skipped: not yet implemented. See comments in netlify/functions/sync-davidsons.js.");
  return { statusCode: 200, body: "Davidson's sync not yet implemented." };
});
