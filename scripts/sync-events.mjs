#!/usr/bin/env node
/**
 * sync-events.mjs — Fetches ICS from Nextcloud calendars, generates events-data.json + feed.xml
 * Reads calendar sources via the manifest calendars/config.json. Add new calendars there — no code changes needed.
 * Runs in GitHub Actions (Node 22, no dependencies).
 */

const SITE_URL = "https://bitcircus101.de";
// Canonical address of the events page. The site is served with clean URLs
// (/events.html 308-redirects to /events), so every outward-facing link — RSS
// <link>, JSON-LD url, sitemap entry, the page's own canonical — has to use the
// extension-less form. One constant keeps the RSS item link and the JSON-LD url
// byte-identical, which aggregators rely on to key the same occurrence.
const EVENTS_URL = `${SITE_URL}/events`;

import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import ICSCore from "../ics-core.js";
import EventsCore from "../events-core.js";

// ICS parsing primitives are shared with the browser fallback (events.js) via the
// UMD module ics-core.js — single source of truth, no drift between the two parsers.
const { parseDate, parseDuration, nthWeekday, expandRRule, clean, parseICS, eventAnchor } = ICSCore;
// Card shaping (tags, type, toCards) is shared the same way via events-core.js, so
// the browser's live-ICS fallback renders the same cards as the generated JSON.
// Re-exported below so tests and check-calendars.mjs keep importing from here.
const { isInternal, guessType, extractHashtags, keywordTags, buildTags, cleanLocation, truncateDesc, toCards } = EventsCore;

const CAL_DIR = "calendars";
const CAL_CONFIG_FILE = "config.json";

/**
 * Load calendar sources via the manifest at calendars/config.json. Each source
 * lives in its own JSON file (calendars/bitcircus.json, calendars/external/foo.json,
 * etc.) and is included by listing its path under `sources`. Order in the manifest
 * = order of processing. Remove an entry to disable a source without deleting its
 * file. Entries without `id` or `ics` are skipped with a warning so one malformed
 * file never breaks the whole sync.
 *
 * `dir` is injectable so tests (and check-calendars.mjs) can point the loader at a
 * fixture directory instead of the repo's real calendars/.
 */
function loadCalendars(dir = CAL_DIR) {
  const config = JSON.parse(readFileSync(`${dir}/${CAL_CONFIG_FILE}`, "utf8"));
  const sources = Array.isArray(config?.sources) ? config.sources : [];
  const loaded = [];
  for (const rel of sources) {
    const path = `${dir}/${rel}`;
    try {
      const entry = JSON.parse(readFileSync(path, "utf8"));
      if (!entry?.id || !entry?.ics) {
        console.warn(`[${path}] missing id or ics — skipped`);
        continue;
      }
      loaded.push(entry);
    } catch (e) {
      console.warn(`[${path}] load error: ${e.message} — skipped`);
    }
  }
  return loaded;
}

// ── Transform to card format ────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

/**
 * Filter ICS events by calendar config. Used by ics-filtered sources.
 *
 *   filter.categoryAllow  — array of category names; event must have at least one (case-insensitive exact match)
 *   filter.categoryDeny   — array of category names; event with any match is excluded
 *   filter.titleAllow     — array of substrings; event title must contain at least one (case-insensitive)
 *   filter.titleDeny      — array of substrings; event title matching any is excluded
 *
 * Deny-first: if any deny rule matches, event is out. Allow-rules only narrow further.
 * Empty/missing rule = "no constraint".
 */
function applyFilter(icsEvents, filter) {
  if (!filter) return icsEvents;
  const { categoryAllow, categoryDeny, titleAllow, titleDeny } = filter;
  const lc = (s) => (s || "").toLowerCase();
  const catMatch = (cats, needles) => needles?.some((n) => cats.includes(lc(n)));
  const titleMatch = (title, needles) => needles?.some((n) => title.includes(lc(n)));
  return icsEvents.filter((e) => {
    const cats = (e.categories || "").split(",").map((c) => lc(c.trim())).filter(Boolean);
    const title = lc(e.summary);
    if (catMatch(cats, categoryDeny)) return false;
    if (titleMatch(title, titleDeny)) return false;
    if (categoryAllow?.length && !catMatch(cats, categoryAllow)) return false;
    if (titleAllow?.length && !titleMatch(title, titleAllow)) return false;
    return true;
  });
}

