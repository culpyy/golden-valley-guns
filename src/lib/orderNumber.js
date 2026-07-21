// Order numbers are a plain sequential number (e.g. "1001"), not letters -
// something a customer can read aloud or write down. Backed by a real
// Postgres identity column (order_seq, see sql/numeric_order_numbers.sql)
// rather than a "SELECT MAX + 1" in application code, which would have the
// same race condition just fixed for stock reservations: two concurrent
// checkouts could both read the same max and compute the same "next"
// number. Postgres assigns identity values atomically at insert time, so
// that can't happen here.
//
// Because the identity value is only assigned once the row is actually
// inserted, this is necessarily a two-step process: insert first (order_number
// left null), then fill in order_number from the order_seq Postgres just
// assigned. Shared between src/api/checkout.js and src/api/specialOrder.js -
// both create rows in `orders` this same way.
export async function insertOrderWithNumber(supabase, orderData) {
  const { data: row, error: insertError } = await supabase
    .from('orders')
    .insert(orderData)
    .select()
    .single();
  if (insertError) throw insertError;

  const orderNumber = String(row.order_seq);
  const { data: numbered, error: updateError } = await supabase
    .from('orders')
    .update({ order_number: orderNumber })
    .eq('id', row.id)
    .select()
    .single();
  if (updateError) throw updateError;

  return numbered;
}
