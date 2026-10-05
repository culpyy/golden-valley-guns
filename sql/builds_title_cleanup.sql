-- One-time cleanup of free-typed build titles and calibers (2026-10-05).
-- Titles become "<Make> <Model>" (PM12 / Pm-12 / "SBR Beretta PM12 semi
-- build" all become "Beretta PM-12"). The build style (semi pistol, SBR,
-- rifle) lives in builds.type, which the dashboard already shows in its own
-- column, so it is no longer repeated in the title. Type is NOT touched
-- here: the same model appears under Pistol, SBR and Rifle in the data and
-- only Shawn knows which of those are right.
--
-- Placeholder titles like "9mm - Pistol - Parts Kit Build" have no model in
-- them, so they are left alone (rename those by hand in the dashboard).
--
-- Run in the GOLDEN VALLEY GUNS Supabase project (tyqgvpiunplgqzkygnii),
-- SQL editor. Step 1 is read-only: look it over, then run step 2.

-- STEP 1: preview (old -> new, with how many rows each change touches)
with mapped as (
  select
    title,
    case
      when title ~* 'pm[- ]?12s\M'                 then 'Beretta PM-12S'
      when title ~* 'pm[- ]?12'                    then 'Beretta PM-12'
      when title ~* 'star 70b'                     then 'Star 70B'
      when title ~* 'star 70'                      then 'Star 70'
      when title ~* 'sterling'                     then 'Sterling L2A3 (Mk IV)'
      when title ~* 'sten mk ?iii'                 then 'Sten Mk III'
      when title ~* 'sten mk ?ii'                  then 'Sten Mk II'
      when title ~* 'dp-?27'                       then 'DP-27'
      when title ~* 'ppsh'                         then 'PPSh-41'
      when title ~* 'pm-?63'                       then 'PM-63'
      when title ~* '^hk g3$'                      then 'HK G3'
      when title ~* 'sig 542'                      then 'SIG 542'
      when title ~* 'm-?49'                        then 'Yugo M49/57'
      when title ~* 'm-?56'                        then 'Yugo M56'
      when title ~* 'mp-?34'                       then 'MP34'
      when title ~* '1918.*fcg|fcg.*1918'          then 'BAR 1918 FCG Work'
      when title ~* '1918'                         then 'BAR 1918'
      when title ~* '^fcg work$'                   then 'FCG Work'
      else title
    end as new_title
  from builds
)
select title as old_title, new_title, count(*)
from mapped
where title <> new_title
group by 1, 2
order by 2, 1;

-- STEP 2: apply (titles, then calibers). Wrapped in a transaction so you can
-- eyeball the counts before COMMIT; run ROLLBACK instead if anything looks off.
begin;

with mapped as (
  select id,
    case
      when title ~* 'pm[- ]?12s\M'                 then 'Beretta PM-12S'
      when title ~* 'pm[- ]?12'                    then 'Beretta PM-12'
      when title ~* 'star 70b'                     then 'Star 70B'
      when title ~* 'star 70'                      then 'Star 70'
      when title ~* 'sterling'                     then 'Sterling L2A3 (Mk IV)'
      when title ~* 'sten mk ?iii'                 then 'Sten Mk III'
      when title ~* 'sten mk ?ii'                  then 'Sten Mk II'
      when title ~* 'dp-?27'                       then 'DP-27'
      when title ~* 'ppsh'                         then 'PPSh-41'
      when title ~* 'pm-?63'                       then 'PM-63'
      when title ~* '^hk g3$'                      then 'HK G3'
      when title ~* 'sig 542'                      then 'SIG 542'
      when title ~* 'm-?49'                        then 'Yugo M49/57'
      when title ~* 'm-?56'                        then 'Yugo M56'
      when title ~* 'mp-?34'                       then 'MP34'
      when title ~* '1918.*fcg|fcg.*1918'          then 'BAR 1918 FCG Work'
      when title ~* '1918'                         then 'BAR 1918'
      when title ~* '^fcg work$'                   then 'FCG Work'
      else title
    end as new_title
  from builds
)
update builds b set title = m.new_title
from mapped m
where b.id = m.id and b.title <> m.new_title;

-- Only the unambiguous caliber spellings. "9mm MAK" and "7.62x25 tok or 9mm"
-- are left as typed (could be 9x18 Makarov / a real either-or).
with mapped as (
  select id,
    case
      when caliber ~* '^9 ?mm$|^9x19(mm)?$'        then '9mm'
      when caliber ~* '^7\.62x54r?$'               then '7.62x54R'
      when caliber ~* '^7\.62x25( tok)?(mm)?$'     then '7.62x25mm'
      when caliber ~* '^30\.06$'                   then '.30-06'
      when caliber ~* '^none$'                     then ''
      else caliber
    end as new_caliber
  from builds
  where caliber is not null
)
update builds b set caliber = m.new_caliber
from mapped m
where b.id = m.id and b.caliber <> m.new_caliber;

-- Check the result, then COMMIT (or ROLLBACK):
select title, type, caliber, count(*) from builds group by 1,2,3 order by 4 desc;

-- commit;
-- rollback;