// Card shaping — guessType, buildTags, cleanLocation, toCards & co — lives in
// events-core.js (shared with the browser fallback). Imported at the top.

// ── Generate RSS feed ───────────────────────────────────────────────────────

function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toRFC822(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toUTCString().replace("GMT", "+0000");
}

/**
 * Per-occurrence slot suffix (YYYYMMDD[THHMM]) and stable GUID/UID for a card.
 * Recurring events share one UID across every instance, so the slot makes each
 * occurrence unique — shared by the RSS <guid> and the iCal UID so both feeds
 * key events identically (no drift between the two exports).
 */
function eventSlot(c) {
  return c.date.replace(/-/g, "") + (c.time ? "T" + c.time.replace(":", "") : "");
}
function eventGuid(c) {
  const slot = eventSlot(c);
  return c.uid ? `${c.uid}-${slot}` : `bitcircus101-${slot}-${c.type}`;
}

/**
 * opts (all optional; the defaults reproduce the primary feed.xml byte-for-byte):
 *   title, description — channel metadata
 *   selfPath           — atom:link rel=self path, root-absolute
 *   limit              — max items (the primary feed stays capped at 15)
 *   lastBuildDate      — RFC822 string, or null to omit the element entirely
 *                        (filtered feeds derive it from content so a no-op sync
 *                        rewrites nothing — see buildFeedPlan)
 */
function generateRSS(cards, opts = {}) {
  const {
    title = "bitcircus101 – Termine",
    description = "Freitags ab 20:00 – offene Abende und linkup@bitcircus101 im Hackspace Bonn",
    selfPath = "/feed.xml",
    limit = 15,
    lastBuildDate = new Date().toUTCString().replace("GMT", "+0000"),
  } = opts;
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(title)}</title>
    <link>${EVENTS_URL}</link>
    <description>${escXml(description)}</description>
    <language>de-de</language>
`;
  if (lastBuildDate !== null) {
    xml += `    <lastBuildDate>${lastBuildDate}</lastBuildDate>\n`;
  }
  xml += `    <atom:link href="${SITE_URL}${selfPath}" rel="self" type="application/rss+xml"/>\n`;

  for (const c of cards.slice(0, limit)) {
    // Recurring events share a single UID across every instance. Append the
    // occurrence's date+time slot so each item gets a unique GUID — otherwise feed
    // readers dedupe on GUID and collapse the whole series into one entry.
    const guid = eventGuid(c);
    const datePart = c.time ? `${c.date} ${c.time}` : c.date;
    const titleParts = [`[${datePart}] ${c.title}`];
    if (c.location) titleParts.push(`@ ${c.location}`);
    const fullTitle = titleParts.join(" ");

    const tags = (c.tags || []).filter((t) => t && t !== "#community");

    xml += `
    <item>
      <title>${escXml(fullTitle)}</title>
      <link>${EVENTS_URL}#${eventAnchor(c)}</link>
      <description>${escXml(c.description || c.title + " · " + c.date)}</description>`;
    for (const tag of tags) {
      xml += `
      <category>${escXml(tag)}</category>`;
    }
    xml += `
      <pubDate>${toRFC822(c.firstSeen || new Date().toISOString())}</pubDate>
      <guid isPermaLink="false">${escXml(guid)}</guid>
    </item>`;
  }

  xml += `
  </channel>
