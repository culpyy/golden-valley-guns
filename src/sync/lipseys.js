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
//
// Verified 2026-07-16 against a live response (18,987 items). Auth uses a
// custom `Token` header (NOT `Authorization: Bearer`), and CatalogFeed wraps
// items in a top-level `data` array, not `items`.
//
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts } from '../lib/catalogSync.js';

const LIPSEYS_BASE = 'https://api.lipseys.com';

// CatalogFeed only returns a bare filename (item.imageName), not a URL.
// Lipsey's own dealer portal (SPA at www.lipseys.com) loads product photos
// from lipseyscloud.com - found by pulling their app bundle and finding the
// base path, then verified with a live 200 against a real filename. Not
// documented anywhere public, confirmed 2026-07-16.
const LIPSEYS_IMAGE_BASE = 'https://www.lipseyscloud.com/images';

async function login(env) {
  const res = await fetch(`${LIPSEYS_BASE}/api/Integration/Authentication/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Email: env.LIPSEYS_EMAIL,
      Password: env.LIPSEYS_PASSWORD
    })
  });
  if (!res.ok) throw new Error(`Lipsey's login failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function fetchCatalog(token) {
  const res = await fetch(`${LIPSEYS_BASE}/api/Integration/Items/CatalogFeed`, {
    headers: { Token: token }
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
    quantity_available: Number.isFinite(quantity) ? quantity : 0,
    image_url: item.imageName ? `${LIPSEYS_IMAGE_BASE}/${item.imageName}` : null,
    is_firearm: !!item.fflRequired,
    last_synced_at: syncTime
  };
}

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  const token = await login(env);
  const rawItems = await fetchCatalog(token);
  const allowList = await getAllowedManufacturers(supabase);
  const syncTime = new Date().toISOString();
  const normalized = rawItems.map(item => normalize(item, syncTime)).filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);
  await upsertDistributorProducts(supabase, 'lipseys', filtered, syncTime);
  return filtered.length;
}
