// Downloads a distributor's product image to our own R2 bucket instead of
// hotlinking their CDN - Lipsey's docs explicitly say "please do not hotlink
// our images, download them to your own hosting solution before use," and
// the same courtesy applies to any future distributor with a similar policy,
// so this lives here rather than inside sync/lipseys.js specifically.
//
// Skips the actual download/upload if the key already exists in R2 - most
// items are unchanged between syncs, so a daily sync should only ever
// download images it hasn't seen before, not re-fetch the whole catalog's
// worth of photos every run.

// R2 object keys can't be trusted to arbitrary input - distributor filenames
// are usually safe, but strip anything that isn't alphanumeric/dot/dash/underscore
// so a weird filename can't be used to write outside the intended prefix.
// prefix namespaces by distributor, e.g. 'lipseys' -> keys like lipseys/abc123.jpg
export function imageKey(prefix, filename) {
  return `${prefix}/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

export async function cacheImage(env, { sourceUrl, prefix, filename }) {
  if (!sourceUrl || !filename) return null;

  const key = imageKey(prefix, filename);

  const existing = await env.DISTRIBUTOR_IMAGES.head(key);
  if (!existing) {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null; // skip this item's image, don't fail the whole sync over one bad photo
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    await env.DISTRIBUTOR_IMAGES.put(key, res.body, {
      httpMetadata: { contentType }
    });
  }

  return `https://${env.SITE_HOSTNAME}/distributor-images/${key}`;
}
