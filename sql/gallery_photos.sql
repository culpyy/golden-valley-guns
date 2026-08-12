-- Gallery photos get their own table, fully separate from builds.
--
-- The old "Quick Gallery Photo" flow inserted a fake row into builds
-- (status: ready, a real tracking code, progress: 100) just so gallery.html
-- had something to query. That row then sat in the Active Builds admin
-- table looking like a real unfinished job with a "Mark Complete" button
-- on it - clicking that (reasonable thing to do to a build sitting in your
-- active list) set completed_at and inflated the public "X builds
-- completed" count with a photo, not an actual finished job. Run in the
-- Supabase SQL editor.

create table gallery_photos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  type        text,
  caliber     text,
  photo_url   text not null,
  is_showcase boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Same is_admin() pattern as every other admin-managed table
-- (sql/security_hardening.sql) - public can read (gallery.html is
-- anon-facing), only Shawn/Braeden can write.
alter table gallery_photos enable row level security;

create policy "Public read gallery photos"
  on gallery_photos for select
  using (true);

create policy "Admin write gallery photos"
  on gallery_photos for all
  to authenticated
  using (is_admin())
  with check (is_admin());

grant select on gallery_photos to anon, authenticated;
