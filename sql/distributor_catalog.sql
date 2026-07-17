-- Distributor catalog (Lipsey's / RSR / Davidson's / Orion).
-- Run in the Supabase SQL editor. If pasting the whole file at once causes an
-- "unterminated quoted string" error, run each numbered block separately
-- (clear the editor between blocks) -- that's a paste/editor quirk, not a
-- SQL problem.

-- 1) TABLE
-- Machine-synced distributor inventory. Kept separate from `products` (Shawn's
-- hand-curated parts) since this table is written only by the sync jobs.
create table distributor_products (
  id                  uuid primary key default gen_random_uuid(),
  distributor         text not null check (distributor in ('lipseys','rsr','davidsons','orion')),
  distributor_sku     text not null,
  upc                 text,
  name                text not null,
  manufacturer        text,
  category            text not null check (category in ('firearms','ammo','parts')),
  caliber             text,
  firearm_type        text,   -- "Handgun"/"Rifle"/"Shotgun"/"Muzzleloader"/"Other" - bucketed by sync/lipseys.js's mapFirearmType() from the distributor's raw classification, only set when category = 'firearms', drives the shop page's firearm-type filter
  description         text,
  dealer_cost         numeric not null,       -- wholesale cost, never exposed publicly
  msrp                numeric,
  quantity_available  integer not null default 0,
  image_url           text,
  is_firearm          boolean not null default false,
  is_hidden           boolean not null default false,
  last_synced_at      timestamptz not null default now(),
  unique (distributor, distributor_sku)
);

-- RLS: no public (anon) access - dealer_cost must never reach the browser,
-- which is why the public site queries distributor_products_public (below)
-- instead of this table directly. Signed-in admin sessions (authenticated
-- role) get their own narrow policies in block 5 - just enough for the
-- admin dashboard's Distributor Catalog tab (view items, hide/unhide), not
-- full read/write.
alter table distributor_products enable row level security;

-- 2) SITE CONTENT
-- Markup percentage applied on top of dealer_cost, editable from
-- admin-dashboard.html's existing Site Content panel.
insert into site_content (key, value) values
  ('catalog_markup_pct', '25'),
  ('catalog_manufacturers', '')   -- comma-separated allow-list, e.g. "PSA,Aero Precision,Magpul"; "*" allows every manufacturer
on conflict (key) do nothing;

-- 3) PUBLIC VIEW
-- What the browser actually queries. Computes the marked-up price server-side
-- and excludes dealer_cost entirely so it never appears in a network request.
create view distributor_products_public as
with markup as (
  select coalesce(
    (
      select value::numeric
      from site_content
      where key = 'catalog_markup_pct'
    ),
    0
  ) as pct
)
select
  dp.id,
  dp.distributor,
  dp.name,
  dp.manufacturer,
  dp.category,
  dp.caliber,
  dp.description,
  round(dp.dealer_cost * (1 + markup.pct / 100.0), 2) as price,
  case
    when dp.quantity_available > 5 then 'in_stock'
    when dp.quantity_available > 0 then 'limited'
    else 'out'
  end as stock,
  dp.image_url,
  dp.is_firearm,
  dp.last_synced_at,
  dp.firearm_type
from distributor_products dp
cross join markup
where dp.is_hidden = false;

-- 4) GRANT
grant select on distributor_products_public to anon;

-- 5) ADMIN ACCESS
-- Without these, a signed-in Shawn's browser session has no more access to
-- distributor_products than an anonymous visitor - the RLS lockdown in block
-- 1 has zero policies at all by default, which blocks `authenticated` too,
-- not just `anon`. This is what makes admin-dashboard.html's Distributor
-- Catalog tab (sync status, item table, hide/unhide) actually work.
create policy "Authenticated users can view distributor products"
  on distributor_products for select
  to authenticated
  using (true);

create policy "Authenticated users can hide/unhide distributor products"
  on distributor_products for update
  to authenticated
  using (true)
  with check (true);

-- 6) MIGRATION: firearm_type (2026-07-16)
-- Table/view above already reflect this column for anyone running the file
-- fresh - this block is what to run against the live database, which
-- already has the table from blocks 1-5.
alter table distributor_products add column if not exists firearm_type text;

create or replace view distributor_products_public as
with markup as (
  select coalesce(
    (
      select value::numeric
      from site_content
      where key = 'catalog_markup_pct'
    ),
    0
  ) as pct
)
select
  dp.id,
  dp.distributor,
  dp.name,
  dp.manufacturer,
  dp.category,
  dp.caliber,
  dp.description,
  round(dp.dealer_cost * (1 + markup.pct / 100.0), 2) as price,
  case
    when dp.quantity_available > 5 then 'in_stock'
    when dp.quantity_available > 0 then 'limited'
    else 'out'
  end as stock,
  dp.image_url,
  dp.is_firearm,
  dp.last_synced_at,
  dp.firearm_type
from distributor_products dp
cross join markup
where dp.is_hidden = false;

-- 7) MIGRATION: retail_map floor (2026-07-17)
-- Lipsey's dealer agreement requires adhering to every manufacturer's MAP
-- (Minimum Advertised Price) program. The markup% in block 2 is a flat
-- percentage over dealer_cost - fine on average, but nothing stopped it from
-- landing below a specific SKU's actual MAP on any item where the
-- manufacturer set MAP high relative to cost. Lipsey's CatalogFeed already
-- returns a per-item `retailMap` value (captured by sync/lipseys.js as
-- retail_map); this migration makes the view take whichever is higher, the
-- markup-based price or the real MAP floor, so the displayed price can never
-- undercut it. retail_map is null for items Lipsey's doesn't set a MAP on
-- (coalesce falls back to the plain markup price in that case).
alter table distributor_products add column if not exists retail_map numeric;

create or replace view distributor_products_public as
with markup as (
  select coalesce(
    (
      select value::numeric
      from site_content
      where key = 'catalog_markup_pct'
    ),
    0
  ) as pct
)
select
  dp.id,
  dp.distributor,
  dp.name,
  dp.manufacturer,
  dp.category,
  dp.caliber,
  dp.description,
  greatest(
    round(dp.dealer_cost * (1 + markup.pct / 100.0), 2),
    coalesce(dp.retail_map, 0)
  ) as price,
  case
    when dp.quantity_available > 5 then 'in_stock'
    when dp.quantity_available > 0 then 'limited'
    else 'out'
  end as stock,
  dp.image_url,
  dp.is_firearm,
  dp.last_synced_at,
  dp.firearm_type
from distributor_products dp
cross join markup
where dp.is_hidden = false;
