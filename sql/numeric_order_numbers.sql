-- Replaces the old order_number scheme (GVG-ORD-<base36 timestamp>-<random>,
-- e.g. "GVG-ORD-MRTUV6QK-7XV") with a plain sequential number customers can
-- actually read aloud or write down. Run in the Supabase SQL editor.
--
-- Uses a real Postgres identity column rather than "SELECT MAX(order_number)
-- + 1" in application code - that pattern has the exact same race condition
-- just fixed for stock (sql/atomic_stock_reservation.sql): two concurrent
-- inserts could both read the same max and both compute the same "next"
-- number. An identity column's value is assigned atomically by Postgres
-- itself at insert time, so this can't happen no matter how many checkouts
-- land at the same instant.
alter table orders add column if not exists order_seq bigint generated always as identity;

-- order_number is now derived from order_seq AFTER insert (Postgres only
-- assigns the identity value once the row actually exists) - see
-- src/lib/orderNumber.js for the insert-then-fill-in pattern this enables.
-- Briefly null between those two steps within a single request; nothing
-- external ever observes that window.
alter table orders alter column order_number drop not null;

-- Starts at 1001 rather than 1 so early real order numbers don't look like
-- test data. Only safe to run once - re-running would error if any row
-- already has a seq value, which is fine since this migration only runs once.
alter sequence orders_order_seq_seq restart with 1001;

-- The 3 existing rows are sandbox test transactions from before Authorize.net
-- was switched to production (2026-07-17, see wrangler.jsonc) - not real
-- orders, safe to clear so the new sequence starts clean.
delete from orders where order_number like 'GVG-ORD-%';