</rss>
`;
  return xml;
}

// ── Generate iCal (.ics) feed ─────────────────────────────────────────────────

// Static Europe/Berlin definition (CET/CEST, last-Sunday DST switch). Emitting
// TZID=Europe/Berlin + this VTIMEZONE means the wall-clock strings from the cards
// go out verbatim, unambiguous for any consumer and independent of the runner TZ.
const VTIMEZONE_BERLIN = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** Escape an RFC5545 TEXT value: backslash, semicolon, comma, and newlines. */
function icsEsc(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line to ≤75 octets per RFC5545 (continuation lines start with a space). */
function icsFold(line) {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out = [];
  let cur = "";
  for (const ch of line) {
    // +1 keeps room for the leading space a continuation line adds (except the first).
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

/** YYYYMMDD (all-day) or YYYYMMDDTHHMMSS (timed) from a card's local date/time strings. */
function icsLocal(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, "");
  return timeStr ? `${d}T${timeStr.replace(":", "")}00` : d;
}

/** UTC compact stamp (YYYYMMDDTHHMMSSZ) from an ISO string — TZ-independent. */
function icsStampUTC(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Add hours to a local date/time, rolling the date over. Returns {date, time}. */
function addHoursLocal(dateStr, timeStr, hours) {
  const [y, mo, da] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const d = new Date(y, mo - 1, da, h + hours, mi);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const ICS_DEFAULT_DURATION_H = 2;

/**
 * Serialize cards into a valid VCALENDAR. Each card becomes one VEVENT with a real
 * DTSTART/DTEND so any standard aggregator (scalendarii included) reads start/end
 * natively — no title-regex, no page-scrape. Times go out as TZID=Europe/Berlin
 * (with the VTIMEZONE above); all-day events use VALUE=DATE with the exclusive
 * next-day DTEND that RFC5545 mandates. DTEND falls back to +2h (timed) / +1 day
 * (all-day) only when the source ICS carried neither DTEND nor DURATION.
 */
function generateICS(cards, nowISO, opts = {}) {
  const { calName = "bitcircus101 – Termine" } = opts;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//bitcircus101//events//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEsc(calName)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    ...VTIMEZONE_BERLIN,
  ];

  for (const c of cards) {
    const allDay = !c.time;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${eventGuid(c)}@bitcircus101.de`);
    lines.push(`DTSTAMP:${icsStampUTC(c.firstSeen || nowISO)}`);

    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsLocal(c.date, "")}`);
      // Exclusive end date: the source's DTEND date if present, else the next day.
      let endDate = c.endDate;
      if (!endDate) {
        const [y, mo, da] = c.date.split("-").map(Number);
        const nd = new Date(y, mo - 1, da + 1);
        endDate = `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`;
      }
      lines.push(`DTEND;VALUE=DATE:${icsLocal(endDate, "")}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Berlin:${icsLocal(c.date, c.time)}`);
      let endDate = c.endDate, endTime = c.endTime;
      if (!endTime) {
        ({ date: endDate, time: endTime } = addHoursLocal(c.date, c.time, ICS_DEFAULT_DURATION_H));
      }
      lines.push(`DTEND;TZID=Europe/Berlin:${icsLocal(endDate, endTime)}`);
    }

    lines.push(`SUMMARY:${icsEsc(c.title)}`);
    if (c.description) lines.push(`DESCRIPTION:${icsEsc(c.description)}`);
    if (c.location) lines.push(`LOCATION:${icsEsc(c.location)}`);
    // URL is a URI value (RFC5545 §3.8.4.6), not TEXT — emit raw, no backslash escaping.
    const url = c.eventUrl || c.calendarUrl;
    if (url) lines.push(`URL:${url}`);
    // CATEGORIES is a comma-separated list of TEXT values — escape each value, keep the
    // separators. Escaping the joined string would turn the separators into literal "\,".
    const cats = (c.tags || []).map((t) => t.replace(/^#/, "")).filter(Boolean);
    if (cats.length) lines.push(`CATEGORIES:${cats.map(icsEsc).join(",")}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

// ── Filtered feeds ("the filter you see is the feed you get") ───────────────
//
// Besides the primary feed.xml/ical.ics (rss:true sources, aggregator-facing,
// untouched), the sync emits one subscribable ICS+RSS pair per tag and per
// configured source under feeds/, all derived from the SAME aggregated ≤40-card
// window the events page renders. events-data.json carries a `feeds` manifest
// mapping tags and sources to those files, so the frontend never re-derives a
// slug and never advertises a feed that does not exist.

const MAX_TAG_FEEDS = 60; // runaway guard against a source dumping dozens of CATEGORIES
// How long a vanished tag keeps an empty-but-valid feed before its file is
// dropped. An empty VCALENDAR is what a subscribed client handles gracefully; a
// 404 is what makes it surface an error. 0 degenerates to "emit only current tags".
const FEED_RETENTION_DAYS = 90;

/** "#Löten & 3D" → "loeten-3d" — deterministic filename slug for a tag. */
function slugifyTag(tag) {
  const s = String(tag)
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "tag";
}

/**
 * Plan the whole feeds/ tree — which files exist and what they contain — plus
 * the manifest embedded into events-data.json. Pure; I/O lives in syncFeedsDir().
 *
 * `cards` is aggregate()'s output: the page's ≤40 window, so a tag feed can
 * never contain more than the page shows — that IS the "filter = feed" contract.
 * `prevFeeds` is the previous run's manifest (or null); it carries the
 * retirement ledger (see FEED_RETENTION_DAYS above).
 *
 * Manifest contract for the frontend: may be absent entirely (old JSON, local
 * dev); tag keys are lowercased; paths are root-absolute; `retired` is
 * machinery, never rendered; sources are keyed by cal.id (entry.name carries
 * the card-facing source name).
 */
