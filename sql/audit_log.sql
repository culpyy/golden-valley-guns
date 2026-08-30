-- Audit log (2026-08-30). Run in the Supabase SQL editor.
--
-- Motivated by a real incident: a build (GVG-2026-021, one of Austin Does'
-- 10 PM-12s) got deleted from `builds` and there was no way to tell who
-- deleted it, when, or whether it was intentional - no audit table existed,
-- and the delete happens as a direct browser-to-Supabase call from
-- admin-dashboard.html, so it never touches the Cloudflare Worker logs
-- either. Had to reconstruct what happened from a gap in the tracking-code
-- sequence instead of just looking it up.
--
-- Generic trigger-based audit log: one function, attachable to any table
-- with a single CREATE TRIGGER line. Captures INSERT/UPDATE/DELETE, the
-- full old and new row as JSON, and who did it (from the request's JWT, so
-- it reflects the actual logged-in admin, not just "someone").

-- 1) THE LOG TABLE
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  operation text not null,              -- 'INSERT' | 'UPDATE' | 'DELETE'
  old_data jsonb,                       -- null on INSERT
  new_data jsonb,                       -- null on DELETE
  changed_by uuid,                      -- auth.uid() of the acting session, null if not authenticated
  changed_by_email text,                -- denormalized from the JWT so this reads without joining auth.users
  changed_at timestamptz not null default now()
);

create index if not exists audit_log_table_record_idx on audit_log (table_name, record_id);
create index if not exists audit_log_changed_at_idx on audit_log (changed_at desc);

-- Admins can read the log; nobody (not even admins) can write to it
-- directly - the only writes come from the trigger function below, via
-- its own elevated privileges, so the log can't be edited after the fact
-- by anyone including a compromised admin session.
alter table audit_log enable row level security;

drop policy if exists "Admin read audit_log" on audit_log;
create policy "Admin read audit_log"
  on audit_log for select
  using (is_admin());

-- 2) THE TRIGGER FUNCTION
-- security definer so it can insert into audit_log even though no role has
-- an INSERT policy on it above - runs with the privileges of whoever owns
-- this function (the role that executes this migration), not the caller's.
create or replace function log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
begin
  -- Referencing OLD in an INSERT trigger (or NEW in a DELETE trigger) isn't
  -- just null in PL/pgSQL, it raises "record ... is not assigned yet" - so
  -- this has to branch on TG_OP rather than lean on coalesce()/CASE to
  -- paper over which one is actually populated.
  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    v_id := NEW.id;
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_id := NEW.id;
  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_id := OLD.id;
  end if;

  insert into audit_log (table_name, record_id, operation, old_data, new_data, changed_by, changed_by_email)
  values (TG_TABLE_NAME, v_id, TG_OP, v_old, v_new, auth.uid(), auth.jwt() ->> 'email');

  if TG_OP = 'DELETE' then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;

-- 3) ATTACH TO `builds`
-- The table that actually caused the pain. To cover another table
-- (products, orders, intake_submissions, ...) later, it's just this same
-- three lines with the table name swapped in - no changes needed above.
drop trigger if exists builds_audit_trigger on builds;
create trigger builds_audit_trigger
  after insert or update or delete on builds
  for each row execute function log_audit_event();

-- 4) CONVENIENCE VIEW
-- Plain `select * from audit_log where table_name = 'builds' order by
-- changed_at desc` works fine too - this just saves retyping that filter
-- for the table this was actually built for.
-- security_invoker so this view enforces the QUERYING user's own RLS
-- against audit_log (admins only), not the view owner's - without this a
-- view bypasses the base table's RLS entirely, which would make "grant to
-- authenticated" below hand every signed-up account read access to the
-- log regardless of is_admin(). Same class of bug security_hardening.sql
-- fixed elsewhere in this project.
create or replace view builds_audit_log
with (security_invoker = true)
as
select
  id, record_id, operation,
  old_data ->> 'tracking_code' as old_tracking_code,
  new_data ->> 'tracking_code' as new_tracking_code,
  old_data ->> 'title' as old_title,
  new_data ->> 'title' as new_title,
  old_data ->> 'status' as old_status,
  new_data ->> 'status' as new_status,
  changed_by_email, changed_at,
  old_data, new_data
from audit_log
where table_name = 'builds'
order by changed_at desc;

grant select on builds_audit_log to authenticated;
