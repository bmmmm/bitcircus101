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
 * Usage: node scripts/build-status-data.mjs [events-archive.json] [out.json]
 *   defaults: <repo>/events-archive.json → <repo>/status-data.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Importing this module is inert (its main() is guarded). writeFileAtomic is
// tmp + rename, so a reader never fetches a half-written file.
import { loadArchive, writeFileAtomic } from "./sync-events.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const ARCHIVE_PATH = path.join(root, "events-archive.json");
export const STATUS_PATH = path.join(root, "status-data.json");
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
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
