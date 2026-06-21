#!/usr/bin/env node
/**
 * sync-events.mjs — Fetches ICS from Nextcloud calendars, generates events-data.json + feed.xml
 * Reads calendar sources via the manifest calendars/config.json. Add new calendars there — no code changes needed.
 * Runs in GitHub Actions (Node 22, no dependencies).
 */

const SITE_URL = "https://bitcircus101.de";

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import ICSCore from "../ics-core.js";

// ICS parsing primitives are shared with the browser fallback (events.js) via the
// UMD module ics-core.js — single source of truth, no drift between the two parsers.
const { parseDate, nthWeekday, expandRRule, clean, parseICS, eventAnchor } = ICSCore;

const CAL_DIR = "calendars";
const CAL_CONFIG = `${CAL_DIR}/config.json`;

/**
 * Load calendar sources via the manifest at calendars/config.json. Each source
 * lives in its own JSON file (calendars/bitcircus.json, calendars/external/foo.json,
 * etc.) and is included by listing its path under `sources`. Order in the manifest
 * = order of processing. Remove an entry to disable a source without deleting its
 * file. Entries without `id` or `ics` are skipped with a warning so one malformed
 * file never breaks the whole sync.
 */
function loadCalendars() {
  const config = JSON.parse(readFileSync(CAL_CONFIG, "utf8"));
  const sources = Array.isArray(config?.sources) ? config.sources : [];
  const loaded = [];
  for (const rel of sources) {
    const path = `${CAL_DIR}/${rel}`;
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

/** Skip internal/blocker events */
function isInternal(summary) {
  const s = summary.toLowerCase();
  return s.includes("blocker") || s.includes("interne veranstaltung");
}

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

function guessType(summary) {
  const s = summary.toLowerCase();
  if (s.includes("linkup")) return "linkup";
  if (s.includes("workshop") || s.includes("löten") || s.includes("hands-on")) return "workshop";
  return "special";
}

/**
 * Tag resolution — 3 sources, in priority:
 *
 * 1. Explicit #hashtags in the event description  (you control these in Nextcloud)
 * 2. ICS CATEGORIES field                         (Nextcloud calendar categories)
 * 3. Keyword auto-detection from title/description (fallback)
 *
 * → Write "#workshop #hardware" anywhere in the Nextcloud event description
 *   and those tags appear on the website. No code changes needed.
 */
function extractHashtags(text) {
  const matches = text.match(/#[a-zA-Z0-9äöüß_-]+/g);
  return matches ? matches.map((t) => t.toLowerCase()) : [];
}

function keywordTags(text) {
  const tags = [];
  // Event format
  if (text.includes("linkup") || text.includes("casual")) tags.push("#meetup");
  if (text.includes("lightning")) tags.push("#lightning-talks");
  if (text.includes("workshop")) tags.push("#workshop");
  if (text.includes("vortrag") || text.includes("talk")) tags.push("#talk");
  // Topics
  if (text.includes("hardware") || text.includes("löten") || text.includes("soldering")) tags.push("#hardware");
  if (text.includes("ctf") || text.includes("capture the flag")) tags.push("#ctf");
  if (/\bsecurity\b/.test(text) || /\bpentest\b/.test(text)) tags.push("#security");
  if (/\bllm\b/.test(text) || /\b(ai|künstliche intelligenz)\b/.test(text)) tags.push("#ai");
  if (text.includes("retro") || /\bgaming\b/.test(text) || text.includes("spieleabend")) tags.push("#gaming");
  if (text.includes("fsfe") || text.includes("open source") || text.includes("free software")) tags.push("#foss");
  if (/\bchaos\b/.test(text) || /\bccc\b/.test(text) || text.includes("easterhegg") || text.includes("congress")) tags.push("#chaos");
  if (/\bfroscon\b/i.test(text) || text.includes("free and open source")) tags.push("#froscon");
  if (text.includes("nixos") || text.includes("linux") || text.includes("kernel")) tags.push("#linux");
  if (text.includes("3d") || text.includes("druck") || text.includes("print")) tags.push("#3d");
  // Community / venue
  if (text.includes("datenburg")) tags.push("#datenburg");
  if (text.includes("offen") || text.includes("tag des offenen")) tags.push("#offener-abend");
  if (text.includes("spielen") || text.includes("puzzeln") || text.includes("toys")) tags.push("#spieletreff");
  return tags;
}

function buildTags(summary, description, categories, calTags = []) {
  // 1. Explicit hashtags from description
  const explicit = extractHashtags(description);

  // 2. ICS CATEGORIES
  const catTags = categories
    ? categories.split(",").map((c) => "#" + c.trim().toLowerCase().replace(/\s+/g, "-"))
    : [];

  // 3. Keyword fallback
  const text = (summary + " " + description).toLowerCase();
  const auto = keywordTags(text);

  // Merge, deduplicate, keep order. cal.tags first so source-pinned tags always survive.
  const seen = new Set();
  const merged = [];
  const normalize = (t) => t.toLowerCase();
  for (const t of [...calTags, ...explicit, ...catTags, ...auto]) {
    const n = normalize(t);
    if (!seen.has(n)) { seen.add(n); merged.push(t); }
  }
  return merged.length ? merged : ["#community"];
}

/** Clean up ICS location — normalize whitespace, strip redundant parts */
function cleanLocation(loc) {
  if (!loc) return "";
  // Replace \n with ", ", collapse whitespace
  let s = loc.replace(/\\n/gi, ", ").replace(/\s+/g, " ").trim();
  // Remove trailing ", Germany" / ", Deutschland"
  s = s.replace(/,\s*(Germany|Deutschland)\s*$/i, "");
  // Remove leading "bitcircus101" if followed by address
  s = s.replace(/^bitcircus101[,\s]*/i, "");
  return s.trim();
}

/** Truncate description to ~200 chars at word boundary */
function truncateDesc(s, max = 200) {
  if (!s || s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.lastIndexOf(" ");
  return (last > 0 ? cut.slice(0, last) : cut) + " …";
}

function toCards(icsEvents, cal) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cap = Number.isFinite(cal.cap) ? cal.cap : 30;
  // External calendars (ics-single, ics-filtered) link directly to event/program pages;
  // built-in Nextcloud sources use the timeGridDay day view, so we keep eventUrl unset.
  const isExternal = cal.type === "ics-filtered" || cal.type === "ics-single";
  return icsEvents
    // All-day events carry no time (midnight). Comparing them against `now` would
    // drop an all-day event happening *today* at any moment past 00:00, so gate them
    // on the start of today instead; timed events keep the strict "future" check.
    .filter((e) => (e.allDay ? e.dtstart >= startOfToday : e.dtstart > now) && !isInternal(e.summary))
    .sort((a, b) => a.dtstart - b.dtstart)
    .slice(0, cap)
    .map((e) => {
      // ICS URL > config-level eventUrl > calendar-level url (external only)
      const eventLink = e.url || cal.eventUrl || (isExternal ? cal.url : null);
      return {
        title: e.summary,
        subtitle: "",
        description: truncateDesc(e.description),
        location: cleanLocation(e.location),
        date: `${e.dtstart.getFullYear()}-${pad(e.dtstart.getMonth() + 1)}-${pad(e.dtstart.getDate())}`,
        time: e.allDay ? "" : `${pad(e.dtstart.getHours())}:${pad(e.dtstart.getMinutes())}`,
        tags: buildTags(e.summary, e.description, e.categories, cal.tags || []),
        type: guessType(e.summary),
        source: cal.name,
        uid: e.uid || "",
        calendarUrl: eventLink || cal.url,
        ...(eventLink ? { eventUrl: eventLink } : {}),
      };
    });
}

// ── Generate RSS feed ───────────────────────────────────────────────────────

function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toRFC822(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toUTCString().replace("GMT", "+0000");
}

function generateRSS(cards) {
  const now = new Date().toUTCString().replace("GMT", "+0000");
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>bitcircus101 – Termine</title>
    <link>${SITE_URL}/events.html</link>
    <description>Freitags ab 20:00 – offene Abende und linkup@bitcircus101 im Hackspace Bonn</description>
    <language>de-de</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
`;

  for (const c of cards.slice(0, 15)) {
    // Recurring events share a single UID across every instance. Append the
    // occurrence's date+time slot so each item gets a unique GUID — otherwise feed
    // readers dedupe on GUID and collapse the whole series into one entry.
    const slot = c.date.replace(/-/g, "") + (c.time ? "T" + c.time.replace(":", "") : "");
    const guid = c.uid ? `${c.uid}-${slot}` : `bitcircus101-${slot}-${c.type}`;
    const datePart = c.time ? `${c.date} ${c.time}` : c.date;
    const titleParts = [`[${datePart}] ${c.title}`];
    if (c.location) titleParts.push(`@ ${c.location}`);
    const fullTitle = titleParts.join(" ");

    const tags = (c.tags || []).filter((t) => t && t !== "#community");

    xml += `
    <item>
      <title>${escXml(fullTitle)}</title>
      <link>${SITE_URL}/events.html#${eventAnchor(c)}</link>
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
    if (e.code === "ENOENT") return { icsKeys: {}, events: [], sources: [] }; // legit first run
    throw e;
  }
  try {
    const prev = JSON.parse(raw);
    const events = Array.isArray(prev) ? prev : prev.events || [];
    const sources = prev.sources || [];
    // icsKeys stores ALL calendar events (before time filtering) from previous run
    const icsKeys = prev.icsKeys || {};
    return { icsKeys, events, sources };
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

  const output = { lastSync: new Date().toISOString(), sources, icsKeys, events };
  writeFileAtomic("events-data.json", JSON.stringify(output, null, 2) + "\n");
  console.log("Written events-data.json");

  // RSS only from calendars flagged rss:true (the primary feed).
  const primaryCards = events.filter((c) =>
    calendars.find((cal) => cal.name === c.source && cal.rss)
  );
  const rss = generateRSS(primaryCards);
  writeFileAtomic("feed.xml", rss);
  console.log("Written feed.xml");
}

// Run main() only when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  loadCalendars,
  parseDate, nthWeekday, expandRRule, clean, parseICS,
  isInternal, applyFilter, guessType, extractHashtags, keywordTags,
  buildTags, cleanLocation, truncateDesc, toCards,
  escXml, toRFC822, generateRSS,
  aggregate, eventAnchor,
};
