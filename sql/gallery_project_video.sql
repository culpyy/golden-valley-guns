-- Adds video support to gallery project media (Shawn wants a test-fire
-- video as the closing item in a build's before/after showcase, alongside
-- photos). gallery_project_photos already stores one row per media item
-- with an ordered `position`, so a video is just another row - no new
-- table needed, just a column saying which kind of file photo_url points
-- at. Run in the Supabase SQL editor.

alter table gallery_project_photos
  add column media_type text not null default 'image'
    check (media_type in ('image', 'video'));
