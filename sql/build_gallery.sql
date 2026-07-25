-- Adds photo + "always showcase" support to builds, for the completed-builds
-- gallery Shawn asked about (gallery.html). Run in the Supabase SQL editor.
--
-- Table already has real rows in production, so this is additive-only
-- (new nullable/defaulted columns) - zero-risk, no backfill needed.
alter table builds add column if not exists photo_url text;
alter table builds add column if not exists is_showcase boolean not null default false;

-- builds_public (sql/security_hardening.sql) is what gallery.html/inshop.html/
-- index.html/track.html actually query - it deliberately excludes
-- customer_name/customer_email/customer_phone. Recreate it with the two new
-- columns added so the gallery can actually read them; everything else about
-- the view (grants, excluded PII columns) stays exactly as it was.
-- New columns must be appended at the end of the SELECT list, not inserted
-- among the existing ones - CREATE OR REPLACE VIEW treats a mid-list
-- insertion as renaming whatever existing column it displaced (confirmed
-- live: Postgres error 42P16 trying to insert before created_at/updated_at).
create or replace view builds_public as
select
  id, title, type, caliber, status, progress, received, eta,
  atf_form, atf_filed, tracking_code, notes, is_nfa,
  created_at, updated_at,
  photo_url, is_showcase
from builds;

grant select on builds_public to anon, authenticated;
