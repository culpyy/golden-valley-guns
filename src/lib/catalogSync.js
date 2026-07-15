// Shared by every sync/*.js job so each distributor integration only has to
// implement auth + fetch + normalize.

export async function getAllowedManufacturers(supabase) {
  const { data, error } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', 'catalog_manufacturers')
    .single();
  // A failed lookup here must not be silently treated the same as a real
  // empty allow-list - see the guard in upsertDistributorProducts, which
  // relies on the empty case really meaning "nothing configured yet."
  if (error) throw error;
  const raw = data?.value || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Empty allow-list = sync nothing. Prevents a misconfigured/empty list from
// accidentally dumping a distributor's entire catalog onto the site.
export function filterByAllowList(items, allowList) {
  if (allowList.length === 0) return [];
  const allowSet = new Set(allowList.map(m => m.toLowerCase()));
  return items.filter(i => i.manufacturer && allowSet.has(i.manufacturer.toLowerCase()));
}

export async function upsertDistributorProducts(supabase, distributor, items) {
  // "Sync nothing" (empty allow-list, or every item filtered out) must mean
  // exactly that - touch nothing. Without this guard, an empty `items` list
  // fell through to the stale-zero query below with no SKU filter attached,
  // which zeroed quantity_available for every existing row from this
  // distributor instead of leaving them alone.
  if (items.length === 0) return;

  const { error: upsertError } = await supabase
    .from('distributor_products')
    .upsert(items, { onConflict: 'distributor,distributor_sku' });
  if (upsertError) throw upsertError;

  // Zero out stock for anything previously synced from this distributor that
  // didn't appear in this run (delisted SKU, allow-list narrowed, etc) so
  // stale "in stock" items don't linger on the Shop page.
  const currentSkus = items.map(i => i.distributor_sku.replace(/"/g, '\\"'));
  const { error: staleError } = await supabase
    .from('distributor_products')
    .update({ quantity_available: 0, last_synced_at: new Date().toISOString() })
    .eq('distributor', distributor)
    .not('distributor_sku', 'in', `(${currentSkus.map(s => `"${s}"`).join(',')})`);
  if (staleError) throw staleError;
}
