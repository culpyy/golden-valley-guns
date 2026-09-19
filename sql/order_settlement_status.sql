-- Order settlement status (2026-09-18). Run in the Supabase SQL editor.
--
-- orders.status = 'paid' already means Authorize.net approved the charge in
-- real time (src/api/checkout.js only sets it when chargeCreditCard()'s
-- result.approved is true) - that part was never actually in question. The
-- real remaining gap is settlement: an authCaptureTransaction auto-settles
-- in Authorize.net's nightly batch, but "approved" and "actually settled
-- into the account" are two different facts, and nothing here ever checked
-- the second one. src/lib/settlementCheck.js + a daily cron
-- (SETTLEMENT_CHECK_CRON in src/worker.js) now calls Authorize.net's own
-- getTransactionDetailsRequest for every paid order and records its real
-- transactionStatus here, so "did this actually hit the account" stops
-- being a guess.

alter table orders add column if not exists settlement_status text; -- null until checked, then 'settled' | 'pending' | 'failed' | 'unknown'
alter table orders add column if not exists settlement_checked_at timestamptz;
alter table orders add column if not exists settlement_detail text; -- raw Authorize.net transactionStatus string
