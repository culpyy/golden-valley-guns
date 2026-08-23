// Davidson's/Gallery of Guns catalog sync. Same shape as sync/lipseys.js and
// sync/orion.js (chunked cursor processing, allow-list filtering, upsert into
// distributor_products) - see lipseys.js for the fullest write-up of that
// shared pattern.
//
// Required secrets (set with `wrangler secret put NAME`):
//   DAVIDSONS_USERNAME
//   DAVIDSONS_PASSWORD
//
// Verified live 2026-08-07 against the real dealer portal:
//   - Unlike Lipsey's/Orion, Davidson's has no separate generated API key.
//     The earlier FTP-based plan in this file's original scaffold turned out
//     to be unnecessary - the dealer portal's Inventory Download page
//     (https://www.davidsonsinc.com/inventory-download/) serves the same
//     feed over plain HTTPS, authenticated the same way logging into the
//     website is: standard Magento 2 customer login (email/password) against
//     a session cookie, same shape as Lipsey's email/password auth.
//   - Magento's login form and the download form both require a `form_key`
//     CSRF token pulled fresh from whatever page you're about to POST to -
//     the browser's own JS injects this invisibly on every form submit
//     (mage/formKey), but a plain fetch() has to read it out of the page
//     HTML and pass it explicitly, or the POST just redirects back to the
//     same page with nothing done (confirmed empirically - the first attempt
//     without a form_key silently 302'd back to /inventory-download/ with no
//     error and no file).
//   - The "Download Item Inventory" CSV (name=davidsons_inventory) is
//     mostly firearms (10,550 rows checked live, sampled rows across the
//     file were guns), but not exclusively - real magazine/accessory rows
//     ride along too, only distinguishable by an empty Gun Type column (see
//     isMagazineAccessory below, added 2026-08-08 after the first ~7,000
//     rows synced with every magazine wrongly marked is_firearm: true).
//     Davidson's ammo/optics catalog isn't exposed through this feed at all,
//     only Gallery of Guns firearms (plus the magazines that ride along).
//     Columns:
//     Item #, Item Description, MSP, Retail Price, Dealer Price, Sale Price,
//     Sale Ends, Quantity, UPC Code, Manufacturer, Gun Type, Model Series,
//     Caliber, Action, Capacity, Finish, Stock, Sights, Barrel Length,
//     Overall Length, Features. No image data at all (no filename or URL
//     column), unlike Lipsey's/Orion - so image_source_name is always null
//     here and there's no backfillDavidsonsImages function; imageCache.js's
//     backfillImages already skips rows with a null image_source_name.
//   - "MSP" (Minimum Selling Price - Davidson's own MAP-equivalent term) was
//     identical to Dealer Price on every sampled row, but it's still mapped
//     to retail_map (not folded into dealer_cost) since it's semantically a
//     price floor, not a cost - same MAP-enforcement pattern as Lipsey's
//     retailMap/Orion's manufacturer_advertised_price (see
//     sql/distributor_catalog.sql's GREATEST(markup price, retail_map)).
//     "Retail Price" maps to msrp (informational only, same as the other two
//     distributors' msrp field).
//   - The separate davidsons_quantity feed (Item_Number/UPC/Quantity_NC/
//     Quantity_AZ, 10,927 rows) is deliberately NOT fetched - the main
//     inventory CSV's own Quantity column is already documented on the page
//     itself as "close-to-live quantities in both the AZ-Warehouse and the
//     NC-Warehouse" (i.e. already the combined figure), so pulling the
//     per-warehouse split too would just be a second login+download for data
//     this sync doesn't use.
//
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts, getSyncCursor, claimSyncChunk, getCycleStart, setCycleStart } from '../lib/catalogSync.js';

const LOGIN_PAGE_URL = 'https://www.davidsonsinc.com/customer/account/login/';
const LOGIN_POST_URL = 'https://www.davidsonsinc.com/customer/account/loginPost/';
const INVENTORY_PAGE_URL = 'https://www.davidsonsinc.com/inventory-download/';
const DOWNLOAD_URL = 'https://www.davidsonsinc.com/inventory-download/request/downloadinventory/';

