#!/usr/bin/env node
/**
 * Inject upcoming bitcircus101 events into lite/index.html between
 * <!-- lite-events:start --> and <!-- lite-events:end --> markers.
 * Run after syncing events-data.json: pnpm run build:lite-events
 *
 * Scope: events only. The "Projekte & Kosten" block and the "Stand" date next
 * to it belong to build-lite-finanz.mjs — this script used to stamp that date
 * with new Date(), which dated hand-frozen funding figures to the day of the
 * deploy. The date now comes from finanz.json's own `updated` field.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const LITE = path.join(root, "lite", "index.html");
const EVENTS_JSON = path.join(root, "events-data.json");
const BITCIRCUS_CAL = path.join(root, "calendars", "bitcircus.json");

const START = "<!-- lite-events:start -->";
const END = "<!-- lite-events:end -->";
const MAX_EVENTS = 8;

const DAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
const MONTHS = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = DAYS[dt.getDay()];
  const month = MONTHS[m - 1];
  const time = timeStr ? ` · ${timeStr}` : "";
  return `${day} ${d}. ${month}${time}`;
}

export function toDatetime(dateStr, timeStr) {
  return timeStr ? `${dateStr}T${timeStr}` : dateStr;
}

export function normalizeUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^webcal:\/\//i.test(u)) return u;
  if (/^[a-z0-9-]+\./i.test(u)) return "https://" + u;
  return null;
}

export function buildMarkup(events, icsUrl, rssPath) {
  if (!events.length) {
    return `<p class="dim">Keine Termine eingetragen — <a href="../events.html">Veranstaltungen</a></p>`;
  }
  const items = events
    .map((e) => {
      const url = normalizeUrl(e.eventUrl);
      const label = url
        ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(e.title)}</a>`
        : esc(e.title);
      return `<li><time datetime="${esc(toDatetime(e.date, e.time))}" class="dim">${formatDate(e.date, e.time)}</time> — ${label}</li>`;
    })
    .join("\n");

  // The subscribe links stay on the Nextcloud calendar: that is the real,
  // always-current subscription, while the generated feeds are a snapshot of
  // the sync window.
  const webcal = icsUrl ? icsUrl.replace(/^https?:\/\//, "webcal://") : null;
  const subLinks = icsUrl
    ? `<a href="${esc(webcal)}" rel="noopener noreferrer">Kalender-Abo ↗</a> · <a href="${esc(icsUrl)}" rel="noopener noreferrer">ICS ↗</a> · `
    : "";

  return `<ul>\n${items}\n</ul>\n<p class="dim">→ ${subLinks}<a href="${esc(rssPath)}">RSS-Feed</a> · <a href="../events.html">Alle Termine</a></p>`;
}

/**
 * Which RSS feed the lite page should advertise. The manifest is keyed by
 * calendar id, so the source is resolved by its card-facing `name`, exactly as
 * the events page does (events.js feedScope). Falls back to `fallback` when the
 * manifest has no bitcircus feed — see the comment at the call site for why the
 * per-source feed is preferred over the primary one.
 */
export function resolveRssPath(data, fallback = "../feed.xml") {
  const sources = (data && data.feeds && data.feeds.sources) || {};
  for (const id of Object.keys(sources)) {
    if (sources[id].name === "bitcircus101" && sources[id].rss) return sources[id].rss;
  }
  return fallback;
}

/**
 * The bitcircus101 events from `todayStr` onwards, chronological, capped at
 * MAX_EVENTS. Pure: the caller passes today in, so the selection is testable
 * without mocking the clock.
 */
export function selectUpcoming(data, todayStr) {
  const all = (data && data.events) || [];
  return all
    .filter((e) => e.source === "bitcircus101" && e.date >= todayStr)
    .sort((a, b) => {
      const ka = a.date + (a.time || "");
      const kb = b.date + (b.time || "");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .slice(0, MAX_EVENTS);
}

function main() {
  const now = new Date();
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  let icsUrl = null;
  if (fs.existsSync(BITCIRCUS_CAL)) {
    const cal = JSON.parse(fs.readFileSync(BITCIRCUS_CAL, "utf8"));
    icsUrl = cal.ics || null;
  }

  // Default to the primary feed; it is bitcircus-only today (the sole source
  // with rss:true) but that is a config flag, not a guarantee — flip rss:true
  // on a second source and this page would advertise a feed listing events it
  // does not show. The per-source feed is bitcircus by construction, so prefer
  // it whenever the manifest lists it.
  let rssPath = "../feed.xml";

  let upcoming = [];
  if (fs.existsSync(EVENTS_JSON)) {
    const data = JSON.parse(fs.readFileSync(EVENTS_JSON, "utf8"));
    rssPath = resolveRssPath(data, rssPath);
    upcoming = selectUpcoming(data, todayStr);
  }

  const markup = buildMarkup(upcoming, icsUrl, rssPath);
  let html = fs.readFileSync(LITE, "utf8");

  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1) {
    throw new Error(`lite-events markers not found in ${LITE}`);
  }

  html = html.slice(0, si + START.length) + "\n" + markup + "\n" + html.slice(ei);

  fs.writeFileSync(LITE, html, "utf8");
  console.log(`lite-events: injected ${upcoming.length} event(s) into lite/index.html`);
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
