-- Fixes a real race condition found via burst-testing checkout
-- (2026-07-20): the old flow checked `quantity >= qty` with a plain SELECT,
-- then charged the card, then decremented afterward. Under real concurrency
-- that check-then-act gap means multiple simultaneous requests can all read
-- the same pre-decrement quantity and all pass the check - confirmed live
-- with 8 concurrent requests against a 3-unit item, all 8 passed the stock
-- check (would have oversold 5 units and charged 8 real cards had the
-- payment tokens been real). Run in the Supabase SQL editor.
--
-- The fix: reserve stock atomically BEFORE charging, using a single SQL
-- UPDATE with the quantity check baked into the WHERE clause. Postgres
-- guarantees row-level atomicity for this - two concurrent UPDATEs against
-- the same row genuinely serialize (one waits for the other's row lock),
-- so only requests that the real remaining quantity can support ever
-- succeed. This is the standard pattern for this problem; the previous
-- "read then check then write" approach can never be made safe under
-- concurrency no matter how small the gap is narrowed.
--
-- Written as plain `language sql` single-statement functions (rather than
-- plpgsql with declare/begin/end) deliberately - no other reason than that
-- form is short enough to paste into a browser SQL editor without the
-- multi-line body getting mangled in transit.

create or replace function reserve_product_stock(p_id text, p_qty int) returns boolean language sql as $$ update products set quantity = quantity - p_qty, stock = case when quantity - p_qty <= 0 then 'out' else stock end where id = p_id and quantity >= p_qty returning true; $$;

create or replace function release_product_stock(p_id text, p_qty int) returns boolean language sql as $$ update products set quantity = quantity + p_qty, stock = case when quantity + p_qty > 0 and stock = 'out' then 'in_stock' else stock end where id = p_id returning true; $$;

revoke execute on function reserve_product_stock(text, int) from anon, authenticated;

revoke execute on function release_product_stock(text, int) from anon, authenticated;
