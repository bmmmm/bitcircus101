#!/usr/bin/env node
/**
 * build-event-pages.mjs — one static detail page per archived event under
 * /e/<id>/ (plus its own event.ics) and the archive index under /archiv/.
 * Run after the sync wrote events-archive.json:
 *   node scripts/build-event-pages.mjs [events-archive.json]
 *
 * Why the pages exist: a shared link has to keep resolving after the event has
 * left the calendar, and a link preview needs a page of its own — the /events
 * anchor shows a teaser of a list that no longer contains the event.
 *
 * Template = the checkout's own events.html. It is the only page that exists
 * both on main and on live (includes/ is deleted by the deploy), and on live it
 * already carries the deployed ?v= hash. Only its first <header> and first
 * <footer> are lifted out; the <head> is built here. Copying the template head
 * would drag in the 300-line JSON-LD @graph, the events-data.json preload and —
 * from the end of its body — an inline script bound to #linkup-info-btn that
 * throws "Cannot read properties of null" on any other page.
 *
 * Never fails the build: sync-events.yml runs this right after the feeds, and a
 * red step there would stop the feeds too. Missing template or missing archive
 * warn and write nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EventsCore from "../events-core.js";
import {
  ARCHIVE_FILE,
  SITE_URL,
  generateICS,
  loadArchive,
  syncFeedsDir,
  toJsonLdEvent,
  truncateDesc,
  writeFileAtomic,
} from "./sync-events.mjs";

const { stripTagLines } = EventsCore;

const TEMPLATE_FILE = "events.html";
const OG_IMAGE = `${SITE_URL}/images/og-image.jpg`;
const OG_IMAGE_ALT = "bitcircus101 – Offener Hackspace in Bonn";
// Nextcloud day view; the same fallback events.js uses when a card carries no
// calendarUrl of its own.
const CALENDAR_URL = "https://cloud.bitcircus101.de/apps/calendar";
// Meta description length: what search engines actually render.
const META_DESC_MAX = 160;
// Path segment guard — ids come from eventId() (12 lowercase hex), but the
// archive is a file on disk: anything else must never become a directory name.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

// ── Text helpers ────────────────────────────────────────────────────────────
// esc/linkify/paragraphs live in html-text.mjs, shared with the RSS
// <content:encoded> body in sync-events.mjs. Re-exported so the tests and any
// other importer keep one address for them.
export { esc, linkify, paragraphs } from "./html-text.mjs";
import { esc, paragraphs } from "./html-text.mjs";

// ── Dates ───────────────────────────────────────────────────────────────────

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Calendar arithmetic in UTC: dates here are wall-clock days, never instants. */
export function shiftDate(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** "2026-09-18" → "Freitag, 18. September 2026" */
export function formatDateLong(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${d}. ${MONTHS[m - 1]} ${y}`;
}

/** "2026-09-18" → "18.09.2026" */
export function formatDateShort(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return `${pad2(d)}.${pad2(m)}.${y}`;
}

function datetimeAttr(dateStr, timeStr) {
  return timeStr ? `${dateStr}T${timeStr}` : dateStr;
}

/**
 * The <time> markup for one entry. All-day events carry no clock; the archive's
 * endDate is the ICS DTEND — an EXCLUSIVE next-day boundary for all-day events,
 * so it is shifted back one day before it is shown (same correction as
 * toJsonLdEvent).
 */
export function renderWhen(entry) {
  const start = datetimeAttr(entry.date, entry.time);
  if (!entry.time) {
    const end = entry.endDate ? shiftDate(entry.endDate, -1) : null;
    if (end && end > entry.date) {
      return `<time datetime="${esc(entry.date)}">${esc(formatDateLong(entry.date))}</time> – ` +
        `<time datetime="${esc(end)}">${esc(formatDateLong(end))}</time>`;
    }
    return `<time datetime="${esc(entry.date)}">${esc(formatDateLong(entry.date))}</time>`;
  }
  const endDate = entry.endDate || entry.date;
  if (entry.endTime && endDate === entry.date) {
    return `<time datetime="${esc(start)}">${esc(formatDateLong(entry.date))}, ${esc(entry.time)}</time>–` +
      `<time datetime="${esc(datetimeAttr(endDate, entry.endTime))}">${esc(entry.endTime)}</time> Uhr`;
  }
  if (entry.endTime) {
    return `<time datetime="${esc(start)}">${esc(formatDateLong(entry.date))}, ${esc(entry.time)} Uhr</time> – ` +
      `<time datetime="${esc(datetimeAttr(endDate, entry.endTime))}">${esc(formatDateLong(endDate))}, ${esc(entry.endTime)} Uhr</time>`;
  }
  return `<time datetime="${esc(start)}">${esc(formatDateLong(entry.date))}, ${esc(entry.time)} Uhr</time>`;
}

/** Today in Europe/Berlin as YYYY-MM-DD — en-CA formats exactly that shape. */
export function berlinToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
}

// ── Template chrome ─────────────────────────────────────────────────────────

/** First top-level <tag>…</tag> block, scanned like inject-layout's replaceFirstBlock. */
function firstBlock(html, tagName) {
  const lower = html.toLowerCase();
  const start = lower.indexOf(`<${tagName.toLowerCase()}`);
  if (start === -1) return null;
  const openEnd = html.indexOf(">", start);
  if (openEnd === -1) return null;
  const closeNeedle = `</${tagName.toLowerCase()}>`;
  const closeStart = lower.indexOf(closeNeedle, openEnd + 1);
  if (closeStart === -1) return null;
  return html.slice(start, closeStart + closeNeedle.length);
}

/**
 * Lift header, footer and the asset version out of the template page. Returns
 * null when the page no longer has the expected shape — the caller warns and
 * writes nothing rather than shipping pages without navigation.
 */
export function extractChrome(templateHtml) {
  const html = String(templateHtml ?? "");
  const header = firstBlock(html, "header");
  const footer = firstBlock(html, "footer");
  const version = /style\.css\?v=([A-Za-z0-9_-]+)/.exec(html);
  if (!header || !footer || !version) return null;
  return { header, footer, assetVersion: version[1] };
}

// Left alone by rebase(): root-absolute (incl. protocol-relative //host),
// in-page anchors, and anything carrying a scheme (http:, mailto:, tel:,
// webcal:, data:).
const NOT_RELATIVE = /^(?:[/#]|[a-z][a-z0-9+.\-]*:)/i;

/**
 * The chrome's links are relative filenames ("events.html", "images/logo.svg"),
 * written for a page at the site root. A generated page sits `depth` levels
 * down, so every relative href/src/srcset value gets ../ × depth.
 */
export function rebase(fragment, depth) {
  const prefix = "../".repeat(depth);
  const one = (value) => (!value || NOT_RELATIVE.test(value) ? value : prefix + value);
  return String(fragment ?? "")
    .replace(/\b(href|src)="([^"]*)"/gi, (m, attr, value) => `${attr}="${one(value)}"`)
    .replace(/\bsrcset="([^"]*)"/gi, (m, value) => {
      const parts = value.split(",").map((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return trimmed;
        const [url, ...descriptors] = trimmed.split(/\s+/);
        return [one(url), ...descriptors].join(" ");
      });
      return `srcset="${parts.filter(Boolean).join(", ")}"`;
    });
}

// ── Head ────────────────────────────────────────────────────────────────────

/**
 * The shared <head>. Everything a crawler consumes names the clean URL
 * (canonical, og:url) — the generated pages are directory indexes, so their
 * own address already is the clean one.
 */
function headShell({ depth, assetVersion, title, description, canonical, robots, alternates, jsonLd }) {
  const p = "../".repeat(depth);
  const v = `?v=${esc(assetVersion)}`;
  const alt = alternates
    .map((a) => `        <link rel="alternate" type="${esc(a.type)}" title="${esc(a.title)}" href="${esc(a.href)}" />`)
    .join("\n");
  return `    <head>
        <meta charset="UTF-8" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${esc(title)}</title>
        <meta name="description" content="${esc(description)}" />
        <meta name="author" content="bitcircus101" />
        <meta name="robots" content="${esc(robots)}" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="${esc(canonical)}" />
        <meta property="og:title" content="${esc(title)}" />
        <meta property="og:description" content="${esc(description)}" />
        <meta property="og:image" content="${esc(OG_IMAGE)}" />
        <meta property="og:image:alt" content="${esc(OG_IMAGE_ALT)}" />
        <meta property="og:locale" content="de_DE" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${esc(title)}" />
        <meta name="twitter:description" content="${esc(description)}" />
        <meta name="twitter:image" content="${esc(OG_IMAGE)}" />
        <meta name="twitter:image:alt" content="${esc(OG_IMAGE_ALT)}" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="canonical" href="${esc(canonical)}" />
${alt}
        <link rel="icon" type="image/svg+xml" href="${p}images/favicon.svg${v}" />
        <link rel="apple-touch-icon" href="${p}images/apple-touch-icon.png${v}" />
        <link rel="manifest" href="${p}site.webmanifest${v}" />
        <script>
            // No-flash: apply the persisted light theme before the stylesheet paints.
            try { if (localStorage.getItem("bc.theme") === "light") document.documentElement.dataset.theme = "light"; } catch (e) {}
        </script>
        <link rel="stylesheet" href="${p}style.css${v}" />
${jsonLd}
    </head>`;
}

/** One schema.org node as a <script> block; "<" never survives raw inside it. */
function jsonLdBlock(node) {
  const json = JSON.stringify({ "@context": "https://schema.org", ...node }, null, 1).replace(/</g, "\\u003c");
  return `        <script type="application/ld+json">\n${json}\n        </script>`;
}

/** <head> of an event page (depth 2: /e/<id>/index.html). */
export function renderHead(entry, { assetVersion }) {
  const text = stripTagLines(entry.description || "").replace(/\s+/g, " ").trim();
  const fallback = `${entry.title} am ${formatDateLong(entry.date)} im bitcircus101, Hackspace in Bonn.`;
  return headShell({
    depth: 2,
    assetVersion,
    title: `${entry.title} – ${formatDateShort(entry.date)} – bitcircus101`,
    description: truncateDesc(text || fallback, META_DESC_MAX),
    canonical: `${SITE_URL}/e/${entry.id}/`,
    // A cancelled event keeps its page (shared links must resolve) but leaves
    // the index — "follow" so the crawler still reaches /events from here.
    robots: entry.cancelled ? "noindex, follow" : "index, follow",
    alternates: [
      { type: "application/rss+xml", title: "bitcircus101 Termine", href: "../../feed.xml" },
      { type: "text/calendar", title: `${entry.title} (iCal)`, href: "event.ics" },
    ],
    jsonLd: jsonLdBlock(toJsonLdEvent(entry)),
  });
}

/** <head> of the archive index (depth 1: /archiv/index.html). */
export function renderArchiveHead({ assetVersion }) {
  return headShell({
    depth: 1,
    assetVersion,
    title: "Archiv – bitcircus101",
    description:
      "Vergangene Termine im bitcircus101, Hackspace in Bonn — nach Jahr und Monat, mit eigener Seite je Termin.",
    canonical: `${SITE_URL}/archiv/`,
    robots: "index, follow",
    alternates: [
      { type: "application/rss+xml", title: "bitcircus101 Termine", href: "../feed.xml" },
      { type: "text/calendar", title: "bitcircus101 Termine (iCal)", href: "../ical.ics" },
    ],
    jsonLd: jsonLdBlock({
      "@type": "CollectionPage",
      name: "Archiv – bitcircus101",
      url: `${SITE_URL}/archiv/`,
    }),
  });
}

// ── Pages ───────────────────────────────────────────────────────────────────

/** events.js httpUrl(): a bare domain would render as a relative href and 404. */
function httpUrl(u) {
  if (!u) return u;
  if (u.charAt(0) === "/") return u;
  const scheme = /^([a-z][\w+.-]*):\/\//i.exec(u);
  if (scheme && /^https?$/i.test(scheme[1])) return u;
  return "https://" + u;
}

function osmHref(location) {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(location)}`;
}

/**
 * The page skeleton. Exactly two scripts: storage.js and main.js carry the nav
 * and the theme toggle, and both are listed in cache-bust.mjs ASSETS, so their
 * ?v= is stamped by the deploy like every other page's. Nothing else — a
 * generated page has no list to render and no filter to run.
 */
function shell({ head, header, footer, body, depth, assetVersion }) {
  const p = "../".repeat(depth);
  const v = `?v=${esc(assetVersion)}`;
  return `<!doctype html>
<html lang="de">
${head}
    <body>
        <a class="skip-link" href="#main-content">Zum Inhalt springen</a>
${header}
        <main id="main-content">
        <div class="container">
${body}
        </div>
        </main>
${footer}
        <script defer src="${p}storage.js${v}"></script>
        <script defer src="${p}main.js${v}"></script>
    </body>
</html>
`;
}

/**
 * One event page. `chrome` comes from extractChrome(); `todayStr` decides the
 * "vergangener Termin" note and is injectable so the output is testable without
 * mocking the clock.
 */
export function renderEventPage(entry, chrome, todayStr = berlinToday()) {
  const { assetVersion } = chrome;
  const parts = [];
  parts.push(`            <article class="event-page">`);
  parts.push(
    `                <p class="doc-path"><a href="../../index.html">~</a> ` +
      `<a href="../../events.html">/termine</a> /${esc(entry.id)}</p>`
  );
  parts.push(`                <h1>${esc(entry.title)}</h1>`);
  if (entry.subtitle) {
    parts.push(`                <p class="event-page__subtitle">${esc(entry.subtitle)}</p>`);
  }
  if (entry.cancelled) {
    parts.push(
      `                <p class="event-page__notice">Dieser Termin ist nicht mehr im Kalender.</p>`
    );
  } else if (entry.date < todayStr) {
    parts.push(`                <p class="event-page__past">vergangener Termin</p>`);
  }

  parts.push(`                <div class="event-page__meta">`);
  parts.push(`                    <p class="event-page__when">${renderWhen(entry)}</p>`);
  if (entry.location) {
    parts.push(
      `                    <a class="event-page__location" href="${esc(osmHref(entry.location))}" ` +
        `target="_blank" rel="noopener noreferrer" title="Auf Karte anzeigen">○ ${esc(entry.location)}</a>`
    );
  }
  if (entry.source && entry.source !== "bitcircus101") {
    parts.push(
      `                    <p class="event-page__source">${esc("Externer Kalender: " + entry.source)}</p>`
    );
  }
  parts.push(`                </div>`);

  const body = paragraphs(entry.description);
  if (body) {
    parts.push(`                <div class="event-page__body">`);
    parts.push(body.split("\n").map((l) => `                    ${l}`).join("\n"));
    parts.push(`                </div>`);
  }

  const tags = (entry.tags || []).filter(Boolean);
  if (tags.length) {
    parts.push(`                <p class="event-page__tags">`);
    for (const tag of tags) {
      const bare = String(tag).replace(/^#/, "");
      parts.push(
        `                    <a class="event-tag" href="../../events.html?tags=${esc(encodeURIComponent(bare))}">` +
          `${esc(tag)}</a>`
      );
    }
    parts.push(`                </p>`);
  }

  // External event URLs link straight to their page; a Nextcloud calendar URL
  // gets the day-view suffix, exactly like the card on /events.
  const calHref = entry.eventUrl
    ? httpUrl(entry.eventUrl)
    : `${httpUrl(entry.calendarUrl || CALENDAR_URL)}/timeGridDay/${entry.date}`;
  const calTitle = entry.eventUrl ? "Auf externer Seite öffnen" : "Im Kalender anzeigen";
  parts.push(`                <div class="event-page__actions">`);
  parts.push(
    `                    <a class="event-action event-action--cal" href="${esc(calHref)}" ` +
      `target="_blank" rel="noopener noreferrer" title="${esc(calTitle)}">→ kalender</a>`
  );
  parts.push(
    `                    <a class="event-action event-action--ics" href="event.ics" ` +
      `title="Diesen Termin als ICS laden">↓ ics</a>`
  );
  parts.push(
    `                    <a class="event-action event-action--back" href="../../events.html">← alle termine</a>`
  );
  parts.push(`                    <a class="event-action event-action--archive" href="../../archiv/">archiv</a>`);
  parts.push(`                </div>`);
  parts.push(`            </article>`);

  return shell({
    head: renderHead(entry, { assetVersion }),
    header: rebase(chrome.header, 2),
    footer: rebase(chrome.footer, 2),
    body: parts.join("\n"),
    depth: 2,
    assetVersion,
  });
}

/** Chronological key of an entry — date plus time, so a day sorts internally. */
function sortKey(e) {
  return `${e.date}T${e.time || "00:00"}`;
}

/**
 * The archive index: past, non-cancelled entries grouped year → month, newest
 * first. A cancelled event never happened, so it is not history — its page
 * stays reachable, the archive does not list it.
 */
export function renderArchiveIndex(entries, chrome, todayStr = berlinToday()) {
  const { assetVersion } = chrome;
  const past = (entries || [])
    .filter((e) => isRenderable(e) && e.date < todayStr && !e.cancelled)
    .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));

  const parts = [];
  parts.push(`            <section id="archiv" class="archive">`);
  parts.push(`                <p class="doc-path"><a href="../index.html">~</a> ` +
    `<a href="../events.html">/termine</a> /archiv</p>`);
  parts.push(`                <h1>Archiv</h1>`);
  parts.push(
    `                <p class="archive__intro">Vergangene Termine im bitcircus101 — jeder mit eigener Seite.</p>`
  );

  if (!past.length) {
    parts.push(`                <p class="archive__empty">Noch keine vergangenen Termine im Archiv.</p>`);
  } else {
    let year = null;
    let month = null;
    let open = false;
    for (const e of past) {
      const y = e.date.slice(0, 4);
      const m = e.date.slice(5, 7);
      if (y !== year) {
        if (open) {
          parts.push(`                </ul>`);
          open = false;
        }
        year = y;
        month = null;
        parts.push(`                <h2 class="archive__year">${esc(y)}</h2>`);
      }
      if (m !== month) {
        if (open) {
          parts.push(`                </ul>`);
          open = false;
        }
        month = m;
        parts.push(`                <h3 class="archive__month">${esc(MONTHS[Number(m) - 1])}</h3>`);
        parts.push(`                <ul class="archive__list">`);
        open = true;
      }
      const time = e.time ? ` <span class="archive__time">${esc(e.time)}</span>` : "";
      parts.push(
        `                    <li class="archive__row">` +
          `<time class="archive__date" datetime="${esc(datetimeAttr(e.date, e.time))}">${esc(formatDateShort(e.date))}</time> ` +
          `<a class="archive__title" href="../e/${esc(e.id)}/">${esc(e.title)}</a>${time}</li>`
      );
    }
    if (open) parts.push(`                </ul>`);
  }

  parts.push(`                <div class="event-page__actions">`);
  parts.push(
    `                    <a class="event-action event-action--back" href="../events.html">← alle termine</a>`
  );
  parts.push(`                </div>`);
  parts.push(`            </section>`);

  return shell({
    head: renderArchiveHead({ assetVersion }),
    header: rebase(chrome.header, 1),
    footer: rebase(chrome.footer, 1),
    body: parts.join("\n"),
    depth: 1,
    assetVersion,
  });
}

