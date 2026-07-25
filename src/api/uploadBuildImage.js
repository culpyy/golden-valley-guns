// POST /api/admin/upload-build-image - lets Shawn attach a real completed-build
// photo from the admin dashboard, for the gallery.html showcase. Same pattern
// as uploadProductImage.js: same R2 bucket (DISTRIBUTOR_IMAGES), just a
// builds/ key prefix, served back out through /build-images/ in worker.js.
//
// Admin-gated the same way - without this, it'd be an open file-upload
// endpoint for anyone who found the URL.

import { isAdminToken } from '../lib/adminAuth.js';

const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 5 * 1024 * 1024;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleUploadBuildImage(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const rawId = (url.searchParams.get('buildId') || 'build').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const buildId = rawId || 'build';

  const contentType = request.headers.get('Content-Type') || '';
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return jsonResponse({ error: 'Unsupported image type - use JPEG, PNG, WebP, or GIF.' }, 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return jsonResponse({ error: 'Empty upload.' }, 400);
  if (body.byteLength > MAX_BYTES) return jsonResponse({ error: 'Image too large - 5MB max.' }, 400);

  const filename = `${buildId}-${Date.now()}.${ext}`;
  await env.DISTRIBUTOR_IMAGES.put(`builds/${filename}`, body, {
    httpMetadata: { contentType }
  });

  return jsonResponse({ url: `https://${env.SITE_HOSTNAME}/build-images/${filename}` });
}
