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
// one, by design, to keep PCI scope small - see the file header). See the
// refundTransaction function below for how the unsettled-transaction case
// (error code 54) is actually handled - confirmed live 2026-08-05.
// --- Diagnostics only, below this line --------------------------------
// Used exclusively by src/api/paymentDiagnostics.js (an admin-gated route)
// to verify the live integration is actually working after Shawn's
// merchant account gets approved for real transaction processing, without
// moving any real money or touching a real customer's card. Never called
// from the real checkout path (src/api/checkout.js) - that always tokenizes
// through Accept.js and never sees a raw card number, which these functions
// intentionally do (using Authorize.net's own published test PAN, never a
// real one) since there's no cart/browser involved in a server-side check.

// authenticateTestRequest - confirms the API Login ID + Transaction Key are
// valid and recognized by Authorize.net's servers. Doesn't touch payment
// processing at all, just credential validation - safe to call anytime.
export async function testAuthentication(env) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }
  const body = {
    authenticateTestRequest: {
      merchantAuthentication: {
        name: env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
      }
    }
  };
  const res = await fetch(endpointFor(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Authorize.net request failed: ${res.status}`);
  return parseAuthNetResponse(res);
}

// getMerchantDetailsRequest - returns account configuration, including
// whether the account is currently in Test Mode and which payment
// methods/processors are actually enabled. This is the closest thing
// Authorize.net's API has to "is my account actually live yet."
export async function getMerchantDetails(env) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }
  const body = {
    getMerchantDetailsRequest: {
      merchantAuthentication: {
        name: env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
      }
    }
  };
  const res = await fetch(endpointFor(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Authorize.net request failed: ${res.status}`);
  return parseAuthNetResponse(res);
}

// A createTransactionRequest flagged transactionSettings.testRequest=true -
// Authorize.net's documented mechanism for exercising the full transaction
// pipeline (auth, field validation, response shape) against a live account
// WITHOUT ever actually submitting the transaction for authorization or
// settlement, regardless of whether the account's own Transaction
// Processing Mode is enabled yet. Uses Authorize.net's own published test
// card number (4111111111111111) - never a real card. This is what proves
// the exact code path chargeCreditCard() uses (same request shape, same
// endpoint, same credentials) is actually accepted by their servers.
export async function runDiagnosticTestCharge(env, { amount = 1.00 } = {}) {
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
        payment: {
          creditCard: {
            cardNumber: '4111111111111111',
            expirationDate: '1230',
            cardCode: '123'
          }
        },
        order: {
          invoiceNumber: `DIAG-${Date.now()}`,
          description: 'Payment integration diagnostic - test request, never settled'
        },
        transactionSettings: {
          setting: [{ settingName: 'testRequest', settingValue: 'true' }]
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
  return {
    approved: data.messages?.resultCode === 'Ok' && txn?.responseCode === '1',
    responseCode: txn?.responseCode || null,
    authCode: txn?.authCode || null,
    messages: data.messages,
    transactionResponseErrors: txn?.errors || null,
    raw: data
  };
}

// getUnsettledTransactionListRequest - lists transactions authorized but not
// yet through a nightly settlement batch (no batch ID needed, unlike settled
// transactions). Diagnostics-only, read-only, safe to call anytime.
export async function getUnsettledTransactions(env) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }
  const body = {
    getUnsettledTransactionListRequest: {
      merchantAuthentication: {
        name: env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
      }
    }
  };
  const res = await fetch(endpointFor(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Authorize.net request failed: ${res.status}`);
  return parseAuthNetResponse(res);
}

// getSettledBatchListRequest - lists settlement batches in a date range, then
// getTransactionListRequest pulls the transactions within each. Together
// these cover transactions that have already gone through nightly
// settlement (getUnsettledTransactions above only covers pre-settlement).
export async function getRecentSettledTransactions(env, { days = 3 } = {}) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }
  const auth = {
    name: env.AUTHORIZENET_API_LOGIN_ID,
    transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
  };
  const lastDate = new Date().toISOString();
  const firstDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const batchRes = await fetch(endpointFor(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      getSettledBatchListRequest: {
        merchantAuthentication: auth,
        includeStatistics: true,
        firstSettlementDate: firstDate,
        lastSettlementDate: lastDate
      }
    })
  });
  if (!batchRes.ok) throw new Error(`Authorize.net request failed: ${batchRes.status}`);
  const batchData = await parseAuthNetResponse(batchRes);
  const batches = batchData.batchList || [];

  const transactions = [];
  for (const batch of batches) {
    const txnRes = await fetch(endpointFor(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        getTransactionListRequest: {
          merchantAuthentication: auth,
          batchId: batch.batchId
        }
      })
    });
    if (!txnRes.ok) continue;
    const txnData = await parseAuthNetResponse(txnRes);
    for (const t of (txnData.transactions || [])) {
      transactions.push({ ...t, batchId: batch.batchId, batchSettlementState: batch.settlementState });
    }
  }

  return { batches, transactions };
}

async function submitTransaction(env, transactionRequest) {
  const body = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: env.AUTHORIZENET_TRANSACTION_KEY
      },
      transactionRequest
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
    errorCode: txn?.errors?.[0]?.errorCode || null,
    errorText: approved
      ? null
      : (txn?.errors?.[0]?.errorText || data.messages?.message?.[0]?.text || 'Transaction failed.'),
    raw: data
  };
}

// Refunds a transaction by ID. Authorize.net rejects refundTransaction on a
// transaction that hasn't settled yet (settlement runs once daily) with
// error code 54, "The referenced transaction does not meet the criteria for
// issuing a credit" - confirmed live 2026-08-05 on a same-day charge (the
// header comment's original assumption that a full-amount refund
// auto-converts to a void internally was wrong). The standard fix is to
// fall back to voidTransaction in that specific case, which cancels the
// unsettled authorization instead of crediting a settled one - no card
// number needed for a void, just the original transaction ID.
export async function refundTransaction(env, { transactionId, amount, cardLast4 }) {
  if (!env.AUTHORIZENET_API_LOGIN_ID || !env.AUTHORIZENET_TRANSACTION_KEY) {
    throw new Error('Authorize.net is not configured yet - set AUTHORIZENET_API_LOGIN_ID and AUTHORIZENET_TRANSACTION_KEY (wrangler secret put).');
  }
  if (!cardLast4) {
    throw new Error('cardLast4 is required - Authorize.net rejects refundTransaction without it even when refTransId is provided.');
  }

  const result = await submitTransaction(env, {
    transactionType: 'refundTransaction',
    amount: amount.toFixed(2),
    payment: {
      creditCard: {
        cardNumber: cardLast4,
        expirationDate: 'XXXX'
      }
    },
    refTransId: transactionId
  });

  if (!result.approved && result.errorCode === '54') {
    return submitTransaction(env, {
      transactionType: 'voidTransaction',
      refTransId: transactionId
    });
  }

  return result;
}