/**
 * Every file under e/ — index.html and event.ics per archived entry. The
 * archive index is written separately (it lives outside e/, and syncFeedsDir
 * owns every file in the directory it is given).
 */
/** An entry the generator can turn into a page: usable id (it becomes a
 *  directory name) and a YYYY-MM-DD date (it drives every date string). */
export function isRenderable(entry) {
  return !!entry && ID_RE.test(String(entry.id || "")) && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ""));
}

export function planPages(archive, chrome, todayStr = berlinToday()) {
  const entries = Object.values((archive && archive.events) || {});
  const files = [];
  for (const entry of entries) {
    if (!isRenderable(entry)) {
      console.warn(`::warning::event-pages: skipping entry with unusable id/date ${JSON.stringify(entry && [entry.id, entry.date])}`);
      continue;
    }
    files.push({ path: `e/${entry.id}/index.html`, data: renderEventPage(entry, chrome, todayStr) });
    // DTSTAMP from firstSeen, not from now: a rebuild must not rewrite every
    // ics on every run (syncFeedsDir only writes what changed). A missing or
    // unparsable firstSeen (hand-edited archive) falls back to now instead of
    // throwing — this step must never fail the sync.
    const stamp = Number.isFinite(Date.parse(entry.firstSeen)) ? entry.firstSeen : new Date().toISOString();
    files.push({ path: `e/${entry.id}/event.ics`, data: generateICS([entry], stamp) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

function main() {
  const archiveFile = process.argv[2] || process.env.EVENT_PAGES_ARCHIVE || ARCHIVE_FILE;
  const todayStr = berlinToday();

  let template;
  try {
    template = fs.readFileSync(TEMPLATE_FILE, "utf8");
  } catch (err) {
    console.warn(`::warning::event-pages: ${TEMPLATE_FILE} unreadable (${err.message}) — no pages written`);
    return;
  }
  const chrome = extractChrome(template);
  if (!chrome) {
    console.warn(
      `::warning::event-pages: ${TEMPLATE_FILE} has no <header>/<footer>/style.css?v= to build on — no pages written`
    );
    return;
  }

  // A missing archive is the first run, not an error — the archive index still
  // gets written so /archiv/ is never a 404.
  let archive = { version: 1, events: {} };
  try {
    archive = loadArchive(archiveFile);
  } catch (err) {
    console.warn(`::warning::event-pages: ${archiveFile} skipped: ${err.message}`);
    return;
  }

  const files = planPages(archive, chrome, todayStr);
  const stats = syncFeedsDir("e", files);
  fs.mkdirSync("archiv", { recursive: true });
  const index = renderArchiveIndex(Object.values(archive.events), chrome, todayStr);
  const indexFile = path.join("archiv", "index.html");
  let existing = null;
  try {
    existing = fs.readFileSync(indexFile, "utf8");
  } catch { /* new file */ }
  if (existing !== index) writeFileAtomic(indexFile, index);

  const past = Object.values(archive.events).filter((e) => e.date < todayStr && !e.cancelled).length;
  console.log(
    `event-pages: ${files.length / 2} event page(s) (${stats.written} written, ${stats.removed} removed), ` +
      `archiv/index.html with ${past} past entr${past === 1 ? "y" : "ies"}`
  );
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
