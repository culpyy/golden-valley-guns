-- Adds real inventory tracking to Shawn's own products (was purely a
-- 'stock' status string before - no actual count to decrement, so a sale
-- could never reduce availability). Run in the Supabase SQL editor.
--
-- Table is empty right now (no products added yet), so this is a
-- zero-risk column add - no backfill needed.
alter table products add column if not exists quantity integer not null default 0;

-- Documentation reconciliation (2026-07-20 full-site audit): confirmed live
-- via a real anon-key REST query that products already grants public
-- select, same as it must for shop.html to work for anonymous visitors -
-- but no tracked migration file ever actually created that policy (same
-- class of drift as orders' original RLS policy, found earlier - it exists
-- live, just was never captured in source). Harmless to (re-)run even if a
-- differently-named equivalent already exists - Postgres OR's multiple
-- permissive policies together for the same operation, it doesn't error or
-- conflict.
drop policy if exists "Public read products" on products;
create policy "Public read products"
  on products for select
  to anon, authenticated
  using (true);
