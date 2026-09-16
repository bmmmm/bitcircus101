#!/usr/bin/env node
/**
 * build-pinnwand-feed.mjs — RSS 2.0 feed of the job board ("Pinnwand",
 * pinnwand.html): one item per note that is up on the wall today.
 *
 * Live-only, like the event feeds: a company's posting arrives as a PR against
 * jobs.json on main and must not need a build commit, and a note whose `from`
 * is today has to appear without waiting for the next deploy. So this runs in
 * BOTH pipelines — the deploy job and the 30-minute calendar sync — and writes
 * into pinnwand/, which is gitignored on main and force-added on live.
 *
 * The runtime math is NOT recomputed here: which notes are up, how long they
 * hang and how a day is spelled all come from jobs-core.js, the same module the
 * browser renderer (jobs.js) and the CI gate (scripts/check-jobs.mjs) load —
 * loaded through createRequire because it is a UMD/CommonJS file (pattern:
 * check-jobs.mjs). Feed and page can therefore never disagree about whether a
 * note is still on the wall.
 *
 * Tone doctrine of the Pinnwand holds in the feed as well: no amount, no
 * vocabulary of buying (gates in tests/pinnwand-feed.spec.mjs, copied from
 * tests/jobs-data.spec.mjs). The karussell (Dauerplatz) is not in the feed: it
 * has no dates, so there is no "new" to announce.
 *
 * Usage: node scripts/build-pinnwand-feed.mjs [jobs.json] [out.xml]
 *   defaults: <repo>/jobs.json → <repo>/pinnwand/feed.xml
 * The file is always written, even when no note is up: a feed that 404s for a
 * week tells a reader the subscription is dead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { rssDocument, escXml, toRFC822, SITE_URL } from "./rss.mjs";
// Importing this module is inert (its main() is guarded) — we only want the
// one clock reader, so "today" means the same day here as on the event pages.
import { berlinToday } from "./build-event-pages.mjs";
// tmp + rename, so a reader never fetches a half-written feed — the same
// helper the event feeds use.
import { writeFileAtomic } from "./sync-events.mjs";

const require = createRequire(import.meta.url);
const JobsCore = require("../jobs-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const JOBS_PATH = path.join(root, "jobs.json");
export const FEED_PATH = path.join(root, "pinnwand", "feed.xml");

export const CHANNEL_TITLE = "bitcircus101 – Pinnwand";
export const CHANNEL_LINK = `${SITE_URL}/pinnwand`;
// Verbatim from pinnwand.html's meta description — the page and its feed make
// the same promise to a reader deciding whether to subscribe.
export const CHANNEL_DESCRIPTION =
  "Firmen hängen an der Pinnwand von bitcircus101 in Bonn einen Zettel mit ihrer Stellenanzeige auf – eine echte Wand im Hackspace statt Werbeplatz im Feed.";
export const CHANNEL_SELF_URL = `${SITE_URL}/pinnwand/feed.xml`;

/**
 * One `<item>`. The link goes to the vacancy itself (we host nothing, we link);
 * the way back to the wall is the last paragraph of the description, anchored
 * at the card's own id (jobs.js renders `id="job-<id>"`).
 *
 * The description carries HTML, so it is escaped twice: once for the markup it
 * embeds (company/day/id), once for the XML element that holds it.
 */
function itemXml(entry) {
  const from = JobsCore.formatDay(entry.from);
  const until = JobsCore.formatDay(JobsCore.lastDay(entry.from, entry.months));
  const body =
    `<p>${escXml(entry.company)}</p>` +
    `<p>hängt seit ${escXml(from)} · läuft bis ${escXml(until)}</p>` +
    `<p><a href="${escXml(`${SITE_URL}/pinnwand#job-${entry.id}`)}">zum Zettel an der Pinnwand</a></p>`;
  return `
    <item>
      <title>${escXml(`${entry.title} – ${entry.company}`)}</title>
      <link>${escXml(entry.url)}</link>
      <description>${escXml(body)}</description>
      <pubDate>${escXml(toRFC822(`${entry.from}T00:00:00Z`))}</pubDate>
      <guid isPermaLink="false">${escXml(`pinnwand-${entry.id}`)}</guid>
    </item>`;
}

/**
 * The whole feed as a string. Pure: `todayStr` ("YYYY-MM-DD") decides which
 * notes are up, so the window is testable without touching the wall clock.
 *
 * `lastBuildDate` is the newest active `from`, never new Date(): same notes →
 * same bytes → same ETag → a reader polling every 30 minutes gets a 304.
 */
export function generatePinnwandFeed(data, todayStr) {
  // activeEntries also fixes the order — `from` DESC, `id` ASC — so the feed
  // lists newest first exactly like the wall does.
  const entries = JobsCore.activeEntries((data && data.postings) || [], todayStr);
  return rssDocument(
    {
      title: CHANNEL_TITLE,
      link: CHANNEL_LINK,
      description: CHANNEL_DESCRIPTION,
      selfUrl: CHANNEL_SELF_URL,
      lastBuildDate: entries.length ? toRFC822(`${entries[0].from}T00:00:00Z`) : null,
    },
    entries.map(itemXml)
  );
}

export function main(argv = process.argv.slice(2)) {
  const src = argv[0] ? path.resolve(argv[0]) : JOBS_PATH;
  const out = argv[1] ? path.resolve(argv[1]) : FEED_PATH;

  let data = { postings: [] };
  if (fs.existsSync(src)) {
    // A corrupt jobs.json is loud on purpose: check-jobs.mjs guards it in CI
    // and in the deploy, so a parse error here means something upstream broke.
    data = JSON.parse(fs.readFileSync(src, "utf8"));
  } else {
    console.warn(`pinnwand-feed: ${src} not found — writing an empty channel`);
  }

  const xml = generatePinnwandFeed(data, berlinToday());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeFileAtomic(out, xml);
  const items = (xml.match(/<item>/g) || []).length;
  console.log(`pinnwand-feed: wrote ${out} (${items} item(s))`);
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
