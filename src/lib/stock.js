// Shared by src/api/checkout.js (reserve on charge) and src/api/refundOrder.js
// (release on refund) - split out so a refund can actually put stock back,
// which it couldn't do while these lived as checkout.js-local functions.
//
// Atomic - see sql/atomic_stock_reservation.sql for why this has to be a
// single SQL UPDATE with the quantity check in the WHERE clause rather than
// a JS-level "read, check, write." Confirmed via a live burst test
// (2026-07-20) that the previous read-then-write approach let 8/8
// concurrent requests pass a 3-unit stock check simultaneously - this is
// the actual fix, not a narrower race window.
export async function reserveStock(supabase, id, qty) {
  const { data, error } = await supabase.rpc('reserve_product_stock', { p_id: id, p_qty: qty });
  if (error) throw error;
  return data === true;
}

export async function releaseStock(supabase, id, qty) {
  const { error } = await supabase.rpc('release_product_stock', { p_id: id, p_qty: qty });
  if (error) console.error(`Failed to release ${qty} of ${id} back to stock:`, error);
}
