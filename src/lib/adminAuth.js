// Shared admin check for Worker routes that would otherwise trust the
// client (notify-build-status, upload-product-image). The admin dashboard
// already relies on Supabase RLS (is_admin(), see sql/security_hardening.sql)
// to gate direct table writes - these two UIDs mirror that same function's
// hardcoded list so a Worker route can re-check "is this really an admin"
// without a Postgres connection of its own, just a REST call to Supabase
// Auth to resolve the caller's access token to a user id.
const ADMIN_UIDS = [
  '8b89e241-45be-412b-b726-2b755da4e2a7', // Shawn
  'e7f8beab-e4d3-4169-936e-c0df314a2a92'  // Braeden
];

export async function isAdminToken(env, accessToken) {
  if (!accessToken) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!res.ok) return false;
  const user = await res.json();
  return ADMIN_UIDS.includes(user?.id);
}