// Cloudflare Workers' Headers iterator yields each Set-Cookie header as its
// own entry (a deliberate deviation from the Fetch spec other runtimes
// follow, since folding multiple Set-Cookie values into one comma-joined
// string would corrupt any cookie whose Expires attribute itself contains a
// comma) - safe to rely on here. Only the name=value pair is kept; cookie
// attributes (Path, Expires, HttpOnly, ...) don't matter for a same-origin
// server-to-server session, only the browser needs those.
function mergeCookies(jar, response) {
  const next = { ...jar };
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== 'set-cookie') continue;
    const pair = value.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > -1) next[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return next;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractFormKey(html) {
  const m = html.match(/name="form_key"[^>]*?value="([^"]+)"/);
  return m ? m[1] : null;
}

async function login(env) {
  if (!env.DAVIDSONS_USERNAME || !env.DAVIDSONS_PASSWORD) {
    throw new Error("DAVIDSONS_USERNAME and DAVIDSONS_PASSWORD must be set (wrangler secret put) - Davidson's has no separate API key, auth is just the dealer account login.");
  }

  let jar = {};
  let res = await fetch(LOGIN_PAGE_URL, { headers: { Cookie: cookieHeader(jar) } });
  jar = mergeCookies(jar, res);
  const loginFormKey = extractFormKey(await res.text());
  if (!loginFormKey) throw new Error("Davidson's login page: form_key not found (page markup may have changed).");

  res = await fetch(LOGIN_POST_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar)
    },
    body: new URLSearchParams({
      'login[username]': env.DAVIDSONS_USERNAME,
      'login[password]': env.DAVIDSONS_PASSWORD,
      form_key: loginFormKey
    }).toString()
  });
  jar = mergeCookies(jar, res);

  // Magento redirects on both a successful login and a wrong password (the
  // failure case just bounces back to the login page with a flash error
  // cookie) - the redirect alone doesn't prove anything, so the real check
  // is whether a follow-up request to an account-only page actually shows
  // account content instead of the login form. This same request also
  // conveniently gets the form_key needed for the download POST below.
  res = await fetch(INVENTORY_PAGE_URL, { headers: { Cookie: cookieHeader(jar) } });
  jar = mergeCookies(jar, res);
  const html = await res.text();
  if (html.includes('form-login') || !html.includes('Inventory Download')) {
    throw new Error("Davidson's login failed - check DAVIDSONS_USERNAME/DAVIDSONS_PASSWORD secrets.");
  }
  const formKey = extractFormKey(html);
  if (!formKey) throw new Error("Davidson's inventory-download page: form_key not found.");

  return { jar, formKey };
}

async function downloadInventoryCsv({ jar, formKey }) {
  const res = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar)
    },
    body: new URLSearchParams({ name: 'davidsons_inventory', type: 'csv', form_key: formKey }).toString()
  });
  if (!res.ok) throw new Error(`Davidson's inventory download failed: ${res.status}`);
  const text = await res.text();
  // A missing/expired form_key or session doesn't error - the controller
  // just redirects back to the download page and fetch() follows it,
  // silently handing back that page's HTML instead of a CSV. Catch it here
  // rather than letting it corrupt the parse below.
  if (text.trimStart().slice(0, 15).toLowerCase().startsWith('<!doctype html')) {
    throw new Error("Davidson's inventory download returned an HTML page instead of CSV - session may have expired mid-request.");
  }
  return text;
}

// The raw CSV (~2.5MB, 10,550 rows as of 2026-08-07) doesn't change
// meaningfully within a single cursor cycle, same reasoning as Lipsey's/
// Orion's catalog caching. Cached as the raw CSV text rather than pre-parsed
// JSON (contrast with lipseys.js/orion.js, whose source APIs already hand
// back parsed JSON) - the actual field-by-field CSV parsing (quote/comma
// handling) is deferred to per-chunk in run() below, so a cursor cycle only
// ever quote-parses CHUNK_SIZE rows per invocation, not the whole file.
const CATALOG_CACHE_KEY = 'catalog-cache/davidsons.csv';

