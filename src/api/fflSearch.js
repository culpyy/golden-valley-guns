// GET /api/ffl-search?q=<text>&state=<AZ> - typeahead over the ATF FFL
// snapshot in ffl_directory (see sql/ffl_directory.sql). Public but
// rate-limited in worker.js; returns at most 8 rows and needs 3+ characters
// so it can't be used to dump the table.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleFflSearch(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').toLowerCase().replace(/[%_,()*\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const state = (url.searchParams.get('state') || '').toUpperCase().trim();
  if (q.length < 3) return jsonResponse({ results: [] });

  const supabase = getSupabaseAdmin(env);
  let query = supabase.from('ffl_directory')
    .select('license, business_name, name, street, city, state, zip, phone')
    .limit(8);
  for (const word of q.split(' ').slice(0, 6)) query = query.ilike('search', `%${word}%`);
  if (/^[A-Z]{2}$/.test(state)) query = query.eq('state', state);

  const { data, error } = await query;
  if (error) {
    console.error('ffl-search failed:', error);
    return jsonResponse({ error: 'Search failed.' }, 500);
  }
  return jsonResponse({
    results: (data || []).map(r => ({
      license: r.license,
      businessName: r.business_name || r.name,
      address: `${r.street}, ${r.city}, ${r.state} ${r.zip}`,
      phone: r.phone && r.phone.length === 10 ? `(${r.phone.slice(0, 3)}) ${r.phone.slice(3, 6)}-${r.phone.slice(6)}` : (r.phone || '')
    }))
  });
}

// Used by pay.js/checkout.js: does the license (or, failing that, the
// phone number) on an order match ATF's list? Never blocks a payment - it
// only annotates the order for Shawn's manual verification.
export async function matchFfl(env, { licenseNumber, phone }) {
  try {
    const supabase = getSupabaseAdmin(env);
    const key = (licenseNumber || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const digits = (phone || '').replace(/\D/g, '').slice(-10);
    let row = null;
    if (key.length >= 12) {
      ({ data: row } = await supabase.from('ffl_directory').select('license, business_name, name, street, city, state, zip, expires').eq('license_key', key).maybeSingle());
      if (!row) return { match: false, note: `License ${licenseNumber} was not found on the ATF list (snapshot). Verify manually.` };
    } else if (digits.length === 10) {
      const { data } = await supabase.from('ffl_directory').select('license, business_name, name, street, city, state, zip, expires').eq('phone', digits).limit(2);
      if (data?.length === 1) row = data[0];
    }
    if (!row) return { match: null, note: null };
    return {
      match: true,
      license: row.license,
      note: `Matches ATF list: ${row.business_name || row.name}, ${row.street}, ${row.city}, ${row.state} ${row.zip} (license ${row.license}). Still confirm it's current before shipping.`
    };
  } catch (err) {
    console.error('matchFfl failed (order proceeds unannotated):', err);
    return { match: null, note: null };
  }
}
