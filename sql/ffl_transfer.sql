-- Adds FFL-to-FFL transfer support for firearm orders. Run in the Supabase
-- SQL editor.
--
-- Until now, every firearm order implicitly meant "picked up in person at
-- Golden Valley Guns." That's legally required for any firearm transfer to
-- an unlicensed customer, but it's not the only legal option - the standard
-- industry practice is shipping FFL-to-FFL to a dealer near the customer,
-- who then does the in-person NICS/4473 transfer themselves. Golden Valley
-- Guns still gets paid either way; the physical item just goes to a
-- different licensed dealer instead of staying in Shawn's shop.
--
-- fulfillment_method defaults to 'pickup' (the only option that existed
-- before this migration) so every existing order is unaffected.
alter table orders add column if not exists fulfillment_method text not null default 'pickup'
  check (fulfillment_method in ('pickup', 'ffl_transfer'));

-- Populated only when fulfillment_method = 'ffl_transfer' - the customer's
-- chosen receiving dealer, submitted at checkout/pay time.
alter table orders add column if not exists transfer_ffl_business_name text;
alter table orders add column if not exists transfer_ffl_license_number text;
alter table orders add column if not exists transfer_ffl_phone text;
alter table orders add column if not exists transfer_ffl_address text;

-- The actual gate: Shawn verifies the receiving FFL's license is valid and
-- current (phone/fax/email copy - however he already does it) BEFORE
-- shipping anything. This is a manual checklist flag he sets from the admin
-- dashboard, not an automated check - there's no free/official ATF API for
-- real-time FFL verification. ffl_verified defaults false so every
-- ffl_transfer order starts in the "do not ship yet" state.
alter table orders add column if not exists ffl_verified boolean not null default false;
alter table orders add column if not exists ffl_verified_at timestamptz;
