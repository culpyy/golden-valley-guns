-- Catalog of kit / platform names (Beretta PM-12, Sten Mk II, DP-27, ...).
-- Before this, "Kit / Platform" on the intake wizard was free text, so the
-- same kit came in as "PM12", "pm-12", "Pm12 semi build" and every one of
-- those became its own build title. The wizard now suggests names from this
-- table, the intake endpoint maps whatever arrives onto a catalog name, and
-- the admin build form suggests from it too. Shawn manages the list from
-- the Platforms tab in the admin dashboard.
--
-- aliases = other spellings customers use. They are compared with case,
-- spaces and punctuation ignored, so "pm 12" already matches "PM-12" - only
-- add an alias when the text is genuinely different ("Model 12", "Z70").
-- default_caliber fills the wizard's Caliber box when the customer picks the
-- kit (still editable); leave it null when a platform came in several
-- calibers. Run in the GOLDEN VALLEY GUNS Supabase project, SQL editor.

create table kit_platforms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  aliases         text[] not null default '{}',
  default_caliber text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table kit_platforms enable row level security;

create policy "Public read active kit platforms"
  on kit_platforms for select
  using (is_active = true);

create policy "Admin read all kit platforms"
  on kit_platforms for select
  to authenticated
  using (is_admin());

create policy "Admin write kit platforms"
  on kit_platforms for all
  to authenticated
  using (is_admin())
  with check (is_admin());

grant select on kit_platforms to anon;
grant select, insert, update, delete on kit_platforms to authenticated;

-- Seed: the clean names from the 2026-10-05 title cleanup
-- (builds_title_cleanup.sql) plus the platforms the intake page already
-- names as examples (HK33, AK-47, Suomi).
insert into kit_platforms (name, aliases, default_caliber) values
  ('Beretta PM-12',         array['PM12','Beretta Model 12','Model 12','Beretta 12'],   '9mm'),
  ('Beretta PM-12S',        array['PM12S','Beretta Model 12S','Model 12S'],             '9mm'),
  ('Star 70',               array['Star Z70','Z70','Star Z-70'],                         '9mm'),
  ('Star 70B',              array['Star Z70B','Z70B','Star Z-70B'],                      '9mm'),
  ('Sten Mk II',            array['Sten 2','Sten MkII'],                                 '9mm'),
  ('Sten Mk III',           array['Sten 3','Sten MkIII'],                                '9mm'),
  ('Sterling L2A3 (Mk IV)', array['Sterling','Sterling L2A3','Sterling Mk4','L2A3'],     '9mm'),
  ('DP-27',                 array['DP27','Degtyaryov','Degtyarev'],                      '7.62x54R'),
  ('PPSh-41',               array['PPSH','PPSH41','Shpagin'],                            '7.62x25mm'),
  ('PM-63',                 array['PM63','RAK'],                                         null),
  ('HK G3',                 array['G3','H&K G3'],                                        '7.62x51'),
  ('SIG 542',               array['SG 542','SG542'],                                     null),
  ('Yugo M56',              array['M56','Zastava M56'],                                  null),
  ('Yugo M49/57',           array['M49/57','M49','Zastava M49/57'],                      '7.62x25mm'),
  ('MP34',                  array['MP-34','Steyr MP34'],                                 null),
  ('BAR 1918',              array['1918 BAR','BAR M1918','M1918'],                       '.30-06'),
  ('HK33',                  array['H&K 33'],                                             null),
  ('AK-47',                 array['AK47','AK'],                                          null),
  ('Suomi KP/-31',          array['Suomi','Suomi KP31','KP-31','KP/-31'],                null)
on conflict (name) do nothing;

-- OPTIONAL, run after the seed: clean up kit_type on submissions that are
-- already in intake_submissions, using the same matching rule as the app
-- (name or alias, case/spaces/punctuation ignored). Rows that match nothing
-- are left exactly as the customer typed them. Preview first:
--
-- select i.kit_type as typed, p.name as becomes, count(*)
-- from intake_submissions i
-- join kit_platforms p on exists (
--   select 1 from unnest(p.aliases || p.name) a
--   where lower(regexp_replace(a, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(i.kit_type, '[^a-zA-Z0-9]', '', 'g')))
-- where i.kit_type is not null and i.kit_type <> p.name
-- group by 1, 2 order by 2, 1;
--
-- then apply:
--
-- update intake_submissions i set kit_type = p.name
-- from kit_platforms p
-- where i.kit_type is not null and i.kit_type <> p.name
--   and exists (
--     select 1 from unnest(p.aliases || p.name) a
--     where lower(regexp_replace(a, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(i.kit_type, '[^a-zA-Z0-9]', '', 'g')));