async function getCatalogText(env, forceRefresh) {
  if (!forceRefresh) {
    const cached = await env.DISTRIBUTOR_IMAGES.get(CATALOG_CACHE_KEY);
    if (cached) {
      const text = await cached.text();
      if (text) return text;
    }
  }
  const session = await login(env);
  const csv = await downloadInventoryCsv(session);
  await env.DISTRIBUTOR_IMAGES.put(CATALOG_CACHE_KEY, csv, {
    httpMetadata: { contentType: 'text/csv' }
  });
  return csv;
}

// Minimal RFC4180-ish single-line CSV parser: handles quoted fields
// (including embedded commas and "" as an escaped quote). Davidson's export
// quotes any field that might contain a comma (descriptions, features) and
// leaves plain numeric/short fields unquoted, so a naive split(',') would
// break on the first quoted field containing a comma.
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

function rowToObject(headers, fields) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = fields[i] ?? ''; });
  return obj;
}

// Same null-not-NaN reasoning as the other two syncs' safeNumber - a field
// like an empty Sale Price or a stray non-numeric value should skip pricing
// rather than produce NaN/$0 downstream. Strips $ and thousands commas.
function parseMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Same target vocabulary as lipseys.js/orion.js's mapFirearmType, so the
// shop page's firearm-type filter behaves consistently regardless of which
// distributor an item came from. Davidson's "Gun Type" column is a
// colon-separated pair (e.g. "Shotgun: Side by Side", "Pistol: Semi-Auto") -
// only the broad first half matters here. A row with no match at all (Gun
// Type blank or not one of these five) falls to 'Other' - see
// hasRealFirearmType/isMagazineAccessory below for why that fallback matters.
function hasRealFirearmType(gunType) {
  const type = (gunType || '').toLowerCase();
  return type.includes('pistol') || type.includes('revolver') || type.includes('rifle') ||
    type.includes('shotgun') || type.includes('muzzleloader');
}

function mapFirearmType(gunType) {
  if (!hasRealFirearmType(gunType)) return 'Other';
  const type = gunType.toLowerCase();
  if (type.includes('pistol') || type.includes('revolver')) return 'Handgun';
  if (type.includes('rifle')) return 'Rifle';
  if (type.includes('shotgun')) return 'Shotgun';
  return 'Muzzleloader';
}

// The feed isn't purely firearms despite the file header comment above -
// confirmed live 2026-08-08: mag/accessory rows (replacement magazines,
// scope rings/mounts, etc.) ride along in the same "Item Inventory" export,
// distinguishable only by an empty/non-matching Gun Type. Magazines
// specifically were getting upserted with is_firearm: true (wrong - routes
// a $20 magazine through the FFL/special-order path instead of direct cart
// checkout) and no way to tell them apart from real guns whose own name
// happens to contain "MAG" (Savage's "B.MAG" rifle line, Charter Arms' "Mag
// Pug" revolver, "SAV 110 MAG TRGT" for a Magnum chambering, Ruger PCC
// carbines listed with/without a magazine) - those are real firearms and
// must not be caught here. The Gun Type check is what makes this safe: all
// 18 "MAG"-in-name rows that are genuinely firearms already resolved a real
// Gun Type (Rifle/Handgun/etc, hasRealFirearmType is true for them), while
// every one of the 588 confirmed-accessory rows had no Gun Type match at
// all. Skipped entirely (returns null) rather than just recategorized, since
// there's no reliable signal here to separate "definitely an accessory,
// safe for direct cart checkout" from "Gun Type just didn't parse" for the
// wider non-magazine 'Other' bucket (scope rings, bases, etc.) - only the
// magazine case has a name pattern specific enough to trust.
const MAGAZINE_NAME_PATTERN = /\bMAG(AZINE)?\b/i;

function isMagazineAccessory(name, gunType) {
  return MAGAZINE_NAME_PATTERN.test(name) && !hasRealFirearmType(gunType);
}

