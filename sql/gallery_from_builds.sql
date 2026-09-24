-- Completed builds become plain gallery posts (title, type, caliber, date,
-- photos/video) the moment Shawn clicks Mark Complete - the full build
-- record (customer, ATF fields, price, notes) stays in the database as a
-- private archive but leaves the admin's Builds tab. Additive only: nothing
-- is dropped or rewritten. Run in the Supabase SQL editor.
--
-- gallery_projects.completed_at : real completion date, shown on the post
--                                 (null for posts that never were a build)
-- gallery_projects.build_id     : which build a post came from, so Mark
--                                 Complete can't create it twice
-- builds.archived_at            : set on conversion; hides the build from
--                                 the admin Builds/Completed lists
alter table gallery_projects add column if not exists completed_at timestamptz;
alter table gallery_projects add column if not exists build_id uuid references builds(id) on delete set null;
alter table builds add column if not exists archived_at timestamptz;
