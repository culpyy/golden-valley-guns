-- Lets Shawn attach a carrier tracking number to an order once he's shipped
-- it (either directly to a customer, sql/direct_shipping.sql, or FFL-to-FFL,
-- sql/ffl_transfer.sql) and have the customer notified automatically.
-- Requested directly by Shawn (his wife flagged customers weren't getting
-- tracking numbers) - previously there was no way to record or send one at
-- all once a label was bought outside the site. Run in the Supabase SQL
-- editor.
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists carrier text;
alter table orders add column if not exists shipped_at timestamptz;
