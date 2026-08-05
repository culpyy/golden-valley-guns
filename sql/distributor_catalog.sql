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

-- 8) COMPLIANCE PAUSE: revoke public access (2026-07-17)
-- Lipsey's API docs require Domains And IP Addresses to be pre-approved
-- before use (not done for this custom integration - we're not going
-- through one of their Preferred Partners), and separately their docs
-- explicitly say not to hotlink product images from lipseyscloud.com, which
-- image_url on every synced row was doing. shop.html and src/worker.js's
-- cron were already updated to stop displaying/syncing this data, but block
-- 4's `grant select ... to anon` means distributor_products_public was
-- ALSO directly queryable by anyone hitting the Supabase REST API with just
-- the public anon key, regardless of what the site itself renders - this
-- closes that door too. Re-grant (see block 4) only after the API Access
-- Request form is submitted (domain + real outbound IP) and image hosting
-- is fixed to download to our own storage instead of hotlinking.
revoke select on distributor_products_public from anon;

-- 9) MIGRATION: image_source_name for bounded image backfill (2026-07-18)
-- First live sync attempt after Lipsey's API approval hit Cloudflare's
-- subrequest-per-invocation limit - the old approach checked every
-- allow-listed item's cache status inline during the main sync, and with
-- 15 manufacturers matching hundreds of items, even the download cap alone
-- (200 fetches) blew past the limit before the catalog upsert could finish,
-- meaning NO data saved at all, not even pricing.
-- New approach: the main sync now upserts catalog data (price/stock/etc)
-- immediately with image_url left null, stashing the distributor's own
-- image filename here instead. A separate, tightly-bounded pass
-- (backfillImages in src/lib/imageCache.js, ~20 images/run) finds rows
-- still missing an image_url and catches them up over several days -
-- pricing/stock data is never blocked waiting on images again.
alter table distributor_products add column if not exists image_source_name text;

-- 10) DOCUMENTATION RECONCILIATION (2026-07-20 full-site audit): Lipsey's
-- API access was approved 2026-07-18 (see src/worker.js's header comment)
-- and access was re-granted directly via the Supabase SQL editor at the
-- time, but that re-grant was never captured back into this tracked file -
-- so block 8's revoke reads as the chronological last word here even
-- though it's been re-granted live for days. Confirmed live via a real
-- anon-key REST query (6,957 rows readable) before writing this. Re-running
-- the grant here is a no-op if already granted.
grant select on distributor_products_public to anon;

-- 11) DEDUP: collapse same-UPC listings across distributors (2026-08-03)
-- Found 5,068 UPCs carried by both Lipsey's and Orion (10,136 of 29,447
-- distributor rows, ~34%) showing up as two separate listings for the same
-- physical product under each distributor's own name formatting - e.g. the
-- same Browning shotgun as both "CITORI HUNTER DELUXE 16/28   #" (Lipsey's)
-- and "BRWNG CITORI HUNT DX,16GA SHTGN 2.75,28 INV GLOSS WALNT" (Orion).
-- Ranks duplicates by: in-stock first, then lowest price, then has-an-image,
-- tie-broken by id, and keeps only the top-ranked row per UPC. Rows with a
-- null/empty UPC are never grouped together (each is its own singleton via
-- the id fallback in the partition key), so non-UPC items are unaffected.
create or replace view distributor_products_public as
with markup as (
  select coalesce(
    (select value::numeric from site_content where key = 'catalog_markup_pct'),
    0
  ) as pct
),
priced as (
  select
    dp.*,
    greatest(
      round(dp.dealer_cost * (1 + markup.pct / 100.0), 2),
      coalesce(dp.retail_map, 0)
    ) as computed_price
  from distributor_products dp
  cross join markup
  where dp.is_hidden = false
),
ranked as (
  select
    p.*,
    row_number() over (
      partition by coalesce(nullif(trim(p.upc), ''), p.id::text)
      order by
        (p.quantity_available > 0) desc,
        p.computed_price asc,
        (p.image_url is not null) desc,
        p.id
    ) as rn
  from priced p
)
select
  id,
  distributor,
  name,
  manufacturer,
  category,
  caliber,
  description,
  computed_price as price,
  case
    when quantity_available > 5 then 'in_stock'
    when quantity_available > 0 then 'limited'
    else 'out'
  end as stock,
  image_url,
  is_firearm,
  last_synced_at,
  firearm_type
from ranked
where rn = 1;