function buildFeedPlan(cards, calendars, prevFeeds, nowISO) {
  const files = [];
  const warn = (msg) => console.warn(`::warning::${msg}`);

  // RSS lastBuildDate derived from content (newest firstSeen), omitted when the
  // feed is empty — combined with writeIfChanged in syncFeedsDir this keeps a
  // no-op sync from rewriting ~90 files every 30 minutes (repo bloat on live).
  const derivedBuildDate = (list) => {
    let max = null;
    for (const c of list) if (c.firstSeen && (!max || c.firstSeen > max)) max = c.firstSeen;
    return max ? toRFC822(max) : null;
  };

  const emitPair = (base, list, { title, description }) => {
    files.push({ path: `${base}.ics`, data: generateICS(list, nowISO, { calName: title }) });
    files.push({
      path: `${base}.xml`,
      data: generateRSS(list, {
        title, description,
        selfPath: `/${base}.xml`,
        limit: Infinity,
        lastBuildDate: derivedBuildDate(list),
      }),
    });
    return { ics: `/${base}.ics`, rss: `/${base}.xml` };
  };

  const manifest = {
    primary: { ics: "/ical.ics", rss: "/feed.xml", title: "bitcircus101 – Termine" },
    all: null,
    tags: {},
    sources: {},
    retired: {},
  };

  // all — the unfiltered page as a feed (NOT a copy of feed.xml: that one stays
  // rss:true-sources-only and capped at 15, exactly as before).
  const allTitle = "bitcircus101 – Alle Termine";
  const allMeta = emitPair("feeds/all", cards, {
    title: allTitle,
    description: "Alle Termine aus dem Hackspace und befreundeten Spaces in Bonn.",
  });
  manifest.all = { ...allMeta, title: allTitle, count: cards.length };

  // tags — keyed lowercased (collapses #KULT41 vs #kult41), selected by
  // (count desc, key asc), capped. Slug collisions: the first claim wins, the
  // loser is skipped entirely (no file, no manifest entry) — skipping keeps
  // every emitted feed's semantics exact.
  const byTag = new Map();
  for (const c of cards) {
    for (const t of c.tags || []) {
      const k = t.toLowerCase();
      if (!byTag.has(k)) byTag.set(k, []);
      byTag.get(k).push(c);
    }
  }
  const selected = [...byTag.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_TAG_FEEDS);
  if (byTag.size > MAX_TAG_FEEDS) {
    warn(`feeds: ${byTag.size} tags in window, capped at ${MAX_TAG_FEEDS}`);
  }

  const usedSlugs = new Set();
  const tagEntries = [];
  for (const [tag, list] of selected) {
    const slug = slugifyTag(tag);
    if (usedSlugs.has(slug)) {
      warn(`feeds: tag ${tag} skipped — slug "${slug}" already taken`);
      continue;
    }
    usedSlugs.add(slug);
    const meta = emitPair(`feeds/tag/${slug}`, list, {
      title: `bitcircus101 – Termine: ${tag}`,
      description: `Gefiltert nach ${tag} – alle Termine mit diesem Schlagwort.`,
    });
    tagEntries.push([tag, { ...meta, count: list.length }]);
  }
  // Serialize sorted by key — stable, diff-friendly manifest.
  tagEntries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [tag, entry] of tagEntries) manifest.tags[tag] = entry;

  // sources — config-driven, one pair per configured source even at zero events:
  // the URL only disappears when a maintainer removes the source from
  // calendars/config.json (a deliberate act), so no retirement machinery here.
  for (const cal of calendars) {
    const list = cards.filter((c) => c.source === cal.name);
    const meta = emitPair(`feeds/source/${cal.id}`, list, {
      title: `bitcircus101 – Termine: ${cal.name}`,
      description: `Alle Termine der Quelle ${cal.name}.`,
    });
    manifest.sources[cal.id] = { name: cal.name, ...meta, count: list.length };
  }

  // Retirement: a tag known from the previous run but absent from the window
  // keeps an empty feed until it ages past FEED_RETENTION_DAYS; after that no
  // file is planned and syncFeedsDir deletes it. A retired slug colliding with
  // a live one loses (live wins).
  const liveTags = new Set(tagEntries.map(([t]) => t));
  const prevKnown = [...new Set([
    ...Object.keys(prevFeeds?.tags || {}),
    ...Object.keys(prevFeeds?.retired || {}),
  ])].sort();
  for (const tag of prevKnown) {
    if (liveTags.has(tag)) continue;
    const retiredAt = prevFeeds?.retired?.[tag] || nowISO;
    if (new Date(nowISO) - new Date(retiredAt) >= FEED_RETENTION_DAYS * 86400000) continue;
    const slug = slugifyTag(tag);
    if (usedSlugs.has(slug)) {
      warn(`feeds: retired tag ${tag} dropped — slug "${slug}" now taken by a live tag`);
      continue;
    }
    usedSlugs.add(slug);
    emitPair(`feeds/tag/${slug}`, [], {
      title: `bitcircus101 – Termine: ${tag}`,
      description: "Dieses Schlagwort kommt derzeit in keinem Termin vor.",
    });
    manifest.retired[tag] = retiredAt;
  }

  return { manifest, files };
}

