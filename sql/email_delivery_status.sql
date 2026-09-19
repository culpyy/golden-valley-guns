-- Email delivery status (2026-09-18). Run in the Supabase SQL editor.
--
-- email_log's `status` column only ever meant "Resend's API accepted the
-- send request" - never whether the email actually reached an inbox,
-- bounced, or got marked as spam. That gap is exactly what let "the
-- customer says they never got it" turn into an unanswerable question -
-- Resend's own dashboard has the real answer, but nobody here had a way to
-- see it without a Resend login. A webhook (src/api/resendWebhook.js) now
-- reports Resend's real delivery events back into this table.

alter table email_log add column if not exists resend_id text;
alter table email_log add column if not exists delivery_status text; -- 'delivered' | 'bounced' | 'complained' | 'delayed', null until Resend reports one
alter table email_log add column if not exists delivery_status_at timestamptz;
alter table email_log add column if not exists delivery_detail text; -- bounce/complaint reason text, when Resend provides one

create index if not exists email_log_resend_id_idx on email_log (resend_id);
