// POST /api/admin/upload-gallery-image - photo/video upload for the
// standalone gallery_projects table (gallery.html). Same pattern as
// uploadBuildImage.js/uploadProductImage.js (same R2 bucket, own key
// prefix, own serving route) but deliberately not reusing
// uploadBuildImage.js - this media isn't attached to a build and
// shouldn't share a key prefix with ones that are.
//
// Handles video too (test-fire clips as the closing item in a project's
// showcase, alongside photos) - same endpoint, same bucket/prefix, just a
// wider allow-list and a bigger size cap for video files.

import { isAdminToken } from '../lib/adminAuth.js';

const ALLOWED_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const ALLOWED_VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleUploadGalleryImage(request, env) {
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdminToken(env, accessToken))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const contentType = request.headers.get('Content-Type') || '';
  const isVideo = contentType in ALLOWED_VIDEO_TYPES;
  const ext = ALLOWED_IMAGE_TYPES[contentType] || ALLOWED_VIDEO_TYPES[contentType];
  if (!ext) {
    return jsonResponse({ error: 'Unsupported file type - use JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.' }, 400);
  }

  // Streamed straight into R2 (request.body) rather than buffered via
  // request.arrayBuffer() first - a 100MB video buffered into memory on
  // top of the Worker's own overhead risks the isolate's ~128MB memory
  // ceiling. The client (a real Blob/File body via fetch, never chunked)
  // always sets a real Content-Length, so R2 gets a known length either
  // way - this doesn't hit the "stream must have a known length" failure
  // mode found in src/lib/imageCache.js (that one was a chunked-encoded
  // *outbound* fetch response, a different situation).
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (!contentLength) return jsonResponse({ error: 'Empty upload.' }, 400);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (contentLength > maxBytes) {
    return jsonResponse({ error: `File too large - ${maxBytes / (1024 * 1024)}MB max.` }, 400);
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await env.DISTRIBUTOR_IMAGES.put(`gallery/${filename}`, request.body, {
    httpMetadata: { contentType }
  });

  return jsonResponse({ url: `https://${env.SITE_HOSTNAME}/gallery-images/${filename}`, mediaType: isVideo ? 'video' : 'image' });
}
