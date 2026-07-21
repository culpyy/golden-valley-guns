-- Adds the missing admin-dashboard read/write access for orders and contact
-- submissions. Run in the Supabase SQL editor.
--
-- Until now, checkout (src/api/checkout.js) and the contact form
-- (src/api/contact.js) both wrote real data with nowhere for Shawn to see it
-- in admin-dashboard.html except a direct Supabase table browse. This wires
-- both into the dashboard properly.

-- 1) ORDERS
-- orders.sql originally granted select to any authenticated user (using
-- (true)) rather than is_admin() - the flow/security audit that added
-- is_admin() to builds/products/site_content (security_hardening.sql) missed
-- this table since it was created in a separate session. Reconciling it here
-- so orders follows the same admin-only pattern as everything else, and
-- adding the update policy the dashboard's status dropdown (e.g. marking a
-- refund) needs - there wasn't one before at all.
-- Drops cover both the original orders.sql name and the already-corrected
-- name (turned out "Admin read orders" already existed live even though
-- orders.sql's source was never updated to match - fixed here so this runs
-- clean no matter which state the DB is actually in).
drop policy if exists "Authenticated users can view orders" on orders;
drop policy if exists "Admin read orders" on orders;
create policy "Admin read orders"
  on orders for select
  to authenticated
  using (is_admin());

drop policy if exists "Admin update orders" on orders;
create policy "Admin update orders"
  on orders for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- 2) CONTACT SUBMISSIONS
-- Add a read/unread flag so the dashboard can show an unread count and let
-- Shawn mark messages handled, plus the update/delete policies to support
-- that (contact_submissions.sql only ever granted select).
alter table contact_submissions add column if not exists is_read boolean not null default false;

drop policy if exists "Admin update contact submissions" on contact_submissions;
create policy "Admin update contact submissions"
  on contact_submissions for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admin delete contact submissions" on contact_submissions;
create policy "Admin delete contact submissions"
  on contact_submissions for delete
  to authenticated
  using (is_admin());
