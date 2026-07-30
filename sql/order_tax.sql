-- Adds tax_amount so orders track Arizona TPT separately from the item
-- subtotal. Run in the Supabase SQL editor. See src/api/checkout.js for the
-- actual 5.6% rate calculation (Golden Valley / Mohave County has no county
-- or city add-on over the state rate, and Arizona sources a single-location
-- in-state seller's sales to its own business address, not the customer's -
-- confirmed against A.R.S. 42-5061 and AZ's origin-sourcing rule, 2026-07-29).
alter table orders add column tax_amount numeric not null default 0;
