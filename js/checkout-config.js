// Public-safe Authorize.net config for Accept.js (client-side card
// tokenization) - the API Login ID and Client (public) Key are both meant to
// be embedded in browser JS, same as js/supabase.js's anon key. This is NOT
// the Transaction Key, which stays a server-only secret (see
// src/lib/authorizeNet.js) and must never appear here.
//
// Real values set 2026-09-10 from Account > Settings > Security Settings >
// API Credentials & Keys, on the Payroc-linked Authorize.net gateway. Keep
// AUTHORIZENET_ENVIRONMENT here in sync with the same-named var in
// wrangler.jsonc.

const AUTHORIZENET_ENVIRONMENT = 'production'; // 'sandbox' | 'production' - keep in sync with wrangler.jsonc
const AUTHORIZENET_API_LOGIN_ID = '96hzbKEEw6G';
const AUTHORIZENET_CLIENT_KEY = '9H8U57P2fJpnDFRqPPY94fFh2g4eVg3cX4nVDkxxr79nk8uDbz9aTzB8va4574Tc';
