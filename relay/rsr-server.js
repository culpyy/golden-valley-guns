// FTP-to-HTTP bridge for RSR Group's dealer inventory feed. Cloudflare
// Workers have no FTP client (only HTTP/TCP-socket primitives), and
// rsrgroup.com's Dealer's Toolbox only offers this data via a real FTP
// server (ftp.rsrgroup.com, confirmed via RSR's own Dealer's Toolbox >
// Available Downloads page 2026-09-08 - unlike Davidson's, which turned out
// to be plain HTTPS despite an initial FTP assumption, RSR really is FTP).
// This runs on the same Oracle Cloud box as the Lipsey's relay (see
// server.js) and does nothing but open an FTP connection, download one file,
// and stream it back over HTTPS.
//
// Deliberately credential-agnostic, same reasoning as the Lipsey's relay:
// the FTP username/password live as Cloudflare Worker secrets
// (RSR_FTP_USERNAME/RSR_FTP_PASSWORD) - the single source of truth - and are
// forwarded per-request via X-FTP-User/X-FTP-Pass headers rather than
// duplicated into a second copy on this VM, which would just create a
// second thing to remember to rotate.
//
// Requires the `basic-ftp` package (npm install basic-ftp in this
// directory) - the one real dependency exception to the Lipsey's relay's
// "zero dependencies" rule, since Node has no built-in FTP client the way it
// has built-in fetch/http for a plain HTTPS relay.
//
// Env vars:
//   PORT                - defaults to 8788 (8787 is the Lipsey's relay)
//   RELAY_SHARED_SECRET - required, checked against X-Relay-Secret

import http from 'node:http';
import { Client } from 'basic-ftp';

const PORT = process.env.PORT || 8788;
const SECRET = process.env.RELAY_SHARED_SECRET;
if (!SECRET) {
  console.error('RELAY_SHARED_SECRET is not set - refusing to start.');
  process.exit(1);
}

// RSR's own "FTP Access request" reply (2026-09-08) specifies ftps.rsrgroup.com,
// port 2222, explicit FTP over TLS - NOT plain ftp.rsrgroup.com:21 as first
// assumed from the Dealer's Toolbox docs page. Passive data-port range per the
// same reply is 64000-65535; that's a server-side PASV response, nothing to
// configure client-side, but it does mean the relay VM's outbound egress needs
// to allow that range (inbound iptables was locked to 22/80/443 per the
// Lipsey's relay hardening pass - shouldn't matter since this is outbound, but
// worth checking first if connections hang instead of erroring outright).
const RSR_FTP_HOST = 'ftps.rsrgroup.com';
const RSR_FTP_PORT = 2222;

// Narrow allowlist of real RSR filenames (see rsrgroup.com/dealers-toolbox/
// inventory-file-layout) - defense in depth on top of the shared secret,
// same reasoning as the Lipsey's relay's isAllowedPath. Not an open FTP proxy.
const ALLOWED_FILES = new Set([
  'rsrinventory-new.txt',
  'fulfillment-inv-new.txt',
  'rsrdeletedinv-new.txt',
  'rsr-ship-restrictions.txt'
]);

const server = http.createServer(async (req, res) => {
  if (req.headers['x-relay-secret'] !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/rsr-file') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const file = url.searchParams.get('file');
  if (!file || !ALLOWED_FILES.has(file)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `file must be one of: ${[...ALLOWED_FILES].join(', ')}` }));
    return;
  }

  const ftpUser = req.headers['x-ftp-user'];
  const ftpPass = req.headers['x-ftp-pass'];
  if (!ftpUser || !ftpPass) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'X-FTP-User and X-FTP-Pass headers are required' }));
    return;
  }

  const client = new Client(30000);
  try {
    await client.access({ host: RSR_FTP_HOST, port: RSR_FTP_PORT, user: ftpUser, password: ftpPass, secure: true });
    // Inventory files live in /ftpdownloads per RSR's own "FTP Access
    // request" reply email (2026-09-08) - cd here (before headers are sent)
    // so a wrong/moved path surfaces as a normal 502 instead of silently
    // truncating an already-200'd response.
    await client.cd('ftpdownloads');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    // downloadTo accepts any Writable, including the raw HTTP response -
    // streams straight through rather than buffering the whole file (main
    // inventory file runs several MB) in this process's memory first.
    await client.downloadTo(res, file);
    res.end();
  } catch (err) {
    console.error('RSR FTP fetch failed:', err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `RSR FTP fetch failed: ${err.message}` }));
    } else {
      res.end();
    }
  } finally {
    client.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`RSR relay listening on 127.0.0.1:${PORT}`);
});
