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
// 2026-07-18: API access approved by Lipsey's, requests route through
// relay/ (see LIPSEYS_RELAY_URL/SECRET above) since Cloudflare Workers have
// no stable IPv4 to whitelist directly.
//
// 2026-07-18: images are no longer fetched/cached inline during the main
// sync - the first live run after approval blew Cloudflare's
// subrequest-per-invocation limit doing exactly that (hundreds of items
// matched across the allow-listed manufacturers, and even the download cap
// alone was too many fetches for one invocation - upsertDistributorProducts
// never even ran). normalize() now leaves image_url null and stashes the
// filename in image_source_name; a separate tightly-bounded pass
// (backfillImages, called at the end of run()) catches up ~20 images per
// sync so pricing/stock data is never blocked waiting on images again.
//
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts, getSyncCursor, setSyncCursor, getCycleStart, setCycleStart } from '../lib/catalogSync.js';
import { backfillImages } from '../lib/imageCache.js';

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

// The raw catalog doesn't change meaningfully within a single ~13-run cursor
// cycle (see CHUNK_SIZE below), so only the run that starts a new cycle
// (cursor === 0) actually logs in and hits Lipsey's relay - every other run
// in that cycle reads the same raw JSON back from R2 instead. Cuts ~12 of
// every 13 runs' worth of login+CatalogFeed network calls entirely; the
// per-run CPU cost of parsing it is unchanged either way.
const CATALOG_CACHE_KEY = 'catalog-cache/lipseys.json';

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
  const token = await login(env);
  const items = await fetchCatalog(env, token);
  await env.DISTRIBUTOR_IMAGES.put(CATALOG_CACHE_KEY, JSON.stringify(items), {
    httpMetadata: { contentType: 'application/json' }
  });
  return items;
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
    // image_url is deliberately NOT a key here at all (not even null) -
    // PostgREST's upsert only touches columns present in the payload, so
    // omitting it means a fresh row gets the column default (NULL, ready
    // for backfillImages to pick up) while an existing already-cached row
    // keeps whatever image_url it already has instead of getting blanked
    // back to null on every single sync. Learned this the hard way: the
    // first version of this function set image_url: null explicitly, which
    // silently undid backfillImages()'s progress every day and the image
    // backlog could never actually shrink.
    image_source_name: item.imageName || null,
    is_firearm: !!item.fflRequired,
    last_synced_at: syncTime
  };
}

// Workers Free plan has a low per-invocation CPU budget - normalizing +
// filtering the full ~19,000-item raw catalog in one run blew past it
// (error 1102 "Worker exceeded resource limits", confirmed 2026-07-18).
// Only this many raw items get normalized/filtered per run; the cursor
// picks up where the last run left off and wraps around, so a full pass
// through the catalog takes several daily runs instead of one. Lipsey's
// CatalogFeed has no server-side pagination to fetch only part of it, but
// getCatalogItems above only pays that cost once per cycle now (see
// CATALOG_CACHE_KEY), not on every one of these chunked runs.
const CHUNK_SIZE = 1500;

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  const allowList = await getAllowedManufacturers(supabase);
  const syncTime = new Date().toISOString();

  let cursor = await getSyncCursor(supabase, 'lipseys');
  const rawItems = await getCatalogItems(env, cursor === 0);
  if (cursor >= rawItems.length) cursor = 0;

  // A cycle just starting gets its own start-of-cycle timestamp - reused on
  // every chunked run within this same cycle so the eventual stale-cleanup
  // pass (see below) has one consistent threshold for "wasn't seen this
  // entire cycle" rather than drifting with each run's own syncTime.
  let cycleStart = await getCycleStart(supabase, 'lipseys');
  if (cursor === 0 || !cycleStart) {
    cycleStart = syncTime;
    await setCycleStart(supabase, 'lipseys', cycleStart);
  }

  const chunk = rawItems.slice(cursor, cursor + CHUNK_SIZE);
  const normalized = chunk.map(item => normalize(item, syncTime)).filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);

  const nextCursor = cursor + CHUNK_SIZE;
  const cycleComplete = nextCursor >= rawItems.length;

  // staleCleanupThreshold only passed on the run that completes a full
  // cycle - see upsertDistributorProducts for why a mid-cycle run can't
  // safely zero out items it simply hasn't reached yet.
  await upsertDistributorProducts(supabase, 'lipseys', filtered, syncTime, cycleComplete ? cycleStart : null);
  await setSyncCursor(supabase, 'lipseys', cycleComplete ? 0 : nextCursor);

  return filtered.length;
}

// Only called from IMAGE_BACKFILL_CRON's own 10-minute schedule (see
// src/worker.js) now, never inline from run() - caching images doesn't need
// Lipsey's login/catalog fetch at all, it only needs image_source_name
// values already sitting in distributor_products from a previous catalog
// sync, plus a fetch to lipseyscloud.com's public CDN. At only 20/day from a
// once-daily full sync alone, a backlog in the thousands (the norm right
// after enabling several manufacturers) would take the better part of a
// year to clear - its own 10-minute cron instead clears it in a couple of
// days.
// 28 empirically confirmed safe, 35 reliably hits "Too many subrequests by
// single Worker invocation" (2026-07-20 - the Free plan's 50-subrequest-per-
// invocation ceiling; each row costs an R2 head + fetch + R2 put + Supabase
// update). Was 20 - bumped once actual headroom was measured rather than
// guessed, since the original inline-image-fetch incident that necessitated
// this whole backfill design in the first place was this exact same limit.
// run() used to also call this inline as a second, smaller top-up beyond
// the dedicated cron - removed 2026-08-07 after adding davidsons.js to the
// same shared 4-hour SYNC_JOBS invocation pushed the combined subrequest
// count (RSR + Davidson's login/download/Supabase calls + Lipsey's own
// catalog/Supabase calls + up to 28 inline image backfills) over the limit
// again, this time for real (not just close to it like 2026-07-20). The
// dedicated cron already covers the same backfill work on its own budget.
const BACKFILL_LIMIT = 28;

export async function backfillLipseysImages(env, supabase = getSupabaseAdmin(env)) {
  return backfillImages(supabase, env, {
    distributor: 'lipseys',
    prefix: 'lipseys',
    buildSourceUrl: (name) => `${LIPSEYS_IMAGE_BASE}/${name}`,
    limit: BACKFILL_LIMIT
  });
}
