/**
 * RSS 2.0 envelope shared by every feed the site emits — the event feeds
 * (scripts/sync-events.mjs) and the Pinnwand feed (scripts/build-pinnwand-feed.mjs).
 * One place for the channel boilerplate, so a channel-level change (image, ttl,
 * namespaces) lands in all feeds at once and the tests pin a single shape.
 *
 * Pure: no I/O, no clock. `lastBuildDate` is passed in by the caller, derived
 * from the content (newest item), never from `new Date()` — a feed whose bytes
 * only change when its items change keeps its ETag, and readers get a 304
 * instead of a re-download every poll.
 */

export const SITE_URL = "https://bitcircus101.de";

/** Channel image readers show next to the feed title (icon-192 is the PWA icon). */
export const FEED_IMAGE_URL = `${SITE_URL}/images/icon-192.png`;

/** Minutes a reader may cache the feed — the sync cron runs every 30 minutes. */
export const FEED_TTL_MINUTES = 30;

export function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function toRFC822(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toUTCString().replace("GMT", "+0000");
}

/**
 * Build one RSS 2.0 document.
 *
 * channel: { title, link, description, selfUrl, lastBuildDate, imageUrl }
 *   title/link/description — channel metadata (escaped here)
 *   selfUrl                — absolute URL of the feed itself (atom:link rel=self)
 *   lastBuildDate          — RFC822 string, or null/undefined to omit the element
 *   imageUrl               — channel image, defaults to FEED_IMAGE_URL
 * items: array of finished `<item>…</item>` strings, each starting with "\n"
 *        and indented four spaces (the callers own escaping and field order).
 */
export function rssDocument(channel, items) {
  const { title, link, description, selfUrl, lastBuildDate = null, imageUrl = FEED_IMAGE_URL } = channel;
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escXml(title)}</title>
    <link>${escXml(link)}</link>
    <description>${escXml(description)}</description>
    <language>de-de</language>
    <ttl>${FEED_TTL_MINUTES}</ttl>
    <image>
      <url>${escXml(imageUrl)}</url>
      <title>${escXml(title)}</title>
      <link>${escXml(link)}</link>
    </image>
`;
  if (lastBuildDate) {
    xml += `    <lastBuildDate>${escXml(lastBuildDate)}</lastBuildDate>\n`;
  }
  xml += `    <atom:link href="${escXml(selfUrl)}" rel="self" type="application/rss+xml"/>\n`;
  xml += items.join("");
  xml += `
  </channel>
</rss>
`;
  return xml;
}
