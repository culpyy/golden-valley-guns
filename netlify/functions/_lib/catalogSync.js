// Shared by every sync-*.js function so each distributor integration only
// has to implement auth + fetch + normalize.

async function getAllowedManufacturers(supabase) {
  const { data } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', 'catalog_manufacturers')
    .single();
  const raw = data?.value || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Empty allow-list = sync nothing. Prevents a misconfigured/empty list from
// accidentally dumping a distributor's entire catalog onto the site.
function filterByAllowList(items, allowList) {
  if (allowList.length === 0) return [];
  const allowSet = new Set(allowList.map(m => m.toLowerCase()));
  return items.filter(i => i.manufacturer && allowSet.has(i.manufacturer.toLowerCase()));
}

async function upsertDistributorProducts(supabase, distributor, items) {
  if (items.length > 0) {
    const { error } = await supabase
      .from('distributor_products')
      .upsert(items, { onConflict: 'distributor,distributor_sku' });
    if (error) throw error;
  }

  // Zero out stock for anything previously synced from this distributor that
  // didn't appear in this run (delisted SKU, allow-list narrowed, etc) so
  // stale "in stock" items don't linger on the Shop page.
  const currentSkus = items.map(i => i.distributor_sku);
  let staleQuery = supabase
    .from('distributor_products')
    .update({ quantity_available: 0, last_synced_at: new Date().toISOString() })
    .eq('distributor', distributor);
  if (currentSkus.length > 0) {
    staleQuery = staleQuery.not('distributor_sku', 'in', `(${currentSkus.map(s => `"${s}"`).join(',')})`);
  }
  const { error } = await staleQuery;
  if (error) throw error;
}

module.exports = { getAllowedManufacturers, filterByAllowList, upsertDistributorProducts };
