// Facebook stopped offering a public RSS feed for Pages years ago, and the
// embed widget (what bulletin.html used before this) exposes no post data,
// only an opaque iframe - no timestamps to sort by. Getting real post data
// (message, date, photo) requires the Graph API and a Page Access Token,
// set as the FACEBOOK_PAGE_ACCESS_TOKEN Worker secret. A Page token derived
// from a long-lived User token (see the setup instructions given alongside
// this) doesn't expire on its own, unlike a plain short-lived token.
//
// Safe failure mode by design (same pattern as is_admin()'s placeholder
// UUID elsewhere in this codebase): if the secret isn't set yet, this
// returns an empty post list instead of erroring, so the merged activity
// feed on bulletin.html just shows YouTube + bulletin ideas until the
// token is added.
const GRAPH_VERSION = 'v19.0';

export async function handleFacebookFeed(request, env) {
  if (!env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ posts: [] }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
  }

  const fields = 'message,created_time,full_picture,permalink_url,attachments{media_type}';
  const graphUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/posts?fields=${fields}&limit=10&access_token=${env.FACEBOOK_PAGE_ACCESS_TOKEN}`;

  const res = await fetch(graphUrl);
  if (!res.ok) {
    console.error('Facebook Graph API error:', await res.text());
    return new Response(JSON.stringify({ posts: [] }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
  }

  const data = await res.json();
  const posts = (data.data || [])
    // Skip posts with neither text nor a photo - nothing to show as a card.
    .filter(p => p.message || p.full_picture)
    .map(p => ({
      id: p.id,
      message: p.message || '',
      image: p.full_picture || '',
      published: p.created_time,
      url: p.permalink_url || '',
      // Reels and regular video posts both come back as media_type
      // "video" on the first attachment - used client-side to embed
      // Facebook's video player instead of a static photo.
      isVideo: p.attachments?.data?.[0]?.media_type === 'video'
    }));

  return new Response(JSON.stringify({ posts }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=1800'
    }
  });
}
