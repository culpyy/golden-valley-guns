// Reference implementation for the distributor catalog sync pattern.
// Lipsey's has the best-documented dealer API of the four distributors, so
// this one is built out in full; sync-rsr.js, sync-davidsons.js, and
// sync-orion.js follow the same shape once each account/API is confirmed live.
//
// Required Netlify environment variables:
//   LIPSEYS_EMAIL              - Lipsey's dealer account email
//   LIPSEYS_PASSWORD           - Lipsey's dealer account password
//   SUPABASE_URL               - same Supabase project URL the site already uses
//   SUPABASE_SERVICE_ROLE_KEY  - Project Settings > API > service_role (NOT the anon key)
//
// NOTE: the exact response field names below (itemNo, description, etc.) are
// per Lipsey's published integration docs but haven't been verified against a
// live response yet — do that first thing once real credentials are in place,
// and adjust normalize()/mapCategory() to match what actually comes back.

const { schedule } = require('@netlify/functions');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts } = require('./_lib/catalogSync');

const LIPSEYS_BASE = 'https://api.lipseys.com';

async function login() {
  const res = await fetch(`${LIPSEYS_BASE}/api/Integration/Authentication/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Email: process.env.LIPSEYS_EMAIL,
      Password: process.env.LIPSEYS_PASSWORD
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

async function run() {
  const supabase = getSupabaseAdmin();
  const token = await login();
  const rawItems = await fetchCatalog(token);
  const allowList = await getAllowedManufacturers(supabase);
  const normalized = rawItems.map(normalize).filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);
  await upsertDistributorProducts(supabase, 'lipseys', filtered);
  return filtered.length;
}

exports.handler = schedule('0 8 * * *', async () => {
  try {
    const count = await run();
    console.log(`Lipsey's sync complete: ${count} items upserted.`);
    return { statusCode: 200 };
  } catch (err) {
    console.error("Lipsey's sync failed:", err);
    return { statusCode: 500, body: err.message };
  }
});
