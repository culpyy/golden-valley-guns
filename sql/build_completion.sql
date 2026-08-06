-- Adds a real "done and out the door" marker, separate from the Ready
-- status. Ready already means "built, waiting for pickup" (js/main.js's
-- STATUS_DESCRIPTIONS) - but there was never a marker for "customer actually
-- picked it up, this is fully closed out." Builds just sat in the Active
-- Builds table forever at Ready until Shawn manually deleted them, and
-- there was no way to see how many builds had actually been finished over
-- time. completed_at being non-null is what moves a build out of the
-- active list into a separate Completed Builds section in the admin
-- dashboard, and its count is the running "how many guns finished" total.
alter table builds add column if not exists completed_at timestamptz;
