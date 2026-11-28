#!/usr/bin/env node
/**
 * build-status-data.mjs — the small JSON behind /status (status.html): every
 * event of the primary calendar since STATUS_SINCE, reduced to whether it took
 * place — date, series, cancelled, nothing else. Privacy by design: no title,
 * no id (an id leads to the event page and its title), so the history of who
 * met when stays out of this file and out of the live branch's git history.
 * Derived from events-archive.json, which is 230+ KB and growing — the page
 * must never load that directly.
 *
 * Live-only, like the event pages: the archive exists on the live branch only,
 * so this runs in BOTH pipelines (the hourly sync and the deploy) and its
 * output is gitignored on main and force-added on live. No timestamp in the
 * output on purpose: same archive → same bytes → the sync's "No changes" path
 * still fires when nothing happened.
 *
 * Never fails the sync for a missing archive (first run before a primary
 * source answered): warn and write nothing — status.js then shows "Verlauf
 * gerade nicht verfügbar". A corrupt archive throws, exactly as loadArchive
 * does for build-event-pages.mjs: never overwrite state with nothing.
 *
 * `cancelled` comes from the archive alone (mergeArchive sets it for a vanished
 * entry, `cancelledBy: "vanished"`, and for a title carrying the owner's
 * marker, `cancelledBy: "title"` — see events-core isCancelledTitle), so the
 * event pages, the feeds and this page never disagree. One rule is added here:
 * a vanished entry counts only after MIN_VISIBLE_DAYS in the export (lastSeen
 * day − firstSeen day); a shorter-lived one was a typo, not an event, and is
 * left out entirely — neither cancelled nor "happened". A marked title is the
 * owner's word and never noise.
 *
 * It also stamps the homepage's one-line uptime brag (the streak of weeks that
 * held an event) between the <!-- status-streak:start/end --> markers in
 * index.html — the same idea as the footer's funding percent: a number on the
 * landing page must cost neither a request nor a script there. The text
 * committed on main is the fallback for a checkout with no archive.
 *
 * Usage: node scripts/build-status-data.mjs [events-archive.json] [out.json]
 *   defaults: <repo>/events-archive.json → <repo>/status-data.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Importing these modules is inert (their main() is guarded). writeFileAtomic is
// tmp + rename, so a reader never fetches a half-written file; berlinToday is
// the one clock reader the event pages use, so "today" means the same day here.
import { loadArchive, loadCalendars, writeFileAtomic } from "./sync-events.mjs";
import { berlinToday } from "./build-event-pages.mjs";

// UMD/CommonJS, like the other *-core.js modules: the streak the page brags
// about is the same function the timeline is built from, never a second count.
const require = createRequire(import.meta.url);
const StatusCore = require("../status-core.js");
const EventsCore = require("../events-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const ARCHIVE_PATH = path.join(root, "events-archive.json");
export const STATUS_PATH = path.join(root, "status-data.json");
export const HOME_PATH = path.join(root, "index.html");
export const STREAK_START = "<!-- status-streak:start -->";
export const STREAK_END = "<!-- status-streak:end -->";
/** First day on the status page — the site's first linkup on record. */
export const STATUS_SINCE = "2025-05-25";
/** The relation of each source (own / home / friend) comes from here. */
export const CALENDARS_DIR = path.join(root, "calendars");
/** A vanished entry counts as cancelled only after this many calendar days in the
 *  export (lastSeen day − firstSeen day); shorter-lived ones were typos, not events. */
export const MIN_VISIBLE_DAYS = 3;
/** One row per event `type`, in page order. status.html carries the labels
 *  and the one-line descriptions statically (first paint); only the labels
 *  travel along, for the incident list. */
