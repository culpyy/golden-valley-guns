// RSR Group catalog sync. Same chunked-cursor/allow-list/upsert shape as
// sync/lipseys.js, sync/orion.js and sync/davidsons.js - see lipseys.js for
// the fullest write-up of that shared pattern.
//
// Required secrets (set with `wrangler secret put NAME`):
//   RSR_FTP_USERNAME  - RSR's own FTP login (a numeric account/customer
//                        number, e.g. "70336" - NOT the rsrgroup.com website
//                        login), emailed by RSR after requesting FTP access
//                        from Dealer's Toolbox > Available Downloads
//   RSR_FTP_PASSWORD  - emailed alongside the username above
//   RSR_RELAY_URL      - e.g. https://rsr-relay.goldenvalleygunsllc.com (see relay/rsr-server.js)
//   RSR_RELAY_SECRET   - shared secret the relay checks, must match its RELAY_SHARED_SECRET
//
// Verified against RSR's own docs 2026-09-08 (rsrgroup.com/dealers-toolbox/
// inventory-file-layout, while logged into Golden Valley Guns' real dealer
// account) rather than guessed or taken from a third-party reference:
//   - Unlike Lipsey's/Orion (a REST API) and Davidson's (turned out to be
//     plain HTTPS despite an initial FTP assumption), RSR's feed really is
//     old-school FTP - there is no REST API at all. Cloudflare Workers can't
//     speak FTP, so this goes through a small bridge on the same Oracle Cloud
//     relay VM already built for Lipsey's static-IP requirement (see
//     relay/rsr-server.js) - a different problem (no FTP client, not an IP
//     allowlist), same "run it on a real VM and expose it over HTTPS" shape.
//     Real connection details per RSR's own "FTP Access request" reply email
//     (2026-09-08, dealer login 70336): host ftps.rsrgroup.com, port 2222,
//     explicit FTP over TLS, passive port range 64000-65535 - not plain
//     ftp.rsrgroup.com:21 as first assumed from the public docs page.
//   - rsrinventory-new.txt: ASCII text, semicolon-delimited, 77 fields, no
//     quoting/escaping (unlike Davidson's CSV) - RSR's own docs don't
//     document any escaping mechanism for a stray semicolon inside a
//     description, so a plain split(';') is what their own layout doc
//     implies. Updated every 2 hours per RSR.
//   - Department Number (field 4) has 43 categories but no clean
//     rifle-vs-shotgun split for "Long Guns" (departments 3/5 cover both) -
//     unlike Davidson's explicit "Gun Type" column. mapFirearmType below
//     falls back to a keyword/gauge scan of the description for those two
//     departments; anything it can't confidently classify lands in 'Other'
//     rather than guessing wrong.
//   - No usable image data: field 15 is just a filename convention
//     (RSRStockNumber_1.jpg), not a URL, and RSR doesn't publish a public
//     image CDN base path the way Lipsey's/Orion do (their separate "RSR
//     Product Images" download is a bulk archive, not per-item hotlinking) -
//     left null throughout, same as Davidson's. A real image pipeline here
//     would mean pulling that bulk archive over FTP too, out of scope for
//     this pass.
//   - Deliberately NOT fetching the separate 5-minute Inventory Quantity
//     feed - field 9 of the main inventory file already carries a live
//     quantity per row (RSR's own docs: "Deleted SKU's will have a 0 in this
//     field"), same reasoning Davidson's sync used to skip its own separate
//     quantity feed.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts, getSyncCursor, claimSyncChunk, getCycleStart, setCycleStart } from '../lib/catalogSync.js';

function relayHeaders(env) {
  if (!env.RSR_RELAY_URL || !env.RSR_RELAY_SECRET) {
    throw new Error('RSR_RELAY_URL and RSR_RELAY_SECRET must be set (wrangler secret put) - direct FTP calls from the Worker are not possible, see relay/rsr-server.js.');
  }
  if (!env.RSR_FTP_USERNAME || !env.RSR_FTP_PASSWORD) {
    throw new Error('RSR_FTP_USERNAME and RSR_FTP_PASSWORD must be set (wrangler secret put) - these are the FTP credentials RSR emails after a Get FTP Credentials request, not the rsrgroup.com website login.');
  }
  return {
    'X-Relay-Secret': env.RSR_RELAY_SECRET,
    'X-FTP-User': env.RSR_FTP_USERNAME,
    'X-FTP-Pass': env.RSR_FTP_PASSWORD
  };
}

async function downloadInventoryFile(env) {
  const res = await fetch(`${env.RSR_RELAY_URL}/rsr-file?file=rsrinventory-new.txt`, { headers: relayHeaders(env) });
  if (!res.ok) throw new Error(`RSR relay fetch failed: ${res.status} ${await res.text()}`);
  return res.text();
}

// Raw file (~10-15MB, tens of thousands of rows) doesn't change meaningfully
// within a single cursor cycle - same reasoning as Davidson's CSV caching.
// Cached as raw text; the actual field-splitting is deferred to per-chunk in
// run() below, so a cursor cycle only ever parses CHUNK_SIZE rows per
// invocation.
const CATALOG_CACHE_KEY = 'catalog-cache/rsr.txt';

async function getCatalogText(env, forceRefresh) {
  if (!forceRefresh) {
    const cached = await env.DISTRIBUTOR_IMAGES.get(CATALOG_CACHE_KEY);
    if (cached) {
      const text = await cached.text();
      if (text) return text;
    }
  }
  const text = await downloadInventoryFile(env);
  await env.DISTRIBUTOR_IMAGES.put(CATALOG_CACHE_KEY, text, { httpMetadata: { contentType: 'text/plain' } });
  return text;
}

