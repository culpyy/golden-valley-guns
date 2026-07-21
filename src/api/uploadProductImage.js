// POST /api/admin/upload-product-image - lets Shawn attach a real photo to
// his own hand-curated products (products table) from the admin dashboard,
// same as distributor items already get automatically via the Lipsey's
// sync (src/lib/imageCache.js). Stores to the same R2 bucket those use
// (DISTRIBUTOR_IMAGES), under a products/ key prefix, served back out
// through the /product-images/ route in worker.js.
//
// Admin-gated the same way notify-build-status.js is - without that, this
// would be an open file-upload endpoint for anyone who found the URL.

import { isAdminToken } from '../lib/adminAuth.js';

const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 5 * 1024 * 1024;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleUploadProductImage(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const rawSlug = (url.searchParams.get('slug') || 'product').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const slug = rawSlug || 'product';

  const contentType = request.headers.get('Content-Type') || '';
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return jsonResponse({ error: 'Unsupported image type - use JPEG, PNG, WebP, or GIF.' }, 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return jsonResponse({ error: 'Empty upload.' }, 400);
  if (body.byteLength > MAX_BYTES) return jsonResponse({ error: 'Image too large - 5MB max.' }, 400);

  const filename = `${slug}-${Date.now()}.${ext}`;
  await env.DISTRIBUTOR_IMAGES.put(`products/${filename}`, body, {
    httpMetadata: { contentType }
  });

  return jsonResponse({ url: `https://${env.SITE_HOSTNAME}/product-images/${filename}` });
}
