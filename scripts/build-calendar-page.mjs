#!/usr/bin/env node
/**
 * build-calendar-page.mjs — /calendar/, the one place that lists every way to
 * subscribe to the calendar. Run after the sync wrote events-data.json:
 *   node scripts/build-calendar-page.mjs [events-data.json]
 *
 * Why the page exists: subscription links pointed straight at the calendar
 * backend, so a backend change meant hunting links down page by page. This page
 * is built from configuration instead, so it follows a change on the next sync:
 *  - the complete calendar of each primary (rss:true) source, from its `ics` in
 *    calendars/ — every event, past and far ahead;
 *  - the feeds this site generates itself (/ical.ics, /feeds/…), from the `feeds`
 *    manifest in events-data.json. Their URLs never change, but they are a
 *    window: only the next ≤40 upcoming events, nothing past — which is why the
 *    complete calendar is listed first and the window is spelled out.
 * The old Nextcloud view link redirects here.
 *
 * Same contract as build-event-pages.mjs: live-only (calendar/ is gitignored on
 * main), chrome lifted from the checkout's events.html, never fails the sync.
 * Unlike the archive it does not need the archive file — with no manifest it
 * still lists the primary feeds, so the redirect target is never a 404.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_URL, loadCalendars, writeFileAtomic } from "./sync-events.mjs";
import { extractChrome, headShell, jsonLdBlock, rebase, shell } from "./build-event-pages.mjs";
import { esc } from "./html-text.mjs";

const TEMPLATE_FILE = "events.html";
const DATA_FILE = "events-data.json";
const OUT_FILE = path.join("calendar", "index.html");
const CANONICAL = `${SITE_URL}/calendar/`;

// What the sync writes today; used when events-data.json is missing or carries
// no manifest, so the page always offers at least these.
const FALLBACK_FEEDS = {
  primary: { ics: "/ical.ics", rss: "/feed.xml" },
  all: { ics: "/feeds/all.ics", rss: "/feeds/all.xml" },
  sources: {},
};

/** A URL or root-absolute path → the absolute https URL and its webcal twin. */
export function feedUrls(p) {
  const https = new URL(p, SITE_URL).href;
  return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
}

