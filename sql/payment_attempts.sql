-- Payment attempt history (2026-09-18). Run in the Supabase SQL editor.
--
-- orders.authorize_net_response holds only the MOST RECENT charge attempt -
-- every retry silently overwrites whatever came before. That's exactly what
-- made a real customer decline unrecoverable after a second attempt
-- succeeded: the first attempt's actual reason was gone, with no way to
-- tell Shawn what really happened or what to tell the customer next time.
-- This table keeps every attempt, not just the last one.

create table if not exists payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  approved boolean not null,
  response_code text,       -- Authorize.net responseCode: 1 approved, 2 declined, 3 error, 4 held for review
  error_code text,          -- e.g. "44" (declined), "11" (duplicate transaction)
  error_text text,          -- Authorize.net's own message
  cvv_result_code text,     -- M match, N no match, P not processed, S issuer doesn't support, U unavailable
  avs_result_code text,
  transaction_id text,
  plain_reason text,        -- src/lib/paymentAttempts.js's human-readable translation, for admin display
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_attempts_order_id_idx on payment_attempts (order_id);
create index if not exists payment_attempts_created_at_idx on payment_attempts (created_at desc);

-- Same posture as email_log: admins can read it, only the service-role
-- client (src/lib/paymentAttempts.js, called from checkout.js/pay.js) ever
-- writes to it.
alter table payment_attempts enable row level security;

drop policy if exists "Admin read payment_attempts" on payment_attempts;
create policy "Admin read payment_attempts"
  on payment_attempts for select
  using (is_admin());
