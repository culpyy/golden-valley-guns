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
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://*.authorize.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://tyqgvpiunplgqzkygnii.supabase.co https://*.authorize.net",
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
