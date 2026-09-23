-- Fulfillment info for orders paid OFFLINE (money order, check, cash).
-- Run in the Supabase SQL editor.
--
-- Online payments collect "pickup or transfer to my FFL" on the secure pay
-- link (pay.html). An order Shawn marks Paid by hand never passes through
-- it, so nothing captured how the customer wants a firearm delivered or who
-- the receiving FFL is. src/api/fulfillment.js emails the customer a
-- tokenized link (fulfillment.html) and Shawn can also enter it himself.
alter table orders add column if not exists fulfillment_token text unique;
alter table orders add column if not exists fulfillment_requested_at timestamptz;
alter table orders add column if not exists fulfillment_submitted_at timestamptz;
-- 'customer' = they filled the emailed form, 'admin' = Shawn entered it.
alter table orders add column if not exists fulfillment_source text;
