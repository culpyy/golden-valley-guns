// Orion Wholesale (orionfflsales.com) catalog sync. Same shape as
// sync/lipseys.js - see that file for the full pattern this follows
// (chunked cursor processing, allow-list filtering, image backfill).
//
// Required secret (set with `wrangler secret put ORION_API_KEY`):
//   ORION_API_KEY
//
// Verified live 2026-07-24 against Orion's real API (not just their Postman
// doc examples) with Shawn's real dealer key:
//   - Auth is a single `Connection-Key: <key>` header on every request - no
//     login step, no IP allowlist/relay needed (unlike Lipsey's), confirmed
//     working from an arbitrary IP.
//   - GET https://orionfflsales.com/api.php?method=get_catalog with no
//     product_ids returns the ENTIRE catalog, unpaginated: 15,226 products,
//     ~25MB of JSON. Same chunked-cursor treatment as Lipsey's 19K-item feed
//     is needed for the same reason (Workers Free plan CPU budget) - only
//     per-item normalize/filter work is chunked. The fetch+parse cost is
//     only paid once per cursor cycle now, not every run (see
//     getCatalogItems / CATALOG_CACHE_KEY below).
//   - get_catalog_inventory (also unpaginated, ~17,800 entries) is a
//     SEPARATE call - quantity isn't in the catalog response at all.
//   - IMPORTANT gotcha caught during live verification: inventory's
//     `sale_price` field is NOT a retail price - checked a real product and
//     it's identical to that same item's catalog `base_cost` (dealer's
//     wholesale cost). Ignored entirely; dealer_cost comes from catalog's
//     base_cost, which is present on every item.
//   - `manufacturer_advertised_price` is Orion's actual per-item MAP field
//     (only ~40% of items have it set) - treated as retail_map, same
//     enforcement as Lipsey's retailMap (distributor_products_public takes
//     GREATEST(markup price, retail_map) - see sql/distributor_catalog.sql).
//     `list_price` is informational only (mapped to msrp), not enforced.
//   - Firearms are flagged via `FFL_REQUIRED` in product_tags (comma
//     string, not an array). cannot_dropship / restricted_states exist on
//     some items but aren't enforced anywhere yet (checkout has no
//     state-restriction logic at all currently) - not a new gap introduced
//     here, just not solved by this sync either. Worth flagging if Orion
//     accessories/ammo (not firearms - those never ship anyway, in-person
//     FFL transfer only) ever actually go live for purchase.
//   - Images: catalog gives a real, direct image_url per item (unlike
//     Lipsey's, which only gives a bare filename) - still cached to our own
//     R2 bucket rather than hotlinked, same courtesy as every other
//     distributor here, via the shared backfillImages() pass.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts, getSyncCursor, claimSyncChunk, getCycleStart, setCycleStart } from '../lib/catalogSync.js';
import { backfillImages } from '../lib/imageCache.js';

const API_BASE = 'https://orionfflsales.com/api.php';

async function orionFetch(env, method, extraParams = '') {
  if (!env.ORION_API_KEY) {
    throw new Error('ORION_API_KEY must be set (wrangler secret put).');
  }
  const res = await fetch(`${API_BASE}?method=${method}${extraParams}`, {
    headers: { 'Connection-Key': env.ORION_API_KEY }
  });
  if (!res.ok) throw new Error(`Orion ${method} failed: ${res.status}`);
  const data = await res.json();
  if (data.result && data.result !== 'OK') throw new Error(`Orion ${method} returned: ${data.result}`);
  return data;
}

async function fetchCatalog(env) {
  const data = await orionFetch(env, 'get_catalog');
  return Array.isArray(data.products) ? data.products : [];
}

// get_catalog is ~25MB unpaginated and doesn't change meaningfully within a
// single ~11-run cursor cycle (see CHUNK_SIZE below) - same reasoning as
// Lipsey's CatalogFeed (src/sync/lipseys.js). Only the run that starts a new
// cycle (cursor === 0) actually re-fetches it from Orion; every other run in
// that cycle reads the same raw JSON back from R2 instead.
//
// fetchInventoryMap is deliberately NOT cached this way - stock counts are
// exactly the data a sync job exists to keep fresh, and at ~17,800 small
// {id: quantity} entries it's nowhere near the multi-MB cost the catalog is.
const CATALOG_CACHE_KEY = 'catalog-cache/orion.json';

