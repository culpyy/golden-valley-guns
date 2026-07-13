-- Distributor catalog (Lipsey's / RSR / Davidson's / Orion) - run this once in the
-- Supabase SQL editor (Project > SQL Editor > New query). Paste and run top to bottom.

-- TABLE
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

-- RLS: locked down entirely. Only the service-role key (used by the Netlify
-- sync functions, never shipped to the browser) can read/write this table.
-- No policies are created for `anon` - that's intentional, not an oversight.
alter table distributor_products enable row level security;

-- SITE CONTENT
-- Markup percentage applied on top of dealer_cost, editable from
-- admin-dashboard.html's existing Site Content panel.
insert into site_content (key, value) values
  ('catalog_markup_pct', '25'),
  ('catalog_manufacturers', '')   -- comma-separated allow-list, e.g. "PSA,Aero Precision,Magpul"
on conflict (key) do nothing;

-- PUBLIC VIEW
-- What the browser actually queries. Computes the marked-up price server-side
-- and excludes dealer_cost entirely so it never appears in a network request.
create view distributor_products_public as
select
  dp.id,
  dp.distributor,
  dp.name,
  dp.manufacturer,
  dp.category,
  dp.caliber,
  dp.description,
  round(dp.dealer_cost * (1 + m.markup / 100.0), 2) as price,
  case
    when dp.quantity_available > 5 then 'in_stock'
    when dp.quantity_available > 0 then 'limited'
    else 'out'
  end as stock,
  dp.image_url,
  dp.is_firearm,
  dp.last_synced_at
from distributor_products dp
cross join (
  select coalesce((select value::numeric from site_content where key = 'catalog_markup_pct'), 0) as markup
) m
where dp.is_hidden = false;

grant select on distributor_products_public to anon;
