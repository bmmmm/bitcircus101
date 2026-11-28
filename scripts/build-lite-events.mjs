#!/usr/bin/env node
/**
 * Inject the upcoming events at bitcircus101 (own + home sources, like the
 * events page's default view) into lite/index.html between
 * <!-- lite-events:start --> and <!-- lite-events:end --> markers.
 * Run after syncing events-data.json: pnpm run build:lite-events
 * Against other files (a fixture; the tracked page stays clean):
 *   node scripts/build-lite-events.mjs <events-data.json> <lite.html>
 *
 * One line per series: almost every event is a date of a series, and a weekly
 * one took three of the eight lines while the monthly linkup fell off the end
 * (measured on the live data, October 2026). A series shows its next date —
 * with its rhythm, "jeden Dienstag" / "jeden 3. Freitag" (events-core
 * rhythmLabel) — and a cancelled date keeps a line of its own, struck through
 * and labelled like on /events. "läuft" / "heute" / "morgen" stand after the
 * date (events-core whenWord) — as of the build, which runs hourly: the date
 * stays, so a late build leaves a stale word, never a wrong date.
 *
 * Scope: events only. The "Projekte & Kosten" block and the "Stand" date next
 * to it belong to build-lite-finanz.mjs — this script used to stamp that date
 * with new Date(), which dated hand-frozen funding figures to the day of the
 * deploy. The date now comes from finanz.json's own `updated` field.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import EventsCore from "../events-core.js";
import { esc } from "./html-text.mjs";

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
      // Cancelled — rename, don't delete (events-core isCancelledTitle): the
      // title without the marker, struck through, labelled.
      const cancelled = EventsCore.isCancelledTitle(e.title);
      const title = esc(cancelled ? EventsCore.stripCancelMarker(e.title) : e.title);
      const shown = cancelled ? `<s>${title}</s>` : title;
      // The title leads to the event's own page (the sync flags `page`); an
      // external link stays the second way.
      const ext = url ? `<a href="${esc(url)}" rel="noopener noreferrer">${shown}</a>` : shown;
      const label = e.id && e.page
        ? `<a href="../e/${esc(e.id)}/">${shown}</a>` +
          (url ? ` · <a href="${esc(url)}" rel="noopener noreferrer">extern</a>` : "")
        : ext;
      // Inside the <time>: on a phone the date line takes it along.
      const word = !cancelled && e.word ? ` <span class="jetzt">${esc(e.word)}</span>` : "";
      // another group's event names it and links their site (events-core origin)
      const from = e.origin
        ? ` <span class="dim">· ${e.origin.kind} ` +
          (e.origin.href ? `<a href="${esc(e.origin.href)}" rel="noopener noreferrer">${esc(e.origin.name)} ↗</a>` : esc(e.origin.name)) +
          `</span>`
        : "";
      const note = cancelled
        ? ` <span class="abgesagt"><span aria-hidden="true">✕ </span>abgesagt</span>`
        : e.rhythm ? ` <span class="dim">· ${esc(e.rhythm)}</span>` : "";
      // The dash is its own span: on a phone the date takes a line of its
      // own and the dash goes (the page's CSS).
      return `<li${cancelled ? ' class="cancelled"' : ""}>` +
        `<time datetime="${esc(toDatetime(e.date, e.time))}" class="when">${formatDate(e.date, e.time)}${word}</time>` +
        `<span class="sep"> — </span>${label}${note}${from}</li>`;
    })
    .join("\n");

  // The subscribe links stay on our calendar (the `ics` of calendars/bitcircus.json): that is the real,
  // always-current subscription, while the generated feeds are a snapshot of
  // the sync window.
  const webcal = icsUrl ? icsUrl.replace(/^https?:\/\//, "webcal://") : null;
  const subLinks = icsUrl
    ? `<a href="${esc(webcal)}" rel="noopener noreferrer">Kalender-Abo ↗</a> · <a href="${esc(icsUrl)}" rel="noopener noreferrer">ICS ↗</a> · `
    : "";

  return `<ul class="termine">\n${items}\n</ul>\n<p class="dim">→ ${subLinks}<a href="${esc(rssPath)}">RSS-Feed</a> · <a href="../events.html">Alle Termine</a></p>`;
}

/**
 * Which RSS feed the lite page should advertise: the primary feed, which
 * carries exactly the sources this list shows (own + home — feed.xml follows
 * inPrimaryFeed, the list follows relationOf, both default to the home set).
 * The manifest names its path; `fallback` when there is no manifest.
 */
