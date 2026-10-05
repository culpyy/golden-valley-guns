// Server-side half of the kit/platform catalog (sql/kit_platforms.sql). The
// intake page suggests catalog names as the customer types, but anything can
// still arrive here (JavaScript blocked, an old cached page, a direct POST),
// so the Worker maps whatever it gets onto a catalog name before saving. Same
// matching rule as js/kit-catalog.js: case, spaces and punctuation ignored,
// against the name or any alias.

const platformKey = t => String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9]/g, '');

// Returns the catalog name for a match, otherwise the text exactly as the
// customer typed it. Never throws - a catalog problem must not block an
// intake submission.
export async function canonicalKitName(supabase, typed) {
  const text = typeof typed === 'string' ? typed.trim() : '';
  if (!text) return typed || null;
  try {
    const { data, error } = await supabase.from('kit_platforms').select('name, aliases').eq('is_active', true);
    if (error || !data) return text;
    const k = platformKey(text);
    const hit = data.find(r => platformKey(r.name) === k || (r.aliases || []).some(a => platformKey(a) === k));
    return hit ? hit.name : text;
  } catch (err) {
    console.error('Kit platform lookup failed (using the text as typed):', err);
    return text;
  }
}
