-- "What We're Building Next" - a public page where Shawn posts build types/
-- ideas he's excited about, separate from actual customer builds (the
-- builds table). Simple admin-curated list, no customer interaction -
-- same shape as gallery_projects, just without the multi-photo join since
-- one optional image is enough for an idea post. Run in the Supabase SQL
-- editor.
create table bulletin_ideas (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  image_url   text,
  -- Lets an idea be pulled from the public page without deleting it (e.g.
  -- once it's no longer "upcoming" - already in progress as a real build,
  -- or shelved) while keeping the row around in the admin list.
  is_visible  boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table bulletin_ideas enable row level security;

create policy "Public read visible bulletin ideas"
  on bulletin_ideas for select
  using (is_visible = true);

create policy "Admin read all bulletin ideas"
  on bulletin_ideas for select
  to authenticated
  using (is_admin());

create policy "Admin write bulletin ideas"
  on bulletin_ideas for all
  to authenticated
  using (is_admin())
  with check (is_admin());

grant select on bulletin_ideas to anon;
grant select, insert, update, delete on bulletin_ideas to authenticated;