/**
 * Materialize a feed plan: write changed files only (a no-op sync touches
 * nothing, so `git add` stages nothing), delete everything under `dir` the plan
 * no longer contains, prune emptied subdirectories. The tree is fully owned by
 * the sync — a stray hand-dropped file is removed too. Returns {written, removed}.
 */
function syncFeedsDir(dir, files) {
  const desired = new Map(files.map((f) => [f.path, f.data]));
  let written = 0;
  for (const [path, data] of desired) {
    mkdirSync(dirname(path), { recursive: true });
    let existing = null;
    try { existing = readFileSync(path, "utf8"); } catch { /* new file */ }
    if (existing !== data) {
      writeFileAtomic(path, data);
      written++;
    }
  }
  let removed = 0;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) {
        walk(p);
        if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
      } else if (!desired.has(p)) {
        rmSync(p);
        removed++;
      }
    }
  };
  walk(dir);
  return { written, removed };
}

// ── Generate schema.org JSON-LD (embedded in events.html) ──────────────────
//
// The RSS feed's item links point at /events#ev-…, and calendar
// aggregators following the feed (e.g. scalendarii's RSS path) fetch each
// item page and read its schema.org JSON-LD — without this block the feed
// resolves to zero events. Each node's `url` is byte-identical to the RSS
// item <link> so both surfaces key the same occurrence.

const JSONLD_START = "<!-- jsonld-events:start -->";
const JSONLD_END = "<!-- jsonld-events:end -->";

/** Last Sunday of a month as day-of-month — same DST model as VTIMEZONE_BERLIN. */
function lastSundayOfMonth(year, monthIndex) {
  const last = new Date(year, monthIndex + 1, 0);
  return last.getDate() - last.getDay();
}

/**
 * Europe/Berlin UTC offset for a local calendar date: CEST (+02:00) between
 * the last Sunday of March and the last Sunday of October, CET (+01:00)
 * otherwise. Edge hours around the 02:00/03:00 switch don't matter at event
 * granularity. Deterministic and runner-TZ-independent, like the VTIMEZONE.
 */
function berlinUtcOffset(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const inDst =
    (m > 3 || (m === 3 && day >= lastSundayOfMonth(y, 2))) &&
    (m < 10 || (m === 10 && day < lastSundayOfMonth(y, 9)));
  return inDst ? "+02:00" : "+01:00";
}

/** Shift a YYYY-MM-DD date string by whole days (local-date arithmetic). */
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(y, m - 1, d + days);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

