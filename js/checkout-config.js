// Public-safe Authorize.net config for Accept.js (client-side card
// tokenization) - the API Login ID and Client (public) Key are both meant to
// be embedded in browser JS, same as js/supabase.js's anon key. This is NOT
// the Transaction Key, which stays a server-only secret (see
// src/lib/authorizeNet.js) and must never appear here.
//
// Real values set 2026-07-18 from Account > Settings > Security Settings >
// API Credentials & Keys. Keep AUTHORIZENET_ENVIRONMENT here in sync with
// the same-named var in wrangler.jsonc.

const AUTHORIZENET_ENVIRONMENT = 'production'; // 'sandbox' | 'production' - keep in sync with wrangler.jsonc
const AUTHORIZENET_API_LOGIN_ID = '4TtBp36JF9';
const AUTHORIZENET_CLIENT_KEY = '4S3nzJC5Ed362vnZgCyFfZj24A5hBHB4NGL866pEbnqSH8SZhcRq8NmZf8e9DV76';
