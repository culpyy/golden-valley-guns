-- Connects a build to the existing orders/Authorize.net payment system.
-- Previously there was zero link between "build reaches Ready" and actually
-- collecting payment - Shawn had to manually retype everything into the
-- unrelated Orders tab. This adds a price on the build and a payment_status
-- that the admin dashboard's "Get Paid" button keeps in sync with the real
-- order status (src/api/specialOrder.js, src/api/pay.js, src/api/refundOrder.js).
--
-- price/payment_status/order_id are NOT added to builds_public (sql/build_gallery.sql) -
-- that view is what the public-facing pages query, and pricing has no reason
-- to be customer-visible. Direct `builds` table access is already admin-only
-- (sql/security_hardening.sql's is_admin() policy), so these are private by
-- default with no further RLS work needed.
alter table builds add column if not exists price numeric(10,2);
alter table builds add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'invoiced', 'paid', 'refunded'));
alter table builds add column if not exists order_id uuid references orders(id);
-- Denormalized copy of the order's pay.html link, purely so the admin
-- dashboard can show/copy it without an extra join - orders.pay_token
-- remains the actual source of truth for the link's validity.
alter table builds add column if not exists pay_url text;