// Returns null to signal "skip this row" (malformed item shouldn't take down
// the whole batch upsert), same convention as lipseys.js/orion.js's normalize.
function normalize(row, syncTime) {
  const itemNo = row['Item #'];
  const dealerCost = parseMoney(row['Dealer Price']);
  if (!itemNo || dealerCost === null) return null;
  if (isMagazineAccessory(row['Item Description'], row['Gun Type'])) return null;

  const quantity = parseInt(row['Quantity'], 10);
  const upc = row['UPC Code'] ? row['UPC Code'].replace(/#/g, '').trim() : '';

  return {
    distributor: 'davidsons',
    distributor_sku: String(itemNo),
    upc: upc || null,
    name: row['Item Description'] || 'Unnamed item',
    manufacturer: row['Manufacturer'] || null,
    // The magazine/accessory rows that would need 'parts' get filtered out
    // above (isMagazineAccessory) rather than categorized - everything that
    // reaches this point is a real firearm, unlike lipseys.js/orion.js which
    // keep their own ammo/parts items and have to branch on item type.
    category: 'firearms',
    caliber: row['Caliber'] || null,
    firearm_type: mapFirearmType(row['Gun Type']),
    description: row['Item Description'] || '',
    dealer_cost: dealerCost,
    msrp: parseMoney(row['Retail Price']),
    retail_map: parseMoney(row['MSP']),
    quantity_available: Number.isFinite(quantity) ? quantity : 0,
    // No image data anywhere in this feed - left null (not just omitted;
    // there's no prior-value-preserving concern here since Davidson's rows
    // never get an image_url from any source), so backfillImages (which
    // only queries rows with a non-null image_source_name) never picks these
    // up. A photo would have to be added by hand via the admin Products tab.
    image_source_name: null,
    is_firearm: true,
    last_synced_at: syncTime
  };
}

// Same CPU-budget reasoning as lipseys.js/orion.js - chunk the per-row parse/
// normalize work across several runs rather than all 10,550 rows in one
// invocation. Matches their CHUNK_SIZE for consistency, though Davidson's
// smaller catalog means a full cycle completes in ~7 runs instead of ~11-13.
const CHUNK_SIZE = 1500;

export async function run(env) {
  const supabase = getSupabaseAdmin(env);
  const allowList = await getAllowedManufacturers(supabase);
  const syncTime = new Date().toISOString();

  // Just a cheap peek to decide whether to bypass the catalog cache below -
  // doesn't need to be race-free, the actual chunk claim happens atomically
  // right before slicing (see claimSyncChunk).
  const cursorPeek = await getSyncCursor(supabase, 'davidsons');
  const csvText = await getCatalogText(env, cursorPeek === 0);
  const lines = csvText.split(/\r?\n/).filter(line => line.length > 0);
  const headers = parseCsvLine(lines[0]);
  const dataLines = lines.slice(1);

  // Atomic claim - see sql/atomic_sync_cursor.sql and the equivalent comment
  // in sync/lipseys.js. Doing this after the slow catalog fetch/login above
  // but right before the chunk is sliced keeps the race window down to a
  // single DB round trip.
  const cursor = await claimSyncChunk(supabase, 'davidsons', CHUNK_SIZE, dataLines.length);

  let cycleStart = await getCycleStart(supabase, 'davidsons');
  if (cursor === 0 || !cycleStart) {
    cycleStart = syncTime;
    await setCycleStart(supabase, 'davidsons', cycleStart);
  }

  const chunkLines = dataLines.slice(cursor, cursor + CHUNK_SIZE);
  const normalized = chunkLines
    .map(line => normalize(rowToObject(headers, parseCsvLine(line)), syncTime))
    .filter(Boolean);
  const filtered = filterByAllowList(normalized, allowList);

  const cycleComplete = cursor + CHUNK_SIZE >= dataLines.length;

  await upsertDistributorProducts(supabase, 'davidsons', filtered, syncTime, cycleComplete ? cycleStart : null);

  return filtered.length;
}
