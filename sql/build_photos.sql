-- Lets a build carry multiple photos - Shawn wants to show progress on an
-- in-shop build (before/mid/after), not just the single "after" shot
-- builds.photo_url allowed. Mirrors gallery_project_photos' shape exactly
-- (sql/gallery_projects.sql). Run in the Supabase SQL editor.
create table build_photos (
  id         uuid primary key default gen_random_uuid(),
  build_id   uuid not null references builds(id) on delete cascade,
  photo_url  text not null,
  label      text,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index build_photos_build_id_idx on build_photos(build_id);

-- Same is_admin() pattern as every other admin-managed table
-- (sql/security_hardening.sql) - public can read (shown on inshop.html/
-- gallery.html), only admins can write.
alter table build_photos enable row level security;

create policy "Public read build photos"
  on build_photos for select
  using (true);

create policy "Admin write build photos"
  on build_photos for all
  to authenticated
  using (is_admin())
  with check (is_admin());

grant select on build_photos to anon, authenticated;

-- Migrate each build's existing single photo_url (if any) in as its first
-- photo - nothing lost. builds.photo_url itself is left in place (just
-- unused by the app going forward) rather than dropped, since dropping a
-- column builds_public already selects would require recreating that view
-- (CREATE OR REPLACE VIEW can only append columns, not remove them) for no
-- functional benefit.
insert into build_photos (build_id, photo_url, position)
select id, photo_url, 0 from builds where photo_url is not null;
