-- Closes the payment gap on distributor/catalog "Request This Item" leads -
-- until now those only ever generated a contact_submissions message, and
-- Shawn had no way to actually collect payment through the site (it was on
-- him to chase it down by phone/Venmo/whatever, completely untracked).
--
-- Reuses the existing `orders` table/Authorize.net flow instead of building
-- a parallel payment system - a special order is just an order Shawn creates
-- by hand (item description + price he's confirmed with the distributor)
-- instead of one a customer built by adding `products` rows to a cart.
-- pay_token is the only credential a customer needs - see src/api/pay.js -
-- there's no login for this, the link itself is the access control, same
-- spirit as builds' tracking codes.
--
-- Run in the Supabase SQL editor.

alter table orders add column if not exists source text not null default 'cart' check (source in ('cart', 'special_order'));
alter table orders add column if not exists pay_token text unique;

-- Firearms ARE allowed through this flow (unlike the cart checkout in
-- src/api/checkout.js, which always excludes them) - paying in advance for
-- a special-order firearm is normal in the industry; the ATF-regulated part
-- is the in-person 4473/NICS check at physical transfer, not the payment
-- itself. pay.html shows a clear notice about that in-person step whenever
-- this is true.
alter table orders add column if not exists is_firearm boolean not null default false;

-- Widen the status enum for special orders specifically:
--   'processing' - a brief atomic claim state (src/api/pay.js sets this via
--                  an UPDATE ... WHERE status='pending' immediately before
--                  charging, so two concurrent submits on the same link
--                  can't both win the charge - the second one's conditional
--                  update affects 0 rows and it's rejected before ever
--                  calling Authorize.net). Reverts to 'pending' if the
--                  charge is declined, so the customer can retry.
--   'cancelled'  - lets Shawn kill a pending special-order link from the
--                  admin dashboard if a deal falls through (item turned out
--                  unavailable, customer backed out, etc.) so a stale link
--                  can't still be paid later against an outdated quote.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'processing', 'paid', 'failed', 'refunded', 'cancelled'));
