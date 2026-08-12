-- Groups gallery photos into projects so before/after (or any multi-photo
-- job) can show as one gallery card instead of separate disconnected
-- tiles. Braeden: photos were getting cut up into separate uploads
-- specifically to fake this - a real before/after project needs an actual
-- home for more than one photo. Run in the Supabase SQL editor.
--
-- Replaces gallery_photos (2026-08-12, single photo per row) with two
-- tables: one project can now hold any number of ordered, optionally
-- labeled photos ("Before", "After", or nothing).

create table gallery_projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  type        text,
  caliber     text,
  is_showcase boolean not null default false,
  created_at  timestamptz not null default now()
);

create table gallery_project_photos (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references gallery_projects(id) on delete cascade,
  photo_url  text not null,
  label      text,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index gallery_project_photos_project_id_idx on gallery_project_photos(project_id);

-- Same is_admin() pattern as gallery_photos/every other admin-managed
-- table (sql/security_hardening.sql).
alter table gallery_projects enable row level security;
alter table gallery_project_photos enable row level security;

create policy "Public read gallery projects"
  on gallery_projects for select
  using (true);

create policy "Admin write gallery projects"
  on gallery_projects for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Public read gallery project photos"
  on gallery_project_photos for select
  using (true);

create policy "Admin write gallery project photos"
  on gallery_project_photos for all
  to authenticated
  using (is_admin())
  with check (is_admin());

grant select on gallery_projects, gallery_project_photos to anon, authenticated;

-- Migrate the 11 existing single-photo gallery_photos rows into the new
-- shape (one project each, one photo each, no label) before dropping the
-- old table - nothing gets lost.
insert into gallery_projects (id, title, type, caliber, is_showcase, created_at)
select id, title, type, caliber, is_showcase, created_at from gallery_photos;

insert into gallery_project_photos (project_id, photo_url, position, created_at)
select id, photo_url, 0, created_at from gallery_photos;

drop table gallery_photos;
