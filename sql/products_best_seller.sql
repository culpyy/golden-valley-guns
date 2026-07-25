-- Adds a manual "Best Seller" flag to Shawn's own products, so shop.html can
-- surface a featured strip instead of dumping the full catalog on a visitor
-- with no curation. Run in the Supabase SQL editor.
--
-- Manual (not computed from order history) because there isn't real sales
-- history to compute from yet - products table only just started getting
-- real inventory. Same reasoning as builds.is_showcase: a human curatorial
-- signal now, real analytics later once there's actual data to aggregate.
alter table products add column if not exists is_best_seller boolean not null default false;
