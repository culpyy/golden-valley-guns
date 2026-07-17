// Public-safe Authorize.net config for Accept.js (client-side card
// tokenization) - the API Login ID and Client (public) Key are both meant to
// be embedded in browser JS, same as js/supabase.js's anon key. This is NOT
// the Transaction Key, which stays a server-only secret (see
// src/lib/authorizeNet.js) and must never appear here.
//
// PLACEHOLDERS - checkout will not work until these are replaced. Get real
// values once Shawn has an Authorize.net merchant account:
//   Account > Settings > Security Settings > API Credentials & Keys
//     -> API Login ID            (same value as AUTHORIZENET_API_LOGIN_ID secret)
//     -> "Manage Public Client Key" -> Client Key (Accept.js-specific, NOT the Transaction Key)
// Keep AUTHORIZENET_ENVIRONMENT here in sync with the same-named var in wrangler.jsonc.

const AUTHORIZENET_ENVIRONMENT = 'production'; // 'sandbox' | 'production' - keep in sync with wrangler.jsonc
const AUTHORIZENET_API_LOGIN_ID = '4TtBp36JF9';
const AUTHORIZENET_CLIENT_KEY = 'REPLACE_WITH_PUBLIC_CLIENT_KEY';