// Field positions per rsrgroup.com/dealers-toolbox/inventory-file-layout
// (1-indexed in RSR's own docs, converted to 0-indexed array offsets here).
const FIELD = {
  STOCK_NUMBER: 0,
  UPC: 1,
  DESCRIPTION: 2,
  DEPARTMENT: 3,
  MSRP: 5,
  DEALER_PRICE: 6,
  QUANTITY: 8,
  FULL_MANUFACTURER_NAME: 10,
  STATUS: 12,
  EXPANDED_DESCRIPTION: 13,
  RETAIL_MAP: 70
};

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Departments that are real firearms vs. everything else. Anything not
// listed here (accessories, optics, magazines, holsters, reloading gear,
// airguns, Tasers, ...) defaults to 'parts' below - same "only promote to
// firearms/ammo when clearly warranted, else parts" convention orion.js's
// mapCategory uses, since the DB's category check constraint only allows
// firearms/ammo/parts (no catch-all 'other' for distributor-sourced rows).
const FIREARM_DEPARTMENTS = new Set([1, 2, 3, 5, 6, 7]);
const AMMO_DEPARTMENT = 18;

const SHOTGUN_PATTERN = /\b(SHOTGUN|SHOTSHELL|\d{1,2}\s?GA(UGE)?|\.410|410\s?BORE)\b/i;
const HANDGUN_PATTERN = /\b(PISTOL|REVOLVER|HANDGUN)\b/i;
const RIFLE_PATTERN = /\bRIFLE\b/i;

// Only departments 3/5 ("Long Guns") reach the text-scan fallback - every
// other department's firearm_type is implied directly by its department
// number, no guessing needed there.
function mapFirearmType(deptNum, description) {
  if (deptNum === 1 || deptNum === 2) return 'Handgun';
  if (deptNum === 7) return 'Muzzleloader';
  if (deptNum === 6) return 'Other'; // NFA Products - could be any type
  if (deptNum === 3 || deptNum === 5) {
    const text = description || '';
    if (SHOTGUN_PATTERN.test(text)) return 'Shotgun';
    if (RIFLE_PATTERN.test(text)) return 'Rifle';
    if (HANDGUN_PATTERN.test(text)) return 'Handgun'; // rare misfile, seen on other distributors' feeds too
    return 'Other';
  }
  return 'Other';
}

function mapCategory(deptNum) {
  if (deptNum === AMMO_DEPARTMENT) return 'ammo';
  if (FIREARM_DEPARTMENTS.has(deptNum)) return 'firearms';
  return 'parts';
}

// Returns null to signal "skip this row" (malformed item shouldn't take down
// the whole batch upsert), same convention as the other three syncs' normalize.
function normalize(fields, syncTime) {
  const stockNumber = fields[FIELD.STOCK_NUMBER];
  const dealerCost = parseMoney(fields[FIELD.DEALER_PRICE]);
  if (!stockNumber || dealerCost === null) return null;

  const deptNum = parseInt(fields[FIELD.DEPARTMENT], 10);
  const category = mapCategory(deptNum);
  const description = fields[FIELD.DESCRIPTION] || 'Unnamed item';
  const quantity = parseInt(fields[FIELD.QUANTITY], 10);
  const upc = (fields[FIELD.UPC] || '').trim();

  return {
    distributor: 'rsr',
    distributor_sku: String(stockNumber).trim(),
    upc: upc || null,
    name: description,
    manufacturer: fields[FIELD.FULL_MANUFACTURER_NAME] || null,
    category,
    caliber: null, // not a distinct field in RSR's layout - only present inline in the description text
    firearm_type: category === 'firearms' ? mapFirearmType(deptNum, fields[FIELD.EXPANDED_DESCRIPTION] || description) : null,
    description: fields[FIELD.EXPANDED_DESCRIPTION] || description,
    dealer_cost: dealerCost,
    msrp: parseMoney(fields[FIELD.MSRP]),
    retail_map: parseMoney(fields[FIELD.RETAIL_MAP]),
    quantity_available: Number.isFinite(quantity) ? quantity : 0,
    image_source_name: null,
    image_url: null,
    is_firearm: category === 'firearms',
    last_synced_at: syncTime
  };
}

// Same CPU-budget reasoning as the other three syncs.
const CHUNK_SIZE = 1500;

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  const allowList = await getAllowedManufacturers(supabase);
  const syncTime = new Date().toISOString();

  const cursorPeek = await getSyncCursor(supabase, 'rsr');
  const catalogText = await getCatalogText(env, cursorPeek === 0);
  const dataLines = catalogText.split(/\r?\n/).filter(line => line.length > 0);

  const cursor = await claimSyncChunk(supabase, 'rsr', CHUNK_SIZE, dataLines.length);

  let cycleStart = await getCycleStart(supabase, 'rsr');
  if (cursor === 0 || !cycleStart) {
    cycleStart = syncTime;
    await setCycleStart(supabase, 'rsr', cycleStart);
  }

  const chunkLines = dataLines.slice(cursor, cursor + CHUNK_SIZE);
  const normalized = chunkLines
    .map(line => normalize(line.split(';'), syncTime))
    .filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);

  const cycleComplete = cursor + CHUNK_SIZE >= dataLines.length;

  await upsertDistributorProducts(supabase, 'rsr', filtered, syncTime, cycleComplete ? cycleStart : null);

  return filtered.length;
}
