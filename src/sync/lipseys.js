// Reference implementation for the distributor catalog sync pattern.
// Lipsey's has the best-documented dealer API of the four distributors, so
// this one is built out in full; rsr.js, davidsons.js, and orion.js follow the
// same shape once each account/API is confirmed live.
//
// Required secrets/vars (see wrangler.jsonc for non-secret vars, use
// `wrangler secret put NAME` for the rest):
//   LIPSEYS_EMAIL              - Lipsey's dealer account email (secret)
//   LIPSEYS_PASSWORD           - Lipsey's dealer account password (secret)
//   SUPABASE_URL               - already set as a plain var in wrangler.jsonc
//   SUPABASE_SERVICE_ROLE_KEY  - Project Settings > API > service_role (secret, NOT the anon key)
//   LIPSEYS_RELAY_URL          - e.g. https://lipseys-relay.goldenvalleygunsllc.com (secret - see relay/)
//   LIPSEYS_RELAY_SECRET       - shared secret the relay checks, must match its RELAY_SHARED_SECRET (secret)
//
// Verified 2026-07-16 against a live response (18,987 items). Auth uses a
// custom `Token` header (NOT `Authorization: Bearer`), and CatalogFeed wraps
// items in a top-level `data` array, not `items`.
//
// 2026-07-17: now also captures item.retailMap (per-SKU manufacturer MAP
// floor) so the site's displayed price can never undercut it, regardless of
// the flat catalog_markup_pct - see sql/distributor_catalog.sql block 7.
// Lipsey's dealer agreement requires adhering to every manufacturer's MAP
// program; a flat percentage markup alone doesn't guarantee that on its own.
//
// 2026-07-18: PAUSED (see SYNC_JOBS in src/worker.js) pending Lipsey's
// approval of the API Access Request (domain + relay/'s static IP submitted,
// see relay/ for why Cloudflare Workers needed a dedicated relay for this).
// Image hotlinking is now fixed below - images get downloaded to our own R2
// bucket instead of linking lipseyscloud.com directly, per their explicit
// "do not hotlink our images" rule.
//
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts } from '../lib/catalogSync.js';
import { cacheImage, imageKey } from '../lib/imageCache.js';

function relayBase(env) {
  if (!env.LIPSEYS_RELAY_URL || !env.LIPSEYS_RELAY_SECRET) {
    throw new Error('LIPSEYS_RELAY_URL and LIPSEYS_RELAY_SECRET must be set (wrangler secret put) - direct calls to api.lipseys.com are not used, see relay/.');
  }
  return env.LIPSEYS_RELAY_URL;
}

function relayHeaders(env, extra = {}) {
  return { 'X-Relay-Secret': env.LIPSEYS_RELAY_SECRET, ...extra };
}

// CatalogFeed only returns a bare filename (item.imageName), not a URL.
// Lipsey's own dealer portal (SPA at www.lipseys.com) loads product photos
// from lipseyscloud.com - found by pulling their app bundle and finding the
// base path, then verified with a live 200 against a real filename. Not
// documented anywhere public, confirmed 2026-07-16.
const LIPSEYS_IMAGE_BASE = 'https://www.lipseyscloud.com/images';

async function login(env) {
  const res = await fetch(`${relayBase(env)}/api/Integration/Authentication/Login`, {
    method: 'POST',
    headers: relayHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      Email: env.LIPSEYS_EMAIL,
      Password: env.LIPSEYS_PASSWORD
    })
  });
  if (!res.ok) throw new Error(`Lipsey's login failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function fetchCatalog(env, token) {
  const res = await fetch(`${relayBase(env)}/api/Integration/Items/CatalogFeed`, {
    headers: relayHeaders(env, { Token: token })
  });
  if (!res.ok) throw new Error(`Lipsey's catalog fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.data || []);
}

function mapCategory(item) {
  const type = (item.itemType || '').toLowerCase();
  if (item.fflRequired) return 'firearms';
  if (type.includes('ammo')) return 'ammo';
  return 'parts';
}

// item.type carries Lipsey's granular classification (13 distinct values as
// of 2026-07-16, e.g. "Semi-Auto Pistol" vs "Revolver" vs "Specialty
// Handgun") - too fine-grained for a shopper-facing filter, so bucket down
// to the handful of categories a customer actually thinks in.
function mapFirearmType(item) {
  const type = (item.type || '').toLowerCase();
  if (type.includes('pistol') || type.includes('revolver')) return 'Handgun';
  if (type.includes('rifle')) return 'Rifle';
  if (type.includes('shotgun')) return 'Shotgun';
  if (type.includes('muzzleloader')) return 'Muzzleloader';
  return 'Other';
}