async function getCatalogItems(env, forceRefresh) {
  if (!forceRefresh) {
    const cached = await env.DISTRIBUTOR_IMAGES.get(CATALOG_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(await cached.text());
      } catch {
        // Fall through to a live refetch rather than failing the run over a
        // corrupted cache object.
      }
    }
  }
  const items = await fetchCatalog(env);
  await env.DISTRIBUTOR_IMAGES.put(CATALOG_CACHE_KEY, JSON.stringify(items), {
    httpMetadata: { contentType: 'application/json' }
  });
  return items;
}

// Keyed by product_id (the object keys in product_inventory are the same
// product_id values as the catalog, just as strings).
async function fetchInventoryMap(env) {
  const data = await orionFetch(env, 'get_catalog_inventory');
  const map = new Map();
  for (const [id, entry] of Object.entries(data.product_inventory || {})) {
    const qty = parseInt(entry?.quantity, 10);
    map.set(String(id), Number.isFinite(qty) ? qty : 0);
  }
  return map;
}

// Catalog items' product_manufacturer is NOT a display name - it's the same
// code as product_manufacturer_code below (e.g. "BERETTA_USA",
// "AMERICAN_TACTICAL", some even truncated like "ANDERSON_MANUFACTURI").
// Confirmed live 2026-07-24 while investigating why the shop page's
// Manufacturer filter looked broken/duplicated against Lipsey's clean names
// ("Browning" vs raw code "BROWNING" was the least of it - most codes don't
// even resemble a real name). get_manufacturers is the real code -> name
// lookup (2,582 entries) - without it, browsing "Distributor Stock" showed
// underscored codes as separate manufacturer facets that could never blend
// with Lipsey's naturally-named rows for the same real-world brand.
async function fetchManufacturerMap(env) {
  const data = await orionFetch(env, 'get_manufacturers');
  const map = new Map();
  for (const m of data.manufacturers || []) {
    if (m.product_manufacturer_code) map.set(m.product_manufacturer_code, m.description || m.product_manufacturer_code);
  }
  return map;
}

// Cached in site_content (same table catalogSync.js's cursor/cycle-start
// bookkeeping already uses) rather than refetched every chunked run - see
// the comment in run() for why. A brand-new sync (nothing cached yet) falls
// back to an empty map rather than erroring, which just means manufacturer
// names show as raw codes until the next cursor === 0 refetch completes.
async function getCachedManufacturerMap(supabase) {
  const { data, error } = await supabase.from('site_content').select('value').eq('key', 'orion_manufacturer_map').maybeSingle();
  if (error || !data?.value) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(data.value)));
  } catch {
    return new Map();
  }
}

async function setCachedManufacturerMap(supabase, map) {
  const value = JSON.stringify(Object.fromEntries(map));
  const { error } = await supabase.from('site_content').upsert({ key: 'orion_manufacturer_map', value }, { onConflict: 'key' });
  if (error) throw error;
}

function mapCategory(item, tags) {
  if (tags.has('FFL_REQUIRED')) return 'firearms';
  const cats = (item.product_categories || '').toUpperCase();
  if (cats.includes('AMMO') || cats.includes('AMMUNITION')) return 'ammo';
  return 'parts';
}

// Same target vocabulary as Lipsey's mapFirearmType, so the shop page's
// firearm-type filter behaves consistently regardless of which distributor
// an item came from. Orion's facets.FIREARM_TYPE is already fairly clean
// human text (e.g. "Shotgun", "Pistol"), just needs bucketing to match.
function mapFirearmType(facets) {
  const type = (facets?.FIREARM_TYPE || '').toLowerCase();
  if (type.includes('pistol') || type.includes('revolver')) return 'Handgun';
  if (type.includes('rifle')) return 'Rifle';
  if (type.includes('shotgun')) return 'Shotgun';
  if (type.includes('muzzleloader')) return 'Muzzleloader';
  return 'Other';
}

function safeNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(item, quantityMap, manufacturerMap, syncTime) {
  const dealerCost = safeNumber(item.base_cost);
  if (dealerCost === null || !item.product_code) return null;

  const tags = new Set((item.product_tags || '').split(',').map(t => t.trim()).filter(Boolean));
  const isFirearm = tags.has('FFL_REQUIRED');
  const quantity = quantityMap.get(String(item.product_id)) ?? 0;
  // Falls back to the raw code if a code is somehow missing from the lookup
  // (safer than dropping the item entirely over a manufacturer-name gap) -
  // still better than nothing, just won't blend with Lipsey's naming for
  // that one brand until Orion's own reference data catches up.
  const manufacturer = item.product_manufacturer
    ? (manufacturerMap.get(item.product_manufacturer) || item.product_manufacturer)
    : null;

  return {
    distributor: 'orion',
    distributor_sku: String(item.product_code),
    upc: item.upc_code || null,
    name: item.description || 'Unnamed item',
    manufacturer,
    category: mapCategory(item, tags),
    caliber: item.facets?.CALIBER || null,
    firearm_type: isFirearm ? mapFirearmType(item.facets) : null,
    description: item.detailed_description || item.description || '',
    dealer_cost: dealerCost,
    msrp: safeNumber(item.list_price),
    retail_map: safeNumber(item.manufacturer_advertised_price),
    quantity_available: quantity,
    // Full URL already, unlike Lipsey's bare filename - stashed as the
    // "source name" backfillImages expects, buildSourceUrl below is just
    // the identity function since there's no base path to reconstruct.
    image_source_name: item.image_url || null,
    is_firearm: isFirearm,
    last_synced_at: syncTime
  };
}

