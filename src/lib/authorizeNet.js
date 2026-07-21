// Server-side Authorize.net Transaction API client. Card data itself never
// touches this Worker - checkout.html's Accept.js tokenizes the card in the
// browser into an opaque data blob (dataDescriptor/dataValue), and this file
// only ever sees that blob plus the amount/order info, then submits it to
// Authorize.net's createTransactionRequest endpoint using the account's
// secret Transaction Key. Keeping raw card numbers off this server entirely
// is what keeps PCI scope small (SAQ A rather than SAQ D).
//
// Required secrets/vars (see wrangler.jsonc for non-secret vars, use
// `wrangler secret put NAME` for the rest):
//   AUTHORIZENET_API_LOGIN_ID    - Account > Settings > Security Settings > API Credentials & Keys (secret, though also embedded client-side - see js/checkout-config.js)
//   AUTHORIZENET_TRANSACTION_KEY - generated alongside the API Login ID on the same page (secret, NEVER exposed client-side)
//   AUTHORIZENET_ENVIRONMENT     - already set as a plain var in wrangler.jsonc ("sandbox" or "production")
//
// NOT YET TESTED against a live account - Shawn doesn't have an Authorize.net
// merchant account set up yet. This mirrors the shape of Authorize.net's
// documented createTransactionRequest/JSON API; verify field names against a
// real sandbox response the same way lipseys.js was corrected after its first
// live test (see that file's header comment for the pattern to follow).

const ENDPOINTS = {
  sandbox: 'https://apitest.authorize.net/xml/v1/request.api',
  production: 'https://api.authorize.net/xml/v1/request.api'
};

function endpointFor(env) {
  const mode = env.AUTHORIZENET_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  return ENDPOINTS[mode];
}

// Authorize.net's JSON API sometimes prefixes the response body with a UTF-8
// BOM, which breaks a plain JSON.parse - strip it defensively before parsing.
async function parseAuthNetResponse(res) {
  const text = await res.text();
  return JSON.parse(text.replace(/^﻿/, ''));
}

// items: [{ id, name, price, qty }] - already re-priced/verified against
// Supabase by the caller (src/api/checkout.js), never trust client totals.
export async function chargeCreditCard(env, { opaqueData, amount, orderNumber, items, customer }) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }

  const body = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
      },
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: amount.toFixed(2),
        payment: { opaqueData },
        order: {
          invoiceNumber: orderNumber,
          description: items.map(i => `${i.qty}x ${i.name}`).join(', ').slice(0, 255)
        },
        lineItems: {
          lineItem: items.slice(0, 30).map(i => ({
            itemId: String(i.id).slice(0, 31),
            name: i.name.slice(0, 31),
            quantity: i.qty,
            unitPrice: i.price.toFixed(2)
          }))
        },
        customer: { email: customer.email },
        billTo: {
          firstName: customer.firstName,
          lastName: customer.lastName
        }
      }
    }
  };

  const res = await fetch(endpointFor(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Authorize.net request failed: ${res.status}`);

  const data = await parseAuthNetResponse(res);
  const txn = data.transactionResponse;
  // responseCode "1" = approved, "2" = declined, "3" = error, "4" = held for review.
  // messages.resultCode is the outer envelope status - can be "Error" even when
  // transactionResponse itself is missing entirely (e.g. bad auth credentials).
  const approved = data.messages?.resultCode === 'Ok' && txn?.responseCode === '1';

  return {
    approved,
    transactionId: txn?.transId || null,
    authCode: txn?.authCode || null,
    responseCode: txn?.responseCode || null,
    errorText: approved
      ? null
      : (txn?.errors?.[0]?.errorText || data.messages?.message?.[0]?.text || 'Payment declined.'),
    raw: data
  };
}

// Refunds a transaction by ID - no card number required (we never store
// one, by design, to keep PCI scope small - see the file header).
//
// Authorize.net normally rejects refundTransaction on a transaction that
// hasn't settled yet (settlement runs once daily) with "does not meet the
// criteria for issuing a credit" - the standard workaround is to attempt a
// void first and fall back to a credit if that fails. That fallback is
// deliberately NOT implemented here: Authorize.net's own documented
// behavior is that when the refund amount is the ENTIRE original amount
// (never partial - src/api/refundOrder.js only ever offers full refunds),
// it automatically converts an unsettled refund into a void internally.
// Since amount is always the full original total here, that auto-handling
// covers both the settled and unsettled case with no extra logic needed -
// this is a direct consequence of full-refund-only being the only mode
// this function is ever called in, not an oversight. If partial refunds
// are ever added, this reasoning no longer holds and a void-first fallback
// would need to be added.
//
// NOT YET TESTED against a live account, same caveat as chargeCreditCard
// above - Shawn's Authorize.net merchant account has Transaction Processing
// Mode "Not enabled" as of 2026-07-18, so there's no way to exercise this
// against a real transaction yet. Verify against a real response the same
// way lipseys.js's fields were corrected after its first live call, once
// that's possible - in particular, confirm the auto-void-on-unsettled
// behavior described above actually holds for a same-day refund attempt.
export async function refundTransaction(env, { transactionId, amount }) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }

  const body = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
      },
      transactionRequest: {
        transactionType: 'refundTransaction',
        amount: amount.toFixed(2),
        refTransId: transactionId
      }
    }
  };

  const res = await fetch(endpointFor(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Authorize.net request failed: ${res.status}`);

  const data = await parseAuthNetResponse(res);
  const txn = data.transactionResponse;
  const approved = data.messages?.resultCode === 'Ok' && txn?.responseCode === '1';

  return {
    approved,
    transactionId: txn?.transId || null,
    errorText: approved
      ? null
      : (txn?.errors?.[0]?.errorText || data.messages?.message?.[0]?.text || 'Refund failed.'),
    raw: data
  };
}