// Returns null (never NaN) for anything that isn't finite, so a value like
// "Call" or "N/A" from the feed can be detected and the item skipped instead
// of silently becoming a $0 listing or a NaN that fails the whole batch upsert.
function safeNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Returns null for normalize() to signal "skip this item" - keeps one
// malformed distributor record from taking down the entire sync batch.
// syncTime is stamped onto every item from this run so upsertDistributorProducts
// can identify stale rows by comparison instead of listing every current SKU.
function normalize(item, syncTime) {
  const dealerCost = safeNumber(item.currentPrice ?? item.price);
  if (dealerCost === null || !item.itemNo) return null;

  const quantity = parseInt(item.quantity, 10);
  const msrp = item.msrp ? safeNumber(item.msrp) : null;
  // Lipsey's dealer agreement requires adhering to each manufacturer's MAP
  // program - retailMap is that per-item floor straight from the feed, not
  // something we compute. distributor_products_public's price calc takes the
  // greater of (dealer_cost * markup%) and this, so a flat markup% can never
  // accidentally undercut a manufacturer's actual MAP on a given SKU.
  const retailMap = item.retailMap ? safeNumber(item.retailMap) : null;

  return {
    distributor: 'lipseys',
    distributor_sku: String(item.itemNo),
    upc: item.upc || null,
    name: item.description1 || 'Unnamed item',
    manufacturer: item.manufacturer || null,
    category: mapCategory(item),
    caliber: item.caliberGauge || null,
    firearm_type: item.fflRequired ? mapFirearmType(item) : null,
    description: item.description1 || '',
    dealer_cost: dealerCost,
    msrp,
    retail_map: retailMap,
    quantity_available: Number.isFinite(quantity) ? quantity : 0,
    // Temporary - holds Lipsey's own CDN URL only long enough for
    // cacheImagesForItems() below to download it. Never written to Supabase;
    // stripped out and replaced with our own R2-backed URL before upsert.
    image_url: item.imageName ? `${LIPSEYS_IMAGE_BASE}/${item.imageName}` : null,
    _imageName: item.imageName || null,
    is_firearm: !!item.fflRequired,
    last_synced_at: syncTime
  };
}

// Only ever called on the allow-listed subset (post-filterByAllowList), not
// the full ~19k raw catalog - no point downloading photos for items we're
// not even going to display. Capped at MAX_NEW_IMAGES_PER_RUN new downloads
// per sync so a large first-time allow-list doesn't blow past a single
// Worker invocation's subrequest/CPU budget - already-cached images (the
// common case after the first run) don't count against the cap, so this
// only slows down the initial backfill, spreading it across a few daily
// cron runs rather than doing it all at once.
const IMAGE_CONCURRENCY = 8;
const MAX_NEW_IMAGES_PER_RUN = 200;

async function cacheImagesForItems(env, items) {
  let newDownloads = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const { image_url: sourceUrl, _imageName: filename } = item;
      delete item._imageName;
      if (!sourceUrl || !filename) {
        item.image_url = null;
        continue;
      }

      const alreadyCached = await env.DISTRIBUTOR_IMAGES.head(imageKey('lipseys', filename));
      if (!alreadyCached && newDownloads >= MAX_NEW_IMAGES_PER_RUN) {
        // Never fall back to hotlinking - no image this run rather than a
        // compliance violation. Still uncached, so next run's head() check
        // will correctly treat it as new and cache it then.
        item.image_url = null;
        continue;
      }

      const cached = await cacheImage(env, { sourceUrl, prefix: 'lipseys', filename });
      if (cached) {
        if (!alreadyCached) newDownloads++;
        item.image_url = cached;
      } else {
        item.image_url = null; // couldn't fetch/cache - never fall back to hotlinking
      }
    }
  }

  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
  return items;
}

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  const token = await login(env);
  const rawItems = await fetchCatalog(env, token);
  const allowList = await getAllowedManufacturers(supabase);
  const syncTime = new Date().toISOString();
  const normalized = rawItems.map(item => normalize(item, syncTime)).filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);
  const withCachedImages = await cacheImagesForItems(env, filtered);
  await upsertDistributorProducts(supabase, 'lipseys', withCachedImages, syncTime);
  return withCachedImages.length;
}
