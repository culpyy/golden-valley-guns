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
    // R2's put() needs a body with a known length up front - passing
    // res.body (a raw ReadableStream) straight through throws "Provided
    // readable stream must have a known length" whenever the source serves
    // the image with chunked transfer-encoding and no Content-Length
    // (confirmed live 2026-08-07 against lipseyscloud.com). Buffering into
    // an ArrayBuffer always has a definite byteLength regardless of how the
    // source sent it - images here are small enough that buffering one at a
    // time costs nothing meaningful.
    const body = await res.arrayBuffer();
    await env.DISTRIBUTOR_IMAGES.put(key, body, {
      httpMetadata: { contentType }
    });
  }

  return `https://${env.SITE_HOSTNAME}/distributor-images/${key}`;
}

// Deliberately separate from the main catalog sync (which just upserts
// price/stock/etc and leaves image_url null for new rows, stashing the
// distributor's own filename in image_source_name instead). Doing image
// work inline during the main sync is what blew Cloudflare's
// subrequest-per-invocation limit on the very first live Lipsey's run -
// with several manufacturers allow-listed, hundreds of items matched, and
// even a couple hundred image fetches in one invocation was too many.
// This runs as its own tightly-bounded pass: pull a small batch of rows
// still missing an image, catch them up, done. Called once per sync, so a
// large backlog just takes several days of daily cron runs to fully catch
// up - pricing/stock data is never blocked waiting on images.
export async function backfillImages(supabase, env, { distributor, prefix, buildSourceUrl, limit = 20 }) {
  const { data: rows, error } = await supabase
    .from('distributor_products')
    .select('id, image_source_name')
    .eq('distributor', distributor)
    .is('image_url', null)
    .not('image_source_name', 'is', null)
    .limit(limit);
  if (error) throw error;
  if (!rows.length) return 0;

  let cached = 0;
  for (const row of rows) {
    const url = await cacheImage(env, { sourceUrl: buildSourceUrl(row.image_source_name), prefix, filename: row.image_source_name });
    if (!url) continue;
    const { error: updateError } = await supabase.from('distributor_products').update({ image_url: url }).eq('id', row.id);
    if (updateError) throw updateError;
    cached++;
  }
  return cached;
}
