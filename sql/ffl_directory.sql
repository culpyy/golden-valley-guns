-- ATF public FFL listing (2026-09-23). Run in the Supabase SQL editor.
--
-- Powers the "find your dealer" search on pay.html/checkout.html, so a
-- customer picks their receiving FFL from a list instead of typing the
-- name/address/phone/license by hand, and lets src/api/pay.js +
-- checkout.js flag whether the license on an order matches ATF's own list.
--
-- Source: the monthly "complete list of FFLs" csv from
-- atf.gov/firearms/tools-and-services-firearms-industry/federal-firearms-listings
-- Only license types 01 (dealer), 02 (pawnbroker) and 07 (manufacturer) are
-- loaded - the types that can receive a transfer. It's a snapshot, not a
-- live check: a license revoked after the snapshot still shows up, so
-- Shawn's "Mark FFL Verified" step stays the real gate. Refresh monthly.
create extension if not exists pg_trgm;

create table if not exists ffl_directory (
  license       text primary key,   -- 1-66-003-01-7F-00258
  license_key   text not null,      -- same, alphanumerics only, uppercase
  license_type  text,
  expires       text,
  name          text,
  business_name text,
  street        text,
  city          text,
  state         text,
  zip           text,
  phone         text,               -- digits only
  search        text not null       -- lowercased business + name + city + state + zip
);

create index if not exists ffl_directory_search_trgm on ffl_directory using gin (search gin_trgm_ops);
create index if not exists ffl_directory_state_idx on ffl_directory (state);
create index if not exists ffl_directory_key_idx on ffl_directory (license_key);
create index if not exists ffl_directory_phone_idx on ffl_directory (phone);

-- Public reads go through /api/ffl-search (service_role, rate limited), never
-- the anon key directly. Admins can read and (re)load it from the dashboard.
alter table ffl_directory enable row level security;
drop policy if exists "Admin read ffl_directory" on ffl_directory;
create policy "Admin read ffl_directory" on ffl_directory for select using (is_admin());
drop policy if exists "Admin write ffl_directory" on ffl_directory;
create policy "Admin write ffl_directory" on ffl_directory for all using (is_admin()) with check (is_admin());

-- Result of checking an order's receiving FFL against the table above.
alter table orders add column if not exists transfer_ffl_atf_match boolean;
alter table orders add column if not exists transfer_ffl_atf_note text;
