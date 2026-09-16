-- The intake form only ever captured a generic Firearm Type (Rifle, SBR,
-- etc.) and Caliber - no structured field for which actual kit/platform a
-- customer was sending (PM12, HK33, AK-47, Suomi...). That info either
-- never got written down or got buried inside the free-text Notes, so when
-- Shawn created a Build from the intake row the title was left blank for
-- him to fill in from memory, and builds often ended up on the in-shop
-- board showing nothing more specific than "Short-Barreled Rifle · 9mm" -
-- indistinguishable from every other SBR intake. Purely additive column,
-- nullable, existing rows unaffected. Run in the Supabase SQL editor.

alter table intake_submissions add column kit_type text;
