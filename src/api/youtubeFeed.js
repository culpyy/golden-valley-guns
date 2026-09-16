// Shawn's YouTube channel has no API key on file and doesn't need one - every
// public channel exposes a free Atom feed of its uploads
// (youtube.com/feeds/videos.xml?channel_id=...) with no auth, no quota, and
// nothing to rotate or expire. Fetched here (server-side, not from the
// browser) purely to dodge YouTube not setting CORS headers on that feed -
// a same-origin request to this route is what the page actually calls.
const CHANNEL_ID = 'UCRIezIM_qIvuAnVeTpnjD0w';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function handleYoutubeFeed(request, env) {
  const res = await fetch(FEED_URL);
  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch YouTube feed.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const xml = await res.text();
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .slice(0, 6)
    .map(([, block]) => {
      const videoId = block.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1] ?? '';
      const title = decodeXmlEntities(block.match(/<media:title>(.*?)<\/media:title>/)?.[1] ?? '');
      const thumbnail = block.match(/<media:thumbnail url="(.*?)"/)?.[1] ?? '';
      const published = block.match(/<published>(.*?)<\/published>/)?.[1] ?? '';
      return { videoId, title, thumbnail, published, url: `https://www.youtube.com/watch?v=${videoId}` };
    })
    .filter(v => v.videoId);

  return new Response(JSON.stringify({ videos }), {
    headers: {
      'Content-Type': 'application/json',
      // Public and changes rarely - cache at the edge so a busy page doesn't
      // hit YouTube's feed on every single visitor.
      'Cache-Control': 'public, max-age=1800'
    }
  });
}