/** One subscribe row: title, then webcal / ics / rss buttons (as on /rss). */
function row(title, entry) {
  if (!entry || !entry.ics) return "";
  const ics = feedUrls(entry.ics);
  const rss = entry.rss ? feedUrls(entry.rss).https : null;
  return [
    `                <div class="events-subscribe">`,
    `                    <div class="events-subscribe__row">`,
    `                        <h3 class="events-subscribe__title">${esc(title)}</h3>`,
    `                        <div class="events-subscribe__actions">`,
    `                            <a class="events-subscribe__btn" href="${esc(ics.webcal)}" title="Kalender abonnieren (webcal)">&#8595; abonnieren</a>`,
    `                            <a class="events-subscribe__btn" href="${esc(ics.https)}" title="iCal-Adresse – zum Kopieren in eine Kalender-App">ics</a>`,
    rss
      ? `                            <a class="events-subscribe__btn" href="${esc(rss)}" title="RSS-Feed">rss</a>`
      : "",
    `                        </div>`,
    `                    </div>`,
    `                </div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The manifest from events-data.json, or the fallback when it has none. */
export function manifestOf(data) {
  const feeds = data && data.feeds;
  if (!feeds || !feeds.primary || !feeds.primary.ics) return FALLBACK_FEEDS;
  return feeds;
}

/** The complete calendars to list: the primary (rss:true) sources' own ICS. */
export function completeCalendars(calendars) {
  return (calendars || [])
    .filter((c) => c && c.rss === true && typeof c.ics === "string" && /^https?:\/\//i.test(c.ics))
    .map((c) => ({ name: c.name || c.id, ics: c.ics }));
}

export function renderCalendarPage(feeds, chrome, complete = []) {
  const sources = Object.entries(feeds.sources || {}).filter(([, s]) => s && s.ics);
  const parts = [];
  parts.push(`            <section id="calendar">`);
  parts.push(`                <p class="doc-path"><a href="../index.html">~</a> /calendar</p>`);
  parts.push(
    `                <h1>Kalender abonnieren<a class="section-anchor" href="#calendar" aria-label="Link zu: Kalender abonnieren">#</a></h1>`
  );
  parts.push(`                <p>`);
  parts.push(`                    Unser Kalender läuft nicht mehr über Nextcloud. Bestehende Abos`);
  parts.push(`                    funktionieren weiter. Die aktuellen Abo-Adressen stehen immer hier –`);
  parts.push(`                    ändert sich etwas, steht es zuerst auf dieser Seite.`);
  parts.push(`                </p>`);
  parts.push(`            </section>`);

  if (complete.length) {
    parts.push(``);
    parts.push(`            <section id="komplett" class="panel">`);
    parts.push(
      `                <h2>kompletter kalender<a class="section-anchor" href="#komplett" aria-label="Link zu: kompletter Kalender">#</a></h2>`
    );
    parts.push(`                <p>Alle Termine, auch vergangene und weit im Voraus geplante.</p>`);
    for (const c of complete) parts.push(row(c.name, { ics: c.ics }));
    parts.push(`            </section>`);
  }

  parts.push(``);
  parts.push(`            <section id="feeds" class="panel">`);
  parts.push(
    `                <h2>feeds dieser website<a class="section-anchor" href="#feeds" aria-label="Link zu: Feeds dieser Website">#</a></h2>`
  );
  parts.push(`                <p>`);
  parts.push(`                    Erzeugt die Website alle 30 Minuten selbst, mit Adressen, die sich nie`);
  parts.push(`                    ändern – aber als Ausschnitt: nur die nächsten anstehenden Termine`);
  parts.push(`                    (höchstens 40), keine vergangenen.`);
  parts.push(`                </p>`);
  parts.push(row("bitcircus101", feeds.primary));
  parts.push(row("alle termine inkl. befreundeter spaces", feeds.all));
  if (sources.length) {
    parts.push(`                <p>Einzeln je Quelle:</p>`);
    for (const [, s] of sources) parts.push(row(s.name, s));
  }
  parts.push(`            </section>`);

  parts.push(``);
  parts.push(`            <section id="wie" class="panel">`);
  parts.push(
    `                <h2>wie abonnieren<a class="section-anchor" href="#wie" aria-label="Link zu: Wie abonnieren">#</a></h2>`
  );
  parts.push(`                <p>`);
  parts.push(`                    „abonnieren" öffnet die Kalender-App auf deinem Gerät (Apple Kalender,`);
  parts.push(`                    Thunderbird, Outlook). Für Google Kalender oder Nextcloud die`);
  parts.push(`                    ics-Adresse kopieren und dort als Abo („per URL") hinzufügen. Nach`);
  parts.push(`                    Schlagwort filtern: auf <a href="../events.html#kalender">/termine</a>,`);
  parts.push(`                    RSS für alles andere: <a href="../rss.html">/rss</a>.`);
  parts.push(`                </p>`);
  parts.push(`            </section>`);

  const assetVersion = chrome.assetVersion;
  return shell({
    head: headShell({
      depth: 1,
      assetVersion,
      title: "Kalender abonnieren – bitcircus101",
      description:
        "Die Termine des bitcircus101, Hackspace in Bonn, als Kalender-Abo (iCal/webcal) und RSS – alle Abo-Adressen an einem Ort.",
      canonical: CANONICAL,
      robots: "index, follow",
      alternates: [
        { type: "application/rss+xml", title: "bitcircus101 Termine", href: "../feed.xml" },
        { type: "text/calendar", title: "bitcircus101 Termine (iCal)", href: "../ical.ics" },
      ],
      jsonLd: jsonLdBlock({ "@type": "WebPage", name: "Kalender abonnieren – bitcircus101", url: CANONICAL }),
    }),
    header: rebase(chrome.header, 1),
    footer: rebase(chrome.footer, 1),
    body: parts.join("\n"),
    depth: 1,
    assetVersion,
  });
}

function main() {
  const dataFile = process.argv[2] || DATA_FILE;
  let template;
  try {
    template = fs.readFileSync(TEMPLATE_FILE, "utf8");
  } catch (err) {
    console.warn(`::warning::calendar-page: ${TEMPLATE_FILE} unreadable (${err.message}) — no page written`);
    return;
  }
  const chrome = extractChrome(template);
  if (!chrome) {
    console.warn(`::warning::calendar-page: ${TEMPLATE_FILE} has no <header>/<footer>/style.css?v= — no page written`);
    return;
  }

  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (err) {
    console.warn(`::warning::calendar-page: ${dataFile} unreadable (${err.message}) — listing the primary feeds only`);
  }
  let complete = [];
  try {
    complete = completeCalendars(loadCalendars());
  } catch (err) {
    console.warn(`::warning::calendar-page: calendars/ unreadable (${err.message}) — no complete-calendar links`);
  }
  const feeds = manifestOf(data);
  const html = renderCalendarPage(feeds, chrome, complete);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  let existing = null;
  try {
    existing = fs.readFileSync(OUT_FILE, "utf8");
  } catch { /* new file */ }
  if (existing !== html) writeFileAtomic(OUT_FILE, html);
  console.log(
    `calendar-page: ${OUT_FILE} with ${complete.length} complete calendar(s), ` +
      `${Object.keys(feeds.sources || {}).length} source feed(s)`
  );
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
