-- Security hardening pass (2026-07-18). Run in the Supabase SQL editor.
--
-- Two real gaps found: (1) "Admin write" policies on builds/products/
-- site_content/distributor_products only checked auth.role() = 'authenticated'
-- - i.e. "is logged in at all," not "is actually Shawn or Braeden." Since
-- public signup is open (disable_signup: false), anyone who registers an
-- account currently gets full write access to product prices, builds, and
-- site content. (2) builds' "Public read builds" policy is `using(true)` for
-- role public (covers anon AND authenticated) with no column restriction -
-- confirmed via a direct anon-key REST query that customer_name/email/phone
-- are fully readable by anyone, bypassing whatever the app's UI chooses to
-- render. Table happens to be empty right now, so nothing has actually
-- leaked yet, but this needed fixing before Shawn starts adding real builds.

-- 1) ADMIN IDENTITY
-- Single source of truth for "who is actually an admin" - every tightened
-- policy below calls this instead of duplicating the UID list. To add/remove
-- an admin later, this is the only place to edit.
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select auth.uid() in (
    '8b89e241-45be-412b-b726-2b755da4e2a7', -- goldenvalleyguns@gmail.com (Shawn)
    'e7f8beab-e4d3-4169-936e-c0df314a2a92'  -- culpbraeden@yahoo.com (Braeden)
  );
$$;

-- 2) TIGHTEN WRITE POLICIES
-- Same fix repeated for every table that had the "any authenticated user"
-- bug - replace auth.role() = 'authenticated' with is_admin().
drop policy if exists "Admin write builds" on builds;
create policy "Admin write builds"
  on builds for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admin write products" on products;
create policy "Admin write products"
  on products for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admin write site_content" on site_content;
create policy "Admin write site_content"
  on site_content for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Authenticated users can view distributor products" on distributor_products;
create policy "Admin view distributor products"
  on distributor_products for select
  to authenticated
  using (is_admin());

drop policy if exists "Authenticated users can hide/unhide distributor products" on distributor_products;
create policy "Admin hide/unhide distributor products"
  on distributor_products for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- 3) FIX builds PII EXPOSURE
-- Drop the "anyone can read every column of every build" policy entirely -
-- full-table read (including customer_name/email/phone) is now admin-only,
-- matching how distributor_products' dealer_cost is already handled.
drop policy if exists "Public read builds" on builds;
create policy "Admin read builds"
  on builds for select
  to authenticated
  using (is_admin());

-- Public-safe view for the actual customer-facing use cases (index.html's
-- live build preview, inshop.html's board, track.html's tracking-code
-- lookup) - deliberately excludes customer_name/customer_email/customer_phone
-- so there's no query shape, column selection, or role that can pull PII
-- through this view. Same pattern as distributor_products_public.
create or replace view builds_public as
select
  id, title, type, caliber, status, progress, received, eta,
  atf_form, atf_filed, tracking_code, notes, is_nfa,
  created_at, updated_at
from builds;

grant select on builds_public to anon, authenticated;

-- 4) ALSO DO THIS MANUALLY (not doable from SQL):
-- Supabase Dashboard > Authentication > Providers > Email > toggle OFF
-- "Allow new users to sign up." There's no legitimate reason for public
-- signup on this project - only Shawn and Braeden's accounts should ever
-- exist. This closes the vulnerability at its source; the policy changes
-- above are defense in depth in case it's ever re-enabled by mistake.
