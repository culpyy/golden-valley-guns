// POST /api/admin/upload-gallery-image - photo upload for the standalone
// gallery_photos table (gallery.html). Same pattern as uploadBuildImage.js/
// uploadProductImage.js (same R2 bucket, own key prefix, own serving route)
// but deliberately not reusing uploadBuildImage.js - these photos aren't
// attached to a build and shouldn't share a key prefix with ones that are.

import { isAdminToken } from '../lib/adminAuth.js';

const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 10 * 1024 * 1024;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleUploadGalleryImage(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const contentType = request.headers.get('Content-Type') || '';
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return jsonResponse({ error: 'Unsupported image type - use JPEG, PNG, WebP, or GIF.' }, 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return jsonResponse({ error: 'Empty upload.' }, 400);
  if (body.byteLength > MAX_BYTES) return jsonResponse({ error: 'Image too large - 10MB max.' }, 400);

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await env.DISTRIBUTOR_IMAGES.put(`gallery/${filename}`, body, {
    httpMetadata: { contentType }
  });

  return jsonResponse({ url: `https://${env.SITE_HOSTNAME}/gallery-images/${filename}` });
}