// Same CPU-budget reasoning as Lipsey's (see sync/lipseys.js) - Orion's
// unpaginated get_catalog is comparable in size (15,226 items vs Lipsey's
// ~19,000), confirmed live 2026-07-24.
const CHUNK_SIZE = 1500;

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  // The catalog (~25MB) and the manufacturer lookup (2,582 entries) only
  // need refetching once per cycle (cursor === 0), not every chunked run -
  // neither changes meaningfully between a distributor's own sync runs, and
  // skipping the refetch on every other chunk keeps this run's subrequest
  // count down (see the subrequest-limit incident this sync already hit
  // once, further down). See getCatalogItems above and
  // getCachedManufacturerMap below for where each is cached.
  // Just a cheap peek to decide whether to bypass the catalog/manufacturer
  // caches below - doesn't need to be race-free, the actual chunk claim
  // happens atomically right before slicing (see claimSyncChunk).
  const cursorPeek = await getSyncCursor(supabase, 'orion');
  const isCycleStartPeek = cursorPeek === 0;

  const [rawItems, quantityMap, manufacturerMap] = await Promise.all([
    getCatalogItems(env, isCycleStartPeek),
    fetchInventoryMap(env),
    isCycleStartPeek ? fetchManufacturerMap(env) : getCachedManufacturerMap(supabase)
  ]);
  const allowList = await getAllowedManufacturers(supabase);
  const syncTime = new Date().toISOString();

  // Atomic claim - see sql/atomic_sync_cursor.sql and the equivalent comment
  // in sync/lipseys.js. Doing this after the slow catalog/inventory fetch
  // above but right before the chunk is sliced keeps the race window down
  // to a single DB round trip.
  const cursor = await claimSyncChunk(supabase, 'orion', CHUNK_SIZE, rawItems.length);
  const isCycleStart = cursor === 0;

  let cycleStart = await getCycleStart(supabase, 'orion');
  if (cursor === 0 || !cycleStart) {
    cycleStart = syncTime;
    await setCycleStart(supabase, 'orion', cycleStart);
  }

  if (isCycleStart) await setCachedManufacturerMap(supabase, manufacturerMap);

  const chunk = rawItems.slice(cursor, cursor + CHUNK_SIZE);
  const normalized = chunk.map(item => normalize(item, quantityMap, manufacturerMap, syncTime)).filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);

  const cycleComplete = cursor + CHUNK_SIZE >= rawItems.length;

  await upsertDistributorProducts(supabase, 'orion', filtered, syncTime, cycleComplete ? cycleStart : null);

  // Deliberately NOT calling backfillOrionImages() inline here (unlike
  // lipseys.js, which does). Verified live 2026-07-24: on a cold start with
  // zero images cached yet, the up-to-28-image backfill loop alone (each
  // image costs an R2 head + fetch + R2 put = 3 subrequests) combined with
  // the catalog+inventory fetch and Supabase calls already in this same
  // invocation blew "Too many subrequests by single Worker invocation."
  // Lipsey's gets away with the inline call today only because its image
  // backlog is already mostly drained after days of the dedicated 10-min
  // IMAGE_BACKFILL_CRON catching up - it hit this exact same failure on ITS
  // first live run too. Orion relies solely on that same cron (see
  // backfillOrionImages wiring in worker.js) to avoid repeating it.

  return filtered.length;
}

// Mirrors backfillLipseysImages - same reasoning (inline image fetching
// during the main sync blew Cloudflare's subrequest-per-invocation limit on
// Lipsey's first live run). buildSourceUrl is the identity function since
// Orion's image_url is already a complete, direct URL.
const BACKFILL_LIMIT = 28;

export async function backfillOrionImages(env, supabase = getSupabaseAdmin(env)) {
  return backfillImages(supabase, env, {
    distributor: 'orion',
    prefix: 'orion',
    buildSourceUrl: (url) => url,
    limit: BACKFILL_LIMIT
  });
}
