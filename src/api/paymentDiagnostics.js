// GET /api/admin/payment-diagnostics - a read-mostly health check for the
// Authorize.net integration, gated behind its own standalone secret
// (DIAGNOSTICS_TOKEN) rather than the Supabase-admin-session check the other
// /api/admin/* routes use (see src/lib/adminAuth.js) - this needs to be
// callable from a plain curl/script without a logged-in browser session.
//
// Runs three checks against Authorize.net's real production servers, using
// the exact credentials/endpoint the live checkout flow uses:
//   1. authenticateTestRequest - are the API Login ID / Transaction Key valid?
//   2. getMerchantDetailsRequest - what's the account's actual configuration
//      (test mode, enabled payment methods, processors)?
//   3. A transactionSettings.testRequest=true charge - does a full
//      createTransactionRequest (same shape chargeCreditCard() sends) get
//      accepted by their servers? This never actually authorizes or settles
//      a real charge, regardless of whether Transaction Processing Mode is
//      enabled on the account yet - see src/lib/authorizeNet.js for details.
//
// Never touches Supabase, never writes an order, never charges a real card.
// Safe to leave in place and re-run anytime account status needs rechecking.

import { testAuthentication, getMerchantDetails, runDiagnosticTestCharge, getUnsettledTransactions, getRecentSettledTransactions } from '../lib/authorizeNet.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handlePaymentDiagnostics(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.DIAGNOSTICS_TOKEN || token !== env.DIAGNOSTICS_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  if (url.searchParams.has('transactions')) {
    const results = {};
    try {
      results.unsettled = await getUnsettledTransactions(env);
    } catch (err) {
      results.unsettled = { error: String(err?.message || err) };
    }
    try {
      results.settled = await getRecentSettledTransactions(env, { days: 5 });
    } catch (err) {
      results.settled = { error: String(err?.message || err) };
    }
    return jsonResponse(results);
  }

  const results = { environment: env.AUTHORIZENET_ENVIRONMENT || 'sandbox' };

  try {
    results.credentials = await testAuthentication(env);
  } catch (err) {
    results.credentials = { error: String(err?.message || err) };
  }

  try {
    results.merchantDetails = await getMerchantDetails(env);
  } catch (err) {
    results.merchantDetails = { error: String(err?.message || err) };
  }

  try {
    results.testTransaction = await runDiagnosticTestCharge(env, { amount: 1.00 });
  } catch (err) {
    results.testTransaction = { error: String(err?.message || err) };
  }

  return jsonResponse(results);
}
