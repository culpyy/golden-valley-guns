-- Email log (2026-08-31). Run in the Supabase SQL editor.
--
-- Every send through src/lib/email.js currently leaves no trace anywhere -
-- Resend either delivers it or doesn't, and the only way to know after the
-- fact is a Resend dashboard login nobody readily has. That's exactly what
-- made "did Doug ever get his ready-for-pickup email" take a real
-- investigation instead of a 10-second query. This logs every attempt
-- (sent or failed) so that question is always just a query away.

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  sent_to text not null,
  subject text,
  source text,               -- which code path sent it: 'build_status', 'order_confirmation', etc.
  status text not null,      -- 'sent' | 'failed'
  error_message text,        -- null when status = 'sent'
  related_table text,        -- e.g. 'builds', 'orders' - optional context, no FK constraint since it can point to different tables
  related_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists email_log_related_idx on email_log (related_table, related_id);
create index if not exists email_log_sent_to_idx on email_log (sent_to);
create index if not exists email_log_created_at_idx on email_log (created_at desc);

-- Same posture as audit_log: admins can read it, nobody writes to it
-- directly (writes only happen from sendEmail() itself, via the service-
-- role client, which bypasses RLS - no insert policy needed or wanted here).
alter table email_log enable row level security;

drop policy if exists "Admin read email_log" on email_log;
create policy "Admin read email_log"
  on email_log for select
  using (is_admin());
