// Checks every 'paid' order that hasn't been confirmed settled yet against
// Authorize.net's own getTransactionDetailsRequest and records the real
// outcome - see sql/order_settlement_status.sql for why this exists.
// "paid" in `orders` has only ever meant "Authorize.net approved the charge
// in real time" (src/api/checkout.js, src/api/pay.js); this is what
// confirms the money actually settled into the account rather than trusting
// that an authCaptureTransaction always makes it through the nightly batch
// cleanly. Called from a daily cron (src/worker.js) and also available
// on-demand via /api/admin/check-settlement.
import { getSupabaseAdmin } from './supabaseAdmin.js';
import { getTransactionDetails } from './authorizeNet.js';
import { sendEmail } from './email.js';

// Authorize.net's own transactionStatus values, collapsed into three
// buckets Shawn actually needs to act on differently:
//   settled - the money is really in the account, nothing to do.
//   pending - still working through the batch, check again later (the
//             cron will, on its own, since it only skips rows already
//             marked 'settled').
//   failed  - approved at charge time but did NOT actually settle - this
//             is the exact case "paid" alone would hide, and the one
//             worth a real alert.
const SETTLED = new Set(['settledSuccessfully']);
const PENDING = new Set(['capturedPendingSettlement', 'authorizedPendingCapture', 'underReview', 'FDSPendingReview', 'communicationError']);
const FAILED = new Set(['declined', 'expired', 'generalError', 'failedReview', 'settlementError', 'voided', 'couldNotVoid']);

function bucketFor(transactionStatus) {
  if (SETTLED.has(transactionStatus)) return 'settled';
  if (PENDING.has(transactionStatus)) return 'pending';
  if (FAILED.has(transactionStatus)) return 'failed';
  return 'unknown';
}

export async function checkOrderSettlement(env, order) {
  const supabase = getSupabaseAdmin(env);
  const { transactionStatus } = await getTransactionDetails(env, order.authorize_net_transaction_id);
  const settlement_status = bucketFor(transactionStatus);

  await supabase
    .from('orders')
    .update({
      settlement_status,
      settlement_checked_at: new Date().toISOString(),
      settlement_detail: transactionStatus
    })
    .eq('id', order.id);

  return { settlement_status, transactionStatus };
}

// Runs across every order still needing a check - paid, has a real
// transaction id, and either never checked or last seen still pending.
// Deliberately re-checks 'pending' every run (settlement can take up to a
// day or two to actually clear) but never re-checks 'settled'/'failed' -
// those are final states from Authorize.net's own perspective.
export async function syncPendingSettlements(env) {
  const supabase = getSupabaseAdmin(env);
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, authorize_net_transaction_id')
    .eq('status', 'paid')
    .not('authorize_net_transaction_id', 'is', null)
    .or('settlement_status.is.null,settlement_status.eq.pending');

  if (error) throw error;

  let settled = 0, pending = 0, failed = 0, errored = 0;
  const failedOrders = [];
  for (const order of orders || []) {
    try {
      const { settlement_status, transactionStatus } = await checkOrderSettlement(env, order);
      if (settlement_status === 'settled') settled++;
      else if (settlement_status === 'pending') pending++;
      else if (settlement_status === 'failed') {
        failed++;
        failedOrders.push({ orderNumber: order.order_number, transactionStatus });
        console.error(`Order ${order.order_number}: approved at checkout but did NOT settle (${order.authorize_net_transaction_id}) - needs a real look, not just a resend.`);
      }
    } catch (err) {
      errored++;
      console.error(`Settlement check failed for order ${order.order_number}:`, err);
    }
  }

  // A "paid" order that never actually settled is real money not landing
  // in the account despite looking done on the dashboard - the one case
  // worth an unprompted alert rather than waiting for someone to notice.
  if (failedOrders.length > 0) {
    try {
      await sendEmail(env, {
        subject: `${failedOrders.length} order(s) approved but did NOT settle`,
        text: [
          `These orders showed "Paid" but Authorize.net's own settlement status says otherwise - the charge was approved at checkout but never actually made it through the nightly batch into the account.`,
          ``,
          ...failedOrders.map(o => `Order #${o.orderNumber}: ${o.transactionStatus}`)
        ].join('\n'),
        source: 'settlement_failure_alert'
      });
    } catch (err) {
      console.error('Settlement failure alert email failed to send:', err);
    }
  }

  return { checked: (orders || []).length, settled, pending, failed, errored };
}
