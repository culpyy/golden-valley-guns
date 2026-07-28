-- Real shipping for non-firearm items (ammo, parts, accessories). Unlike
-- firearms, these can ship directly to a consumer - no FFL-to-FFL
-- requirement. Run in the Supabase SQL editor.
--
-- Only used when an order has NO firearm - firearm orders keep using
-- fulfillment_method (pickup/ffl_transfer, sql/ffl_transfer.sql) exactly
-- as before, completely untouched by this migration.
alter table orders add column if not exists ship_to_customer boolean not null default false;
alter table orders add column if not exists shipping_line1 text;
alter table orders add column if not exists shipping_line2 text;
alter table orders add column if not exists shipping_city text;
alter table orders add column if not exists shipping_state text;
alter table orders add column if not exists shipping_zip text;

-- Ammo shipping restrictions (source: Orion Wholesale's own Dropship Program
-- Guidelines, orionfflsales.com/orion-wholesale-dropship-program-guidelines,
-- read 2026-07-24) are all hard blocks, enforced at checkout time - an order
-- shipping ammo to a restricted state/city is rejected outright and never
-- created. No "requires adult signature" flag - simpler and safer than
-- relying on Shawn to remember to flag something with his carrier every
-- time, so those states are just blocked outright too.