export const SERIES = [
  { key: "linkup", label: "Linkup" },
  { key: "workshop", label: "Workshops" },
  { key: "special", label: "Specials" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = new Set(SERIES.map((s) => s.key));

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Calendar days between the firstSeen day and the lastSeen day, both as Berlin
 *  dates — lastSeen is written as one (sync-events' todayStr), so firstSeen's
 *  UTC stamp is read through the same clock (berlinToday). Missing, unparsable
 *  or out-of-order stamps read as Infinity: a hand-edited archive must never
 *  swallow a real cancellation, only a measured short life does. */
export function visibleDays(entry) {
  const firstStamp = Date.parse(String(entry.firstSeen || ""));
  const first = Number.isFinite(firstStamp) ? Date.parse(berlinToday(new Date(firstStamp)) + "T00:00:00Z") : NaN;
  const last = Date.parse(String(entry.lastSeen || "") + "T00:00:00Z");
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return Infinity;
  return Math.round((last - first) / 86400000);
}

/** A vanished entry that was in the export for less than MIN_VISIBLE_DAYS — a
 *  typo that got deleted, not an event. A marked title is never noise. */
export function isNoise(entry) {
  return entry.cancelled === true && entry.cancelledBy !== "title" && visibleDays(entry) < MIN_VISIBLE_DAYS;
}

/**
 * Pure: archive in, status data out. Exactly three fields per event — when,
 * which series, held or not; anything more is a privacy leak, not a feature.
 * `cancelled` is always a real boolean (the archive omits the key when false),
 * sorted by date, series, then cancelled so the output is diff-stable and the
 * browser never sorts.
 *
 * `relations` (source name → own/home/friend, events-core relationMap) decides
 * whose events count: everything at bitcircus101, never a friend's calendar.
 */
export function buildStatusData(archive, relations = null) {
  const events = Object.values((archive && archive.events) || {})
    .filter((e) => e && typeof e.id === "string" && typeof e.date === "string" && DATE_RE.test(e.date))
    .filter((e) => EventsCore.sourceRelation(relations, e.source) !== "friend" && KEYS.has(e.type) && e.date >= STATUS_SINCE)
    // a removed series' date (mergeArchive) was neither held here nor called off
    .filter((e) => !isNoise(e) && !e.removed)
    .map((e) => ({ date: e.date, series: e.type, cancelled: e.cancelled === true }))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.series, b.series) || cmp(a.cancelled, b.cancelled));
  return { version: 2, since: STATUS_SINCE, series: SERIES.map((s) => ({ ...s })), events };
}

/**
 * The homepage line — a link like its siblings in that panel ("label: text →").
 * Without a run of weeks it falls back to the sentence committed on main: true
 * whatever the archive says, and never "0 wochen in folge".
 */
export function streakMarkup(weeks) {
  const text = weeks
    ? `${weeks} ${weeks === 1 ? "woche" : "wochen"} in folge offen`
    : "freitags offen seit mai 2025";
  return `<a href="status.html">status: ${text} &#8594;</a>`;
}

/** Splice the line between the markers. A missing marker is loud: the homepage
 *  would otherwise keep a number that quietly stopped being updated. */
export function injectStreak(html, markup) {
  const si = html.indexOf(STREAK_START);
  const ei = html.indexOf(STREAK_END);
  if (si === -1 || ei === -1) {
    throw new Error(`status-streak markers not found in ${HOME_PATH}`);
  }
  return html.slice(0, si + STREAK_START.length) + markup + html.slice(ei);
}

export function main(argv = process.argv.slice(2)) {
  const src = argv[0] ? path.resolve(argv[0]) : ARCHIVE_PATH;
  const out = argv[1] ? path.resolve(argv[1]) : STATUS_PATH;
  if (!fs.existsSync(src)) {
    console.warn(`::warning::status-data: ${src} not found — nothing written (no primary source archived yet?)`);
    return;
  }
  let relations = null;
  try {
    relations = EventsCore.relationMap(loadCalendars(CALENDARS_DIR));
  } catch (err) {
    console.warn(`::warning::status-data: ${CALENDARS_DIR} unreadable (${err.message}) — every source counts`);
  }
  const data = buildStatusData(loadArchive(src), relations);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeFileAtomic(out, JSON.stringify(data, null, 2) + "\n");
  console.log(`status-data: wrote ${out} (${data.events.length} event(s))`);

  // The homepage brag. Same archive, same math as the timeline; skipped when
  // index.html is not next to us (a caller pointing the script elsewhere).
  const home = argv[2] ? path.resolve(argv[2]) : HOME_PATH;
  if (!fs.existsSync(home)) {
    console.warn(`::warning::status-data: ${home} not found — homepage line untouched`);
    return;
  }
  const { weeks } = StatusCore.streak(data.events, berlinToday());
  const before = fs.readFileSync(home, "utf8");
  const after = injectStreak(before, streakMarkup(weeks));
  if (after !== before) writeFileAtomic(home, after);
  console.log(`status-data: homepage streak ${weeks} week(s)${after === before ? " (unchanged)" : ""}`);
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
