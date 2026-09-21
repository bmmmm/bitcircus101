#!/usr/bin/env node
/**
 * build-status-data.mjs — the small JSON behind /status (status.html): every
 * event of the primary calendar since STATUS_SINCE, reduced to the five fields
 * the timeline needs. Derived from events-archive.json, which is 230+ KB and
 * growing — the page must never load that directly.
 *
 * Live-only, like the event pages: the archive exists on the live branch only,
 * so this runs in BOTH pipelines (the 30-minute sync and the deploy) and its
 * output is gitignored on main and force-added on live. No timestamp in the
 * output on purpose: same archive → same bytes → the sync's "No changes" path
 * still fires when nothing happened.
 *
 * Never fails the sync for a missing archive (first run before a primary
 * source answered): warn and write nothing — status.js then shows "Verlauf
 * gerade nicht verfügbar". A corrupt archive throws, exactly as loadArchive
 * does for build-event-pages.mjs: never overwrite state with nothing.
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
import { loadArchive, writeFileAtomic } from "./sync-events.mjs";
import { berlinToday } from "./build-event-pages.mjs";

// UMD/CommonJS, like the other *-core.js modules: the streak the page brags
// about is the same function the timeline is built from, never a second count.
const require = createRequire(import.meta.url);
const StatusCore = require("../status-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const ARCHIVE_PATH = path.join(root, "events-archive.json");
export const STATUS_PATH = path.join(root, "status-data.json");
export const HOME_PATH = path.join(root, "index.html");
export const STREAK_START = "<!-- status-streak:start -->";
export const STREAK_END = "<!-- status-streak:end -->";
/** First day on the status page — the site's first linkup on record. */
export const STATUS_SINCE = "2025-05-25";
export const PRIMARY_SOURCE = "bitcircus101";
/** One row per event `type`, in page order. status.html carries the same
 *  labels statically (first paint); these travel along for the incident list. */
export const SERIES = [
  { key: "linkup", label: "Linkup", hint: "freitags ab 20 Uhr, jeden dritten Freitag mit Lightning Talks" },
  { key: "workshop", label: "Workshops", hint: "angekündigte Workshops" },
  { key: "special", label: "Specials", hint: "Sonderformate" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = new Set(SERIES.map((s) => s.key));

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pure: archive in, status data out. Exactly five fields per event (the size
 * guard — descriptions alone are most of the archive's bytes), `cancelled`
 * always a real boolean (the archive omits the key when false), sorted by date
 * then id so the output is diff-stable and the browser never sorts.
 */
export function buildStatusData(archive) {
  const events = Object.values((archive && archive.events) || {})
    .filter((e) => e && typeof e.id === "string" && typeof e.date === "string" && DATE_RE.test(e.date))
    .filter((e) => e.source === PRIMARY_SOURCE && KEYS.has(e.type) && e.date >= STATUS_SINCE)
    .map((e) => ({
      id: e.id,
      date: e.date,
      title: typeof e.title === "string" ? e.title : "",
      series: e.type,
      cancelled: e.cancelled === true,
    }))
    .sort((a, b) => (a.date === b.date ? cmp(a.id, b.id) : cmp(a.date, b.date)));
  return { version: 1, since: STATUS_SINCE, series: SERIES.map((s) => ({ ...s })), events };
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
  const data = buildStatusData(loadArchive(src));
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
