// Logs every card charge attempt (approved or declined) to payment_attempts
// - see sql/payment_attempts.sql for why this exists. orders.authorize_net_response
// only ever held the most recent attempt, silently erasing a real decline
// the moment a later retry succeeded (or failed differently). Called from
// both src/api/checkout.js and src/api/pay.js right after chargeCreditCard()
// returns, regardless of outcome.
import { getSupabaseAdmin } from './supabaseAdmin.js';

// Authorize.net's errorCode/cvvResultCode/avsResultCode are accurate but not
// written for a non-technical read - this turns the common, well-documented
// ones into something Shawn can actually relay to a customer on the phone.
// Anything not covered here falls back to Authorize.net's own errorText
// rather than guessing at a translation for a code we're not sure about.
export function plainReason({ errorCode, errorText, cvvResultCode, avsResultCode }) {
  if (errorCode === '11') {
    return "Duplicate transaction - the same card and amount were charged again within about 2 minutes of a prior attempt. This is Authorize.net's own anti-fraud protection, not a real decline. Tell the customer to wait a couple minutes and try again.";
  }
  if (errorCode === '6') {
    return "Invalid card number - likely mistyped. Ask the customer to double-check the number.";
  }
  if (errorCode === '7' || errorCode === '8') {
    return "Invalid or expired expiration date. Ask the customer to double-check their card's expiration.";
  }
  if (cvvResultCode === 'N') {
    return "Card's security code (CVV) didn't match what the issuing bank has on file. Confirmed 2026-09-18: this can happen when a password manager (e.g. 1Password) autofills the CVV field with a value that doesn't match what's actually typed, even on the right card - native browser/wallet autofill never touches this field at all, but third-party managers aren't bound by that. Ask the customer to type it manually rather than trust an autofill/keyboard suggestion.";
  }
  if (avsResultCode === 'N') {
    return "Billing address didn't match what the card issuer has on file. Ask the customer to confirm the billing address/ZIP tied to that card.";
  }
  if (errorCode === '44') {
    return "Declined by the card issuer without a more specific reason from Authorize.net. Have the customer confirm their card details are current, or try a different card.";
  }
  return errorText || 'Declined - no further detail available from Authorize.net.';
}

export async function logPaymentAttempt(env, { orderId, result }) {
  try {
    const supabase = getSupabaseAdmin(env);
    const txn = result.raw?.transactionResponse;
    const errorCode = txn?.errors?.[0]?.errorCode || null;
    const cvvResultCode = txn?.cvvResultCode || null;
    const avsResultCode = txn?.avsResultCode || null;
    await supabase.from('payment_attempts').insert({
      order_id: orderId,
      approved: result.approved,
      response_code: result.responseCode,
      error_code: errorCode,
      error_text: result.errorText,
      cvv_result_code: cvvResultCode,
      avs_result_code: avsResultCode,
      transaction_id: result.transactionId,
      plain_reason: result.approved ? null : plainReason({ errorCode, errorText: result.errorText, cvvResultCode, avsResultCode }),
      raw_response: result.raw
    });
  } catch (err) {
    // Best-effort, same posture as email_log's logging - a logging hiccup
    // must never mask the real charge outcome from the customer.
    console.error('payment_attempts insert failed (charge outcome itself is unaffected):', err);
  }
}
