-- Streamlines intake.html - until now it was pure client-side (fill out a
-- form, print a slip, done), so nothing about an incoming shipment ever
-- reached Shawn until the physical box showed up and he manually re-typed
-- everything into a new Build. Same shape of gap as the old contact-form
-- problem: real customer data dead-ending instead of flowing into the
-- system. Run in the Supabase SQL editor.
--
-- The printable slip stays exactly as it was (customers should still
-- include it in the box) - this is purely additive, saving a copy of the
-- same data so Shawn can see it coming before the package arrives.

create table intake_submissions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text,
  phone        text,
  service      text not null,
  firearm_type text,
  caliber      text,
  is_nfa       boolean not null default false,
  notes        text,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Same is_admin() pattern as contact_submissions/orders - written only by
-- the Worker (service-role key, see src/api/intake.js), no anon/authenticated
-- insert policy needed for that path.
alter table intake_submissions enable row level security;

create policy "Admin read intake submissions"
  on intake_submissions for select
  to authenticated
  using (is_admin());

create policy "Admin update intake submissions"
  on intake_submissions for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Admin delete intake submissions"
  on intake_submissions for delete
  to authenticated
  using (is_admin());
