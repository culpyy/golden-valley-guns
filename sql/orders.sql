-- Orders placed through the Authorize.net checkout (js/cart.js -> checkout.html
-- -> POST /api/checkout -> src/api/checkout.js). Run in the Supabase SQL editor.
--
-- Only Shawn's own hand-curated parts (the `products` table, category != 'firearms')
-- are sellable through this flow - firearms always require an in-person FFL
-- transfer/NICS check, so they stay on the existing "Request a Firearm" contact-form
-- path and never reach this table. See src/api/checkout.js for the server-side
-- enforcement of that rule (never trust the client on this).

-- 1) TABLE
-- Written only by the Worker's /api/checkout route using the service-role key
-- (src/lib/supabaseAdmin.js) - the anon/browser client never inserts here
-- directly, which is why there's no anon/authenticated insert policy below.
create table orders (
  id                        uuid primary key default gen_random_uuid(),
  order_number              text unique not null,   -- e.g. GVG-ORD-2026-001, same numbering spirit as builds' GVG-YYYY-NNN tracking codes
  customer_name             text not null,
  customer_email            text not null,
  customer_phone            text,
  items                     jsonb not null,          -- [{id, name, price, qty}] snapshot at time of sale, not a live join to `products`
  subtotal                  numeric not null,
  total                     numeric not null,
  status                    text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  authorize_net_transaction_id text,
  authorize_net_response     jsonb,                  -- full response payload, kept for support/dispute lookups
  created_at                timestamptz not null default now()
);

-- RLS: no anon access at all (this is customer PII + transaction data). The
-- Worker writes with the service-role key, which bypasses RLS entirely, so no
-- insert policy is needed for that path. The one policy below just lets
-- Shawn's logged-in admin session read orders for a future admin-dashboard tab.
alter table orders enable row level security;

create policy "Authenticated users can view orders"
  on orders for select
  to authenticated
  using (true);
