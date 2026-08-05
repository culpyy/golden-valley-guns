-- Adds a short reference code customers write on the OUTSIDE of their box
-- before shipping - the real problem this solves (per Shawn's own experience)
-- is unlabeled/unmarked packages showing up with no way to match them to
-- anything. Previously the only "code" in this whole flow was the build
-- tracking code, and that didn't exist until Shawn manually created a Build
-- AFTER the box already arrived - too late to be written on the box itself.
-- This one is generated the moment the customer submits intake.html, so it's
-- available before they ever tape the box shut. Run in the Supabase SQL editor.
alter table intake_submissions add column if not exists intake_code text unique;
