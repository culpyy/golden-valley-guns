// Shared by every sync/*.js job so each distributor integration only has to
// implement auth + fetch + normalize.

// Distributors don't spell the same brand identically - confirmed live
// 2026-07-28 while auditing why so much of each catalog was being excluded:
// Orion calls it "Smith & Wesson", Lipsey's "Smith and Wesson"; Orion's
// "SPRINGFIELD" vs Lipsey's "Springfield Armory"; "Colt Mfg" vs "Colt";
// "Beretta Usa" vs "Beretta"; Orion splits Winchester's own ammo/firearms
// lines into "Winchester Ammunition"/"Winchester Repeating" where Lipsey's
// just says "Winchester". Without normalizing, a brand already on the
// allow-list can still silently fail to match depending which distributor
// it came from. normalizeManufacturer folds case/punctuation/whitespace
// differences automatically; MANUFACTURER_ALIASES covers the handful of
// real mismatches that aren't just punctuation (a genuinely different
// string for the same brand).
function normalizeManufacturer(name) {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MANUFACTURER_ALIASES = {
  'springfield': 'springfield armory',
  'winchester ammunition': 'winchester',
  'winchester repeating': 'winchester',
  'winchester repeating arms': 'winchester',
  'colt mfg': 'colt',
  'colts manufacturing': 'colt',
  'beretta usa': 'beretta',
  'fn america': 'fn',
  'iwi us': 'iwi',
  'iwi israel weapon industries': 'iwi',
  'walther arms': 'walther',
  'heckler and koch (hk usa)': 'hk',
  'heckler and koch': 'hk',
  'savage': 'savage arms',
  'remington ammunition': 'remington',
  'bergara rifles': 'bergara',
  'rock island': 'rock island armory',
  'heritage mfg': 'heritage manufacturing',
  'eaa': 'eaa corp',
  'diamondback firearms': 'diamondback',
  'dead air armament': 'dead air',
  'american tactical inc': 'american tactical',
};

function canonicalManufacturer(name) {
  const norm = normalizeManufacturer(name);
  return MANUFACTURER_ALIASES[norm] || norm;
}

export async function getAllowedManufacturers(supabase) {
  const { data, error } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', 'catalog_manufacturers')
    .single();
  // A failed lookup here must not be silently treated the same as a real
  // empty allow-list - see the guard in upsertDistributorProducts, which
  // relies on the empty case really meaning "nothing configured yet." So
  // this still throws rather than falling back to maybeSingle()+empty-string
  // - but a plain Supabase "no rows returned" error is cryptic in the sync
  // logs (the only place this failure is ever visible - see worker.js's
  // catch-and-log around every sync job), so it's rethrown with a message
  // that actually says what's wrong and how to fix it: this row got deleted
  // from `site_content` and both Lipsey's and Orion sync are dead until it's
  // restored via the Catalog Settings tab.
  if (error) {
    throw new Error(`catalog_manufacturers row missing from site_content (re-add it in Catalog Settings to restore syncing): ${error.message}`);
  }
  const raw = data?.value || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function getSiteContent(supabase, key, fallback) {
  const { data, error } = await supabase.from('site_content').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? fallback;
}

async function setSiteContent(supabase, key, value) {
  const { error } = await supabase.from('site_content').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

// Cloudflare Workers Free plan has a low per-invocation CPU time budget -
// normalizing/filtering a distributor's full raw catalog (Lipsey's alone is
// ~19,000 items) in one request blows past it (confirmed 2026-07-18, error
// 1102 "Worker exceeded resource limits"). This bounds how much of the raw
// array actually gets processed per run to chunkSize, tracked by a cursor
// persisted in site_content, cycling through the full catalog over several
// runs instead of trying to do it all in one shot every time. The raw
// fetch+JSON.parse cost is paid every run regardless (Lipsey's CatalogFeed
// has no server-side pagination), only the JS-side processing is chunked.
export async function getSyncCursor(supabase, distributor) {
  const raw = await getSiteContent(supabase, `${distributor}_sync_cursor`, '0');
  return parseInt(raw, 10) || 0;
}

export async function setSyncCursor(supabase, distributor, cursor) {
  await setSiteContent(supabase, `${distributor}_sync_cursor`, String(cursor));
}

// Atomic claim - see sql/atomic_sync_cursor.sql for why the plain
// getSyncCursor-then-setSyncCursor pair above is unsafe under concurrency
// (same class of bug as the pre-fix stock reservation) and can't just be
// narrowed, it has to be a single locking DB call. Returns the cursor
// position this call claimed (the chunk to process now) - the caller no
// longer calls setSyncCursor itself, this already advanced it.
export async function claimSyncChunk(supabase, distributor, chunkSize, totalItems) {
  const { data, error } = await supabase.rpc('claim_sync_chunk', {
    p_key: `${distributor}_sync_cursor`,
    p_chunk_size: chunkSize,
    p_total_items: totalItems
  });
  if (error) throw error;
  return data;
}

// Stamped once when a cursor cycle starts (cursor === 0) and read back when
// it completes (cursor wraps back to 0) - upsertDistributorProducts uses
// this instead of a per-run timestamp to detect genuinely stale/delisted
// items, since with chunked processing most items in any given run simply
// haven't been reached yet, not actually gone from the distributor's feed.
export async function getCycleStart(supabase, distributor) {
  return getSiteContent(supabase, `${distributor}_sync_cycle_start`, null);
}

export async function setCycleStart(supabase, distributor, isoTime) {
  await setSiteContent(supabase, `${distributor}_sync_cycle_start`, isoTime);
}

// Empty allow-list = sync nothing. Prevents a misconfigured/empty list from
// accidentally dumping a distributor's entire catalog onto the site.
// A literal "*" is an explicit opt-in to sync every manufacturer, distinct
// from "never configured" - so the two cases can't be confused with each other.
export function filterByAllowList(items, allowList) {
  if (allowList.length === 1 && allowList[0] === '*') return items;
  if (allowList.length === 0) return [];
  const allowSet = new Set(allowList.map(canonicalManufacturer));
  return items.filter(i => i.manufacturer && allowSet.has(canonicalManufacturer(i.manufacturer)));
}

// syncTime is a single timestamp shared by every item in this run (set by the
// caller, stamped onto each item's last_synced_at during normalize).
//
// staleCleanupThreshold controls the "zero out delisted items" pass - pass
// null/undefined to skip it entirely (used for a chunked/partial run, where
// most of the catalog simply hasn't been reached yet by this run's slice,
// not actually gone from the distributor's feed - see getSyncCursor above).
// Pass the cycle's start timestamp only once a full cursor cycle completes;
// anything with last_synced_at older than that genuinely wasn't seen across
// the *entire* cycle, which is what actually means delisted.
export async function upsertDistributorProducts(supabase, distributor, items, syncTime, staleCleanupThreshold = null) {
  // "Sync nothing" (empty allow-list, or every item filtered out) must mean
  // exactly that - touch nothing. Without this guard, an empty `items` list
  // fell through to the stale-zero query below with no lower bound on
  // last_synced_at, which zeroed quantity_available for every existing row
  // from this distributor instead of leaving them alone.
  if (items.length > 0) {
    const { error: upsertError } = await supabase
      .from('distributor_products')
      .upsert(items, { onConflict: 'distributor,distributor_sku' });
    if (upsertError) throw upsertError;
  }

  if (!staleCleanupThreshold) return;

  // Zero out stock for anything not seen across the whole cycle just
  // completed (delisted SKU, allow-list narrowed, etc) so stale "in stock"
  // items don't linger on the Shop page.
  const { error: staleError } = await supabase
    .from('distributor_products')
    .update({ quantity_available: 0, last_synced_at: syncTime })
    .eq('distributor', distributor)
    .lt('last_synced_at', staleCleanupThreshold);
  if (staleError) throw staleError;
}
