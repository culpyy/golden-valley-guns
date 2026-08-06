-- Exposes completed_at on builds_public so the public site can show a real
-- "X builds completed" count (index.html, gallery.html) instead of that
-- number only existing in the admin dashboard. No new PII exposure -
-- builds_public already excludes customer_name/email/phone, and a
-- completion timestamp is no more sensitive than the status/progress
-- fields already on this view.
-- New columns must be appended at the end of the SELECT list, not inserted
-- among the existing ones - CREATE OR REPLACE VIEW treats a mid-list
-- insertion as renaming whatever existing column it displaced (same
-- gotcha noted in sql/build_gallery.sql).
create or replace view builds_public as
select
  id, title, type, caliber, status, progress, received, eta,
  atf_form, atf_filed, tracking_code, notes, is_nfa,
  created_at, updated_at,
  photo_url, is_showcase,
  completed_at
from builds;

grant select on builds_public to anon, authenticated;