/** One card as a schema.org Event node. */
function toJsonLdEvent(c) {
  const node = { "@type": "Event", name: c.subtitle ? `${c.title} – ${c.subtitle}` : c.title };

  if (c.time) {
    node.startDate = `${c.date}T${c.time}:00${berlinUtcOffset(c.date)}`;
    if (c.endDate && c.endTime) {
      node.endDate = `${c.endDate}T${c.endTime}:00${berlinUtcOffset(c.endDate)}`;
    }
  } else {
    // All-day: date-only values. The card's endDate carries the ICS DTEND,
    // an EXCLUSIVE next-day boundary — schema.org's endDate is the INCLUSIVE
    // last day, so shift back one day (and drop it for single-day events).
    node.startDate = c.date;
    if (c.endDate) {
      const inclusiveEnd = shiftDate(c.endDate, -1);
      if (inclusiveEnd !== c.date) node.endDate = inclusiveEnd;
    }
  }

  if (c.description) node.description = c.description;
  if (c.location) node.location = { "@type": "Place", name: c.location };
  node.url = `${EVENTS_URL}#${eventAnchor(c)}`;
  const keywords = (c.tags || []).map((t) => t.replace(/^#/, "")).filter(Boolean);
  if (keywords.length) node.keywords = keywords;
  return node;
}

/** The full <script type="application/ld+json"> block for a card list. */
function generateJsonLd(cards) {
  const doc = { "@context": "https://schema.org", "@graph": cards.map(toJsonLdEvent) };
  // "<" must never appear raw inside a <script> element — a "</script" in an
  // upstream title/description would terminate the block mid-JSON.
  const json = JSON.stringify(doc, null, 1).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/**
 * Replace the marker-delimited JSON-LD block in a page. Returns null when the
 * markers are missing/malformed so the caller can warn instead of corrupting
 * the page. Idempotent: markers stay in place for the next sync.
 */
function injectJsonLd(html, scriptBlock) {
  const start = html.indexOf(JSONLD_START);
  const end = html.indexOf(JSONLD_END);
  if (start === -1 || end === -1 || end < start) return null;
  return (
    html.slice(0, start + JSONLD_START.length) + "\n" + scriptBlock + "\n" + html.slice(end)
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

/** Atomic write: write to a temp file then rename over the target (atomic on POSIX),
 *  so a killed run can never leave a half-written events-data.json / feed.xml. */
function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** Read previous sync state for diff and fallback on errors */
function loadPrevious() {
  let raw;
  try {
    raw = readFileSync("events-data.json", "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { icsKeys: {}, events: [], sources: [], feeds: null }; // legit first run
    throw e;
  }
  try {
    const prev = JSON.parse(raw);
    const events = Array.isArray(prev) ? prev : prev.events || [];
    const sources = prev.sources || [];
    // icsKeys stores ALL calendar events (before time filtering) from previous run
    const icsKeys = prev.icsKeys || {};
    // feeds carries the previous feed manifest incl. the retirement ledger
    const feeds = (!Array.isArray(prev) && prev.feeds) || null;
    return { icsKeys, events, sources, feeds };
  } catch (e) {
    // A present-but-unparseable file (truncated/partial write, merge markers, bad edit)
    // must NOT be silently treated as "first run": a stale/dead source would then
    // aggregate to an empty feed and get committed to live. Fail loud so CI flags it.
    throw new Error(
      `events-data.json exists but is not valid JSON (${e.message}); refusing to overwrite with empty state`
    );
  }
}

const FETCH_TIMEOUT_MS = 15000;

/** fetch() with an abort timeout so one hanging source can't stall the whole sync. */
function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/**
 * Fetch + parse + filter + diff a single source. Always resolves (never rejects):
 * on any failure it returns the previous run's cached cards with status "stale", so
 * one dead source never takes the others down. Returns a uniform shape consumed by
 * aggregate(): { cards, source (meta), icsKeys ({name: [...]} | null) }.
 */
async function processSource(cal, prev) {
  console.log(`[${cal.id}] Fetching ${cal.ics}`);
  const prevSource = prev.sources.find((s) => s.id === cal.id);
  const stale = (reason) => {
    console.error(`[${cal.id}] ${reason} – using cached events`);
    // Re-apply the date filter to the cached fallback: a flapping source must not
    // resurrect events that have since passed. Cards store `date` as local
    // YYYY-MM-DD (see toCards), so a lexical ">= today" keeps all of today plus
    // future and drops past ones — mirroring the all-day rule in toCards.
    const now = new Date();
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const cached = prev.events.filter((e) => e.source === cal.name && e.date >= today);
    return {
      cards: cached,
      source: {
        id: cal.id, name: cal.name,
        fetchedAt: prevSource?.fetchedAt || null,
        status: "stale", error: reason,
        events: cached.length, added: 0, removed: 0,
      },
      icsKeys: null,
    };
  };

  try {
    const res = await fetchWithTimeout(cal.ics);
    if (!res.ok) return stale(`HTTP ${res.status}`);

    const fetchedAt = new Date().toISOString();
    const text = await res.text();
    console.log(`[${cal.id}] ${text.length} bytes`);

    let icsEvents = parseICS(text, cal.id);
    console.log(`[${cal.id}] ${icsEvents.length} VEVENT entries`);

    if (cal.filter) {
      const before = icsEvents.length;
      icsEvents = applyFilter(icsEvents, cal.filter);
      console.log(`[${cal.id}] filter: ${before} → ${icsEvents.length}`);
    }

    const cards = toCards(icsEvents, cal);
    console.log(`[${cal.id}] ${cards.length} upcoming cards`);

    // Diff against previous sync — prefer UID (stable), fall back to date|summary
    // so natural event expiry doesn't count as a "removed" change.
    const keyOf = (e) => e.uid || (e.dtstart.toISOString().slice(0, 10) + "|" + e.summary);
    const today = new Date().toISOString().slice(0, 10);
    const allIcsKeys = new Set(icsEvents.map(keyOf));
    const prevIcsKeys = new Set(prev.icsKeys[cal.name] || []);
    const added = [...allIcsKeys].filter((k) => !prevIcsKeys.has(k)).length;
    // Only count upcoming events as "removed". A past event ageing out of the ICS
    // export window is natural expiry, not a real change. Bare-UID keys carry no
    // date part and keep the old behaviour (can't be dated).
    const removed = [...prevIcsKeys].filter(
      (k) => !allIcsKeys.has(k) && (!k.includes("|") || k.split("|")[0] >= today)
    ).length;

    let past = 0, upcoming = 0;
    for (const k of allIcsKeys) {
      if (k.split("|")[0] >= today) upcoming++; else past++;
    }

    return {
      cards,
      source: {
        id: cal.id, name: cal.name, fetchedAt, status: "ok",
        events: cards.length, added, removed,
        total: allIcsKeys.size, past, upcoming,
      },
      icsKeys: { [cal.name]: [...allIcsKeys] },
    };
  } catch (err) {
    return stale(err.name === "AbortError" ? `timeout after ${FETCH_TIMEOUT_MS}ms` : err.message);
  }
}

/**
 * Pure aggregation step — merges per-source results into the final output. No I/O,
 * so it is unit-testable. `results` preserves manifest order, which drives dedupe
 * priority (earlier source wins). `nowISO` is injected for deterministic firstSeen.
 */
function aggregate(results, prev, nowISO) {
  let allCards = [];
  const sources = [];
  const icsKeys = {};
  for (const r of results) {
    allCards = allCards.concat(r.cards);
    sources.push(r.source);
    if (r.icsKeys) Object.assign(icsKeys, r.icsKeys);
  }

  // Carry over firstSeen from previous sync, set to now for new events. Prefer UID
  // (stable across title edits), fall back to date|title for pre-UID migration.
  const prevByUid = {};
  const prevByDateTitle = {};
  for (const e of prev.events) {
    if (!e.firstSeen) continue;
    if (e.uid) prevByUid[e.uid] = e.firstSeen;
    // Index UID-less prev events by date|title so a card that LATER gains a UID still
    // inherits its firstSeen (a one-time pre-UID migration path). date|title is the only
    // join key here, so a genuinely different event reusing the same date+title as a
    // former UID-less entry can inherit its firstSeen until that entry rotates out — an
    // accepted limit of the migration heuristic (UID-bearing prev events never seed it).
    else prevByDateTitle[e.date + "|" + e.title] = e.firstSeen;
  }
  for (const c of allCards) {
    c.firstSeen = (c.uid && prevByUid[c.uid])
      || prevByDateTitle[c.date + "|" + c.title]
      || nowISO;
  }

  // Dedupe across sources. The same event cross-posted to several calendars should
  // appear once, even when only one calendar exports a UID. Two passes, so the result
  // is independent of source order: pass 1 keeps UID-bearing cards deduped by UID+slot,
  // so two *different* UIDs in the same slot ALWAYS both survive (genuine same-title
  // events are never merged); pass 2 keeps a UID-less card only when no already-kept
  // card occupies its title+slot (otherwise it is a UID-less cross-post). Within a slot
  // the earlier source wins among same-identity cards, and a UID-bearing card is always
  // preferred over a UID-less twin regardless of source order.
  const slotOf = (c) => "|" + c.date + "|" + (c.time || "");
  const titleSlotOf = (c) => c.title.toLowerCase() + slotOf(c);
  const seenUidSlot = new Set();
  const keptTitleSlot = new Set(); // title+slot of every kept card (UID-bearing or not)
  const keep = new Set();          // card objects to retain
  for (const c of allCards) {
    if (!c.uid) continue;
    if (seenUidSlot.has(c.uid + slotOf(c))) continue; // exact UID repeat
    seenUidSlot.add(c.uid + slotOf(c));
    keptTitleSlot.add(titleSlotOf(c));
    keep.add(c);
  }
  for (const c of allCards) {
    if (c.uid) continue;
    if (keptTitleSlot.has(titleSlotOf(c))) continue; // cross-post of an already-kept card
    keptTitleSlot.add(titleSlotOf(c));
    keep.add(c);
  }
  allCards = allCards.filter((c) => keep.has(c)); // preserve original order

  // Sort by date then time so same-day events run chronologically (all-day first).
  allCards.sort((a, b) =>
    (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))
  );
  allCards = allCards.slice(0, 40);

  // Reflect what actually made it into the output (after dedupe + cap).
  for (const s of sources) {
    s.events = allCards.filter((c) => c.source === s.name).length;
  }

  return { events: allCards, sources, icsKeys };
}

async function main() {
  const calendars = loadCalendars();
  const prev = loadPrevious();

  // Fetch every source concurrently; Promise.all preserves array order so the
  // manifest order still drives dedupe priority in aggregate().
  const results = await Promise.all(calendars.map((cal) => processSource(cal, prev)));

  const { events, sources, icsKeys } = aggregate(results, prev, new Date().toISOString());
  console.log(`Total: ${events.length} event cards from ${calendars.length} calendars`);

  const nowISO = new Date().toISOString();
  // Plan the filtered feeds BEFORE the JSON write so the manifest lands inside
  // events-data.json (the frontend reads feed paths from there, never guesses).
  const feedPlan = buildFeedPlan(events, calendars, prev.feeds, nowISO);
  const output = { lastSync: nowISO, sources, icsKeys, feeds: feedPlan.manifest, events };
  writeFileAtomic("events-data.json", JSON.stringify(output, null, 2) + "\n");
  console.log("Written events-data.json");

  // RSS + iCal only from calendars flagged rss:true (the primary feed).
  const primaryCards = events.filter((c) =>
    calendars.find((cal) => cal.name === c.source && cal.rss)
  );

  const rss = generateRSS(primaryCards);
  const ics = generateICS(primaryCards, nowISO);

  // Root feeds plus copies under events/ so a relative <link> resolved from the
  // /events page (…/events/feed.xml, …/events/ical.ics) lands on the real feed
  // instead of the events.html clean-URL fallback. See issue #1 / D2.
  mkdirSync("events", { recursive: true });
  for (const [file, data] of [
    ["feed.xml", rss],
    ["ical.ics", ics],
    ["events/feed.xml", rss],
    ["events/ical.ics", ics],
  ]) {
    writeFileAtomic(file, data);
    console.log(`Written ${file}`);
  }

  // Filtered per-tag/per-source feeds under feeds/ — the tree is fully owned by
  // the sync (writeIfChanged + delete-what-vanished), see syncFeedsDir.
  const feedStats = syncFeedsDir("feeds", feedPlan.files);
  console.log(
    `Feeds: ${feedPlan.files.length} planned, ${feedStats.written} written, ${feedStats.removed} removed`
  );

  // Embed the same primary cards as schema.org JSON-LD in events.html — the
  // page every RSS item link resolves to. Guarded like the feed loops: a
  // missing page or missing markers must not abort the sync.
  try {
    const page = readFileSync("events.html", "utf8");
    const injected = injectJsonLd(page, generateJsonLd(primaryCards));
    if (injected === null) {
      console.warn("events.html: jsonld-events markers not found — JSON-LD skipped");
    } else if (injected !== page) {
      writeFileAtomic("events.html", injected);
      console.log("Written events.html (JSON-LD block)");
    }
  } catch (err) {
    console.warn(`events.html JSON-LD skipped: ${err.message}`);
  }
}

// Run main() only when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  loadCalendars, CAL_DIR, CAL_CONFIG_FILE,
  parseDate, parseDuration, nthWeekday, expandRRule, clean, parseICS,
  isInternal, applyFilter, guessType, extractHashtags, keywordTags,
  buildTags, cleanLocation, truncateDesc, toCards,
  escXml, toRFC822, generateRSS, generateICS,
  slugifyTag, buildFeedPlan, syncFeedsDir, MAX_TAG_FEEDS, FEED_RETENTION_DAYS,
  eventSlot, eventGuid,
  berlinUtcOffset, generateJsonLd, injectJsonLd, toJsonLdEvent,
  aggregate, eventAnchor,
};
