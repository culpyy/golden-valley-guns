// Applied to every response, static pages and API routes alike. The CSP
// here is looser than ideal on script-src/style-src ('unsafe-inline') - this
// site has no bundler and every page's actual logic lives in inline
// <script> tags, with inline style="" attributes used throughout too.
// Rewriting that to a nonce-based CSP would mean touching every HTML file
// and having the Worker rewrite each response to inject matching nonces -
// too large a change to make safely in one pass. What this still buys:
// no arbitrary external script/connect/frame origin can be loaded even if
// something were injected, only the specific domains the site actually
// uses (Supabase, Authorize.net's Accept.js, Formspree, Google Fonts).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://js.authorize.net https://jstest.authorize.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://tyqgvpiunplgqzkygnii.supabase.co https://formspree.io https://api.authorize.net https://apitest.authorize.net https://js.authorize.net https://jstest.authorize.net",
  "frame-src https://js.authorize.net https://jstest.authorize.net",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://formspree.io"
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
