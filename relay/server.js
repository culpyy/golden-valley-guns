// Static-IP relay for Lipsey's API calls. Cloudflare Workers don't have a
// fixed outbound IPv4 address (confirmed 2026-07-18 - even forcing an
// IPv4-only target, the Worker's egress came back IPv6 and unguaranteed to
// stay constant), and Lipsey's API access request requires a real IPv4 to
// whitelist. This runs on a box with a real static IP instead (Oracle Cloud
// Always Free VM) and does nothing but forward requests to api.lipseys.com,
// so sync/lipseys.js talks to this box's fixed IP instead of Lipsey's
// directly. Zero dependencies on purpose - Node 18+'s built-in fetch/http are
// enough, no npm install needed on the VM.
//
// Requires TLS in front of this (Caddy, see Caddyfile) - this process itself
// only speaks plain HTTP on localhost, terminating TLS here would mean
// juggling certs in Node for no benefit.
//
// Env vars:
//   PORT                - defaults to 8787
//   RELAY_SHARED_SECRET - required. Requests must send this as the
//                         X-Relay-Secret header, or they're rejected. Without
//                         this, anyone who finds the relay's IP could use it
//                         as an open proxy to Lipsey's API.

import http from 'node:http';

const PORT = process.env.PORT || 8787;
const SECRET = process.env.RELAY_SHARED_SECRET;
if (!SECRET) {
  console.error('RELAY_SHARED_SECRET is not set - refusing to start.');
  process.exit(1);
}

const LIPSEYS_BASE = 'https://api.lipseys.com';

// Only Lipsey's own API prefix is forwardable - this is a dedicated relay
// for one distributor's API, not a general-purpose open proxy.
function isAllowedPath(path) {
  return path.startsWith('/api/Integration/');
}

const server = http.createServer(async (req, res) => {
  if (req.headers['x-relay-secret'] !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (!isAllowedPath(req.url)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(`${LIPSEYS_BASE}${req.url}`, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        ...(req.headers['token'] ? { Token: req.headers['token'] } : {})
      },
      body: body && req.method !== 'GET' ? body : undefined
    });

    const responseBody = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(responseBody);
  } catch (err) {
    console.error('Relay fetch to Lipsey\'s failed:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request to Lipsey\'s failed' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lipsey's relay listening on 127.0.0.1:${PORT}`);
});