export function resolveRssPath(data, fallback = "../feed.xml") {
  const primary = data && data.feeds && data.feeds.primary;
  return (primary && primary.rss) || fallback;
}

/**
 * The events at bitcircus101 not over at `now` (events-core isOver: a running
 * event stays until its end, an all-day one the whole day), chronological,
 * capped at MAX_EVENTS: our own calendar and the home sources, never a friend's (the
 * data's sources list says which is which; pre-field data has no friends).
 * A series (events-core seriesKey) takes one line, its next date, and carries
 * `rhythm` — the sync's (toCards, over every date to the horizon), else
 * rhythmLabel over the dates the window holds, cancelled ones included: a
 * week off does not change the rhythm — `word` (whenWord at `now`) and
 * `origin` (events-core origin: whose event, when not ours). A cancelled date is
 * always a line of its own, so the next real date of its series follows it.
 * Returns copies; the input stays untouched.
 * Pure: the caller passes `now` (a Date) in, so the selection is testable
 * without mocking the clock.
 */
export function selectUpcoming(data, now) {
  const all = (data && data.events) || [];
  const relations = EventsCore.relationMap(data && data.sources);
  const sites = EventsCore.siteMap(data && data.sources);
  const upcoming = all
    .filter((e) => EventsCore.sourceRelation(relations, e.source) !== "friend" && !EventsCore.isOver(e, now))
    .sort((a, b) => {
      const ka = a.date + (a.time || "");
      const kb = b.date + (b.time || "");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const dates = new Map();
  for (const e of upcoming) {
    const key = EventsCore.seriesKey(e);
    if (key) dates.set(key, (dates.get(key) || []).concat(e.date));
  }
  const shown = new Set();
  const out = [];
  for (const e of upcoming) {
    if (out.length === MAX_EVENTS) break;
    const key = EventsCore.seriesKey(e);
    if (key && EventsCore.isCancelledTitle(e.title)) {
      out.push({ ...e, rhythm: "", word: EventsCore.whenWord(e, now), origin: EventsCore.origin(relations, sites, e) });
      continue;
    }
    if (key && shown.has(key)) continue;
    if (key) shown.add(key);
    // the sync's rhythm (every date to the horizon) first, else the window's
    const rhythm = key ? e.rhythm || EventsCore.rhythmLabel(dates.get(key)) : "";
    out.push({ ...e, rhythm, word: EventsCore.whenWord(e, now), origin: EventsCore.origin(relations, sites, e) });
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const eventsFile = argv[0] ? path.resolve(argv[0]) : EVENTS_JSON;
  const liteFile = argv[1] ? path.resolve(argv[1]) : LITE;
  let icsUrl = null;
  if (fs.existsSync(BITCIRCUS_CAL)) {
    const cal = JSON.parse(fs.readFileSync(BITCIRCUS_CAL, "utf8"));
    icsUrl = cal.ics || null;
  }

  // The primary feed: it carries the same sources this list shows (see
  // resolveRssPath), so the page never advertises events it does not list.
  let rssPath = "../feed.xml";

  let upcoming = [];
  if (fs.existsSync(eventsFile)) {
    const data = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
    rssPath = resolveRssPath(data, rssPath);
    upcoming = selectUpcoming(data, new Date());
  }

  const markup = buildMarkup(upcoming, icsUrl, rssPath);
  let html = fs.readFileSync(liteFile, "utf8");

  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1) {
    throw new Error(`lite-events markers not found in ${liteFile}`);
  }

  html = html.slice(0, si + START.length) + "\n" + markup + "\n" + html.slice(ei);

  fs.writeFileSync(liteFile, html, "utf8");
  console.log(`lite-events: injected ${upcoming.length} event(s) into ${liteFile === LITE ? "lite/index.html" : liteFile}`);
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
