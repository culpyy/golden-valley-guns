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

async function generateTrackingCode(supabase) {
  const year = new Date().getFullYear();
  const { count } = await supabase.from('builds').select('*', { count: 'exact', head: true });
  const num = String((count || 0) + 1).padStart(3, '0');
  return `GVG-${year}-${num}`;
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
    const trackingCode = await generateTrackingCode(supabase);

    const { error } = await supabase.from('builds').insert({
      tracking_code:  trackingCode,
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

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ trackingCode }) };
  } catch (err) {
    console.error('create-intake failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please call us instead.' }) };
  }
};
