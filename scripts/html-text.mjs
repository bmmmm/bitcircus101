/**
 * Text → HTML helpers shared by the renderers that turn a calendar description
 * into markup: the event pages (scripts/build-event-pages.mjs) and the RSS
 * <content:encoded> body (scripts/sync-events.mjs). One implementation, so a
 * description reads the same on the page and in a feed reader.
 *
 * Pure: no I/O. stripTagLines comes from events-core.js (the UMD module the
 * browser shares), so the trailing #hashtag lines are dropped the same way the
 * /events cards drop them.
 */
import EventsCore from "../events-core.js";

const { stripTagLines } = EventsCore;

/** HTML-escape a text node or a double-quoted attribute value. */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape first, then link only http(s) URLs. Order matters: escaping afterwards
 * would eat the markup this function just produced. Opaque schemes
 * (javascript:, data:) are never matched, so they stay text — the descriptions
 * come from a calendar anyone in the space can write to.
 */
export function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (match) => {
    // Sentence punctuation clings to a URL far more often than it belongs to
    // it; strip it from the href but keep it in the visible text.
    const tail = /[.,;:!?)\]]+$/.exec(match);
    const url = tail ? match.slice(0, -tail[0].length) : match;
    if (!/^https?:\/\/\S/.test(url)) return match;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail ? tail[0] : ""}`;
  });
}

/**
 * Description → paragraphs. Blank line starts a new <p>, a single newline is a
 * <br>. stripTagLines drops the trailing #hashtag lines, which are already
 * rendered as tag chips (page) or <category> elements (feed).
 */
export function paragraphs(text) {
  const stripped = stripTagLines(String(text ?? "")).trim();
  if (!stripped) return "";
  return stripped
    .split(/\n{2,}/)
    .map((p) => `<p>${linkify(p).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}
