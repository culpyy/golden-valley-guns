-- Fixes a race condition in the chunked distributor-catalog sync (Lipsey's/
-- Orion/Davidson's, see src/sync/*.js): the cursor that tracks "how far
-- through the catalog has this cycle gotten" was a plain read (before the
-- slow catalog fetch) then a separate write (after processing the chunk) -
-- same read-then-write shape as the stock-oversell bug already fixed in
-- sql/atomic_stock_reservation.sql, just never given the same fix here. If
-- two invocations of the same distributor's sync ever overlap (a stuck prior
-- run still going when the next cron tick fires, or a manual test run racing
-- a live cron), both can claim the same chunk and both advance the cursor by
-- the same amount, silently skipping the chunk that should have run next -
-- and upsertDistributorProducts' stale-cleanup pass then incorrectly zeroes
-- out those skipped, still-real-in-stock items as "delisted" once the cycle
-- completes. Run in the Supabase SQL editor.
--
-- The fix: claim a chunk atomically in one function call - a SELECT ... FOR
-- UPDATE takes a row lock on the cursor's site_content row for the duration
-- of the function, so a second concurrent call genuinely blocks until the
-- first one finishes advancing the cursor, then sees the already-advanced
-- value. This has to be plpgsql (not the single-statement `language sql`
-- style used for the stock functions) because it needs the explicit
-- SELECT...FOR UPDATE step, not just an atomic column increment.
create or replace function claim_sync_chunk(p_key text, p_chunk_size int, p_total_items int)
returns int
language plpgsql
as $$
declare
  v_cursor int;
begin
  insert into site_content (key, value) values (p_key, '0')
  on conflict (key) do nothing;

  select coalesce(value, '0')::int into v_cursor
  from site_content
  where key = p_key
  for update;

  -- Catalog shrank since this cursor position was saved (allow-list
  -- narrowed, distributor's own catalog got smaller) - start the cycle over
  -- rather than slicing past the end of the array.
  if v_cursor >= p_total_items then
    v_cursor := 0;
  end if;

  update site_content
  set value = case
        when v_cursor + p_chunk_size >= p_total_items then '0'
        else (v_cursor + p_chunk_size)::text
      end,
      updated_at = now()
  where key = p_key;

  return v_cursor;
end;
$$;

revoke execute on function claim_sync_chunk(text, int, int) from anon, authenticated;
