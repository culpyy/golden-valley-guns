-- Customer reviews, gated to completed builds. Run in the Supabase SQL editor.
--
-- Flow: once a build's payment_status flips to 'paid' (src/lib/reviews.js,
-- called from src/api/pay.js and admin-dashboard.html's "Mark Paid" path),
-- the customer gets an emailed link with a one-time token. They land on
-- review.html, submit a rating + text, which lands as status='pending'.
-- An admin approves or rejects it from the new Reviews tab; only 'approved'
-- rows are ever public.
--
-- The raw table is admin-only, same as builds/orders - it holds the
-- customer's email indirectly (via the build join) and an unpublished
-- draft's contents shouldn't be guessable/enumerable. review.html never
-- queries this table directly with the anon key; it goes through
-- GET/POST /api/reviews (src/api/reviews.js), which uses the service_role
-- key server-side to look up by token - same pattern src/api/pay.js
-- already uses for orders.pay_token.
create table reviews (
  id            uuid primary key default gen_random_uuid(),
  build_id      uuid not null references builds(id) on delete cascade,
  token         text not null unique,
  -- Snapshotted from the build at invite time, not joined live - so a
  -- review still reads correctly even if the build is later renamed/
  -- deleted, and so the public view (below) never needs to touch the
  -- admin-only builds table at read time.
  customer_name text,
  build_title   text,
  rating        smallint check (rating between 1 and 5),
  review_text   text,
  status        text not null default 'invited'
                  check (status in ('invited', 'pending', 'approved', 'rejected')),
  invited_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- One invite per build - sendReviewInvite() checks this before inserting,
-- but the constraint is the real backstop against a double-send race.
create unique index reviews_build_id_idx on reviews(build_id);

alter table reviews enable row level security;

create policy "Admin read/write reviews"
  on reviews for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- No public policy on the raw table at all - anon has zero access, by
-- design (see header comment). Token-gated lookups go through the Worker,
-- not direct PostgREST access.
grant select, insert, update, delete on reviews to authenticated;

-- What the public reviews page actually queries - only ever rows an admin
-- has explicitly approved, and only the columns that are safe to show
-- (no token, no build_id).
create view reviews_public as
  select id, customer_name, build_title, rating, review_text, created_at
  from reviews
  where status = 'approved'
  order by created_at desc;

grant select on reviews_public to anon, authenticated;
