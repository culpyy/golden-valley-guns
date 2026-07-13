// Public-facing intake endpoint. Lets a customer generate a tracking code and
// printable shipping slip before mailing something in, so boxes stop showing
// up with no name/contact info attached. Writes through the service-role
// client since the anon key can't insert into `builds` directly (RLS is
// public SELECT / authenticated INSERT only).

const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

const SERVICE_TYPE_LABELS = {
  custom_build: 'Custom Build',
  parts_kit:    'Parts Kit Build',
  gunsmithing:  'Gunsmithing / Repair',
  transfer:     'FFL Transfer',
  other:        'Other'
};

// Derived from the highest code already issued this year, not a row count -
// a count-based scheme collides forever once any build is ever deleted
// (admin dashboard supports deleting builds), since the count drops but
// codes already in use don't.
async function generateTrackingCode(supabase, offset = 0) {
  const year = new Date().getFullYear();
  const { data, error } = await supabase
    .from('builds')
    .select('tracking_code')
    .like('tracking_code', `GVG-${year}-%`)
    .order('tracking_code', { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = data && data[0] ? parseInt(data[0].tracking_code.split('-')[2], 10) : 0;
  const num = String((Number.isFinite(last) ? last : 0) + 1 + offset).padStart(3, '0');
  return `GVG-${year}-${num}`;
}

// This function and the admin dashboard can both create builds - two
// submissions landing at the same moment can compute the same code. Retry
// with an incrementing offset on a unique-constraint violation (Postgres
// code 23505) instead of failing.
async function insertWithUniqueTrackingCode(supabase, buildData, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const trackingCode = await generateTrackingCode(supabase, i);
    const { error } = await supabase.from('builds').insert({ ...buildData, tracking_code: trackingCode });
    if (!error) return trackingCode;
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not generate a unique tracking code after multiple attempts.');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  // Honeypot: legitimate submissions never fill this. Silently "succeed"
  // without writing anything so bots don't learn it was rejected.
  if (payload.botField) {
    return { statusCode: 200, body: JSON.stringify({ trackingCode: 'GVG-0000-000' }) };
  }

  const customerName  = (payload.customerName || '').trim();
  const customerEmail = (payload.customerEmail || '').trim();
  const customerPhone = (payload.customerPhone || '').trim();
  const serviceType   = (payload.serviceType || '').trim();
  const firearmType   = (payload.firearmType || 'Other').trim();
  const caliber       = (payload.caliber || '').trim();
  const isNfa         = !!payload.isNfa;
  const notes          = (payload.notes || '').trim();

  if (!customerName || !serviceType || (!customerEmail && !customerPhone)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Name, a service type, and either an email or phone number are required.' })
    };
  }

  const serviceLabel = SERVICE_TYPE_LABELS[serviceType] || serviceType;

  try {
    const supabase = getSupabaseAdmin();

    const trackingCode = await insertWithUniqueTrackingCode(supabase, {
      title:          `${serviceLabel}${firearmType && firearmType !== 'Other' ? ' - ' + firearmType : ''}`,
      type:           firearmType,
      caliber:        caliber || null,
      status:         'intake',
      is_nfa:         isNfa,
      received:       new Date().toLocaleDateString('en-CA'),
      notes:          `Service requested: ${serviceLabel}${notes ? '\n\n' + notes : ''}`,
      customer_name:  customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone
    });

    return { statusCode: 200, body: JSON.stringify({ trackingCode }) };
  } catch (err) {
    console.error('create-intake failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please call us instead.' }) };
  }
};
