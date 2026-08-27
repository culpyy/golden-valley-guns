// Applied to every response, static pages and API routes alike. The CSP
// here is looser than ideal on script-src/style-src ('unsafe-inline') - this
// site has no bundler and every page's actual logic lives in inline
// <script> tags, with inline style="" attributes used throughout too.
// Rewriting that to a nonce-based CSP would mean touching every HTML file
// and having the Worker rewrite each response to inject matching nonces -
// too large a change to make safely in one pass. What this still buys:
// no arbitrary external script/connect/frame origin can be loaded even if
// something were injected, only the specific domains the site actually
// uses (Supabase, Authorize.net's Accept.js, Google Fonts). Formspree isn't
// in this list - the contact form moved to POST /api/contact on 2026-07-19
// and this allowlist was cleaned up to match on 2026-07-20.
const CSP = [
  "default-src 'self'",
  // *.authorize.net (not just js./jstest.) on purpose - Accept.js's own
  // dispatchData() call reaches out to api2.authorize.net internally to
  // tokenize the card, which isn't visible anywhere in our own source and
  // isn't documented. Learned the hard way 2026-07-18: checkout hung on
  // "Processing..." forever because that connection was silently CSP-
  // blocked, no error ever surfaced. Wildcarding the whole subdomain avoids
  // playing whack-a-mole with whichever numbered endpoint they load-balance
  // to next.
  // static.cloudflareinsights.com is the Web Analytics beacon Cloudflare
  // auto-injects into every HTML response at the edge (turned on in the
  // dashboard, not in this repo's own code) - without it in script-src the
  // beacon script itself is CSP-blocked before it can even run.
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://*.authorize.net https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // blob: needed for admin-dashboard.html's pre-upload photo previews
  // (URL.createObjectURL on a picked file, before it's actually uploaded) -
  // without it the browser silently drops the preview <img> with no JS-
  // catchable error, just a broken-image icon. Same origin either way,
  // since blob: URLs are only ever created by our own inline scripts.
  "img-src 'self' data: blob: https:",
  // cloudflareinsights.com (no static. prefix) is where the beacon script
  // above actually reports each pageview to - script-src only allows
  // loading the script itself, connect-src is separately required for the
  // beacon's own fetch/beacon call or it's blocked just as silently.
  "connect-src 'self' https://tyqgvpiunplgqzkygnii.supabase.co https://*.authorize.net https://cloudflareinsights.com",
  "frame-src https://*.authorize.net",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

export function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(self)');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
