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
// NOTE: the exact response field names below (itemNo, description, etc.) are
// per Lipsey's published integration docs but haven't been verified against a
// live response yet — do that first thing once real credentials are in place,
// and adjust normalize()/mapCategory() to match what actually comes back.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts } from '../lib/catalogSync.js';

const LIPSEYS_BASE = 'https://api.lipseys.com';

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
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Lipsey's catalog fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.items || []);
}

function mapCategory(item) {
  const type = (item.itemType || '').toLowerCase();
  if (item.fflRequired) return 'firearms';
  if (type.includes('ammo')) return 'ammo';
  return 'parts';
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
function normalize(item) {
  const dealerCost = safeNumber(item.price);
  if (dealerCost === null || !item.itemNo) return null;

  const quantity = parseInt(item.quantity, 10);
  const msrp = item.msrp ? safeNumber(item.msrp) : null;

  return {
    distributor: 'lipseys',
    distributor_sku: String(item.itemNo),
    upc: item.upc || null,
    name: item.description || 'Unnamed item',
    manufacturer: item.manufacturer || null,
    category: mapCategory(item),
    caliber: item.caliber || null,
    description: item.description || '',
    dealer_cost: dealerCost,
    msrp,
    quantity_available: Number.isFinite(quantity) ? quantity : 0,
    image_url: item.imageUrl || null,
    is_firearm: !!item.fflRequired,
    last_synced_at: new Date().toISOString()
  };
}

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  const token = await login(env);
  const rawItems = await fetchCatalog(token);
  const allowList = await getAllowedManufacturers(supabase);
  const normalized = rawItems.map(normalize).filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);
  await upsertDistributorProducts(supabase, 'lipseys', filtered);
  return filtered.length;
}
