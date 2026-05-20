#!/usr/bin/env node
/**
 * sync-events.mjs — Fetches ICS from Nextcloud calendars, generates events-data.json + feed.xml
 * Reads calendar sources from calendars.json. Add new calendars there — no code changes needed.
 * Runs in GitHub Actions (Node 22, no dependencies).
 */

const SITE_URL = "https://bitcircus101.de";
const HORIZON_DAYS = 120;

import { readFileSync, writeFileSync } from "node:fs";

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

// ── ICS Parser ──────────────────────────────────────────────────────────────

function parseDate(v) {
  if (!v) return null;
  const y = +v.slice(0, 4), m = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
  if (v.length === 8) return new Date(y, m, d);
  const h = +v.slice(9, 11), mi = +v.slice(11, 13);
  return v.endsWith("Z")
    ? new Date(Date.UTC(y, m, d, h, mi))
    : new Date(y, m, d, h, mi);
}

function nthWeekday(year, month, wd, nth) {
  const d = new Date(year, month, 1);
  while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (nth - 1) * 7);
  return d.getMonth() === month ? d : null;
}

function expandRRule(dtstart, rule, exdates) {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);
  const p = Object.fromEntries(
    rule.split(";").map((s) => s.split("=")).filter((a) => a.length === 2)
  );
  const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const end = p.UNTIL ? parseDate(p.UNTIL) : null;
  const limit = end && end < horizon ? end : horizon;
  const max = p.COUNT ? +p.COUNT : 200;
  const exSet = new Set(exdates.map((d) => d.toDateString()));
  const out = [];

  if (p.FREQ === "WEEKLY") {
    const wd = p.BYDAY
      ? WD[p.BYDAY.replace(/\d/g, "").slice(-2)] ?? dtstart.getDay()
      : dtstart.getDay();
    const cur = new Date(dtstart);
    while (cur.getDay() !== wd) cur.setDate(cur.getDate() + 1);
    while (cur <= limit && out.length < max) {
      if (!exSet.has(cur.toDateString())) out.push(new Date(cur));
      cur.setDate(cur.getDate() + 7);
    }
  } else if (p.FREQ === "MONTHLY" && p.BYDAY) {
    // Support both "3TH" (nth in BYDAY) and "TH" + BYSETPOS=3
    const m = p.BYDAY.match(/^(\d+)([A-Z]{2})$/);
    const nth = m ? +m[1] : (p.BYSETPOS ? +p.BYSETPOS : null);
    const dayCode = m ? m[2] : p.BYDAY.replace(/\d/g, "").slice(-2);
    const twd = WD[dayCode];
    if (nth && twd != null) {
      const mo = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
      while (mo <= limit && out.length < max) {
        const d = nthWeekday(mo.getFullYear(), mo.getMonth(), twd, nth);
        if (d) {
          d.setHours(dtstart.getHours(), dtstart.getMinutes(), 0, 0);
          if (d >= dtstart && d <= limit && !exSet.has(d.toDateString()))
            out.push(new Date(d));
        }
        mo.setMonth(mo.getMonth() + 1);
      }
    }
  }
  return out;
}

function clean(s) {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

/** Pull TZID parameter out of a property like "DTSTART;TZID=Europe/Berlin" */
function parseTzid(rawKey) {
  const m = rawKey.match(/TZID=([^;:]+)/i);
  return m ? m[1] : null;
}

const tzidWarned = new Set();

function parseICS(text, sourceId = "?") {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let ev = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { ev = { exdates: [] }; continue; }
    if (line === "END:VEVENT") {
      if (!ev?.dtstart) { ev = null; continue; }
      const dtstart = parseDate(ev.dtstart);
      if (!dtstart) { ev = null; continue; }
      const dtend = ev.dtend ? parseDate(ev.dtend) : null;
      const allDay = !ev.dtstart.includes("T");
      // Warn (once per source/zone) for foreign timezones — values stay as floating local
      if (ev.tzid && ev.tzid !== "Europe/Berlin" && !ev.dtstart.endsWith("Z")) {
        const key = `${sourceId}|${ev.tzid}`;
        if (!tzidWarned.has(key)) {
          tzidWarned.add(key);
          console.warn(`[${sourceId}] non-Europe/Berlin TZID seen (${ev.tzid}); times treated as local`);
        }
      }
      const base = {
        uid: ev.uid || "",
        url: ev.url || "",
        summary: clean(ev.summary || "(kein Titel)"),
        description: clean(ev.description || ""),
        location: clean(ev.location || ""),
        categories: ev.categories || "",
        allDay,
      };
      if (ev.rrule) {
        const dur = dtend ? dtend - dtstart : 7200000;
        for (const d of expandRRule(dtstart, ev.rrule, ev.exdates)) {
          events.push({ ...base, dtstart: d, dtend: new Date(d.getTime() + dur) });
        }
      } else {
        events.push({ ...base, dtstart, dtend });
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const rawKey = line.slice(0, ci);
    const key = rawKey.split(";")[0].toUpperCase();
    const val = line.slice(ci + 1);
    if (key === "DTSTART") { ev.dtstart = val; ev.tzid = parseTzid(rawKey); }
    else if (key === "DTEND") ev.dtend = val;
    else if (key === "SUMMARY") ev.summary = val;
    else if (key === "DESCRIPTION") ev.description = val;
    else if (key === "LOCATION") ev.location = val;
    else if (key === "CATEGORIES") ev.categories = val;
    else if (key === "UID") ev.uid = val.trim();
    else if (key === "URL") ev.url = val.trim();
    else if (key === "RRULE") ev.rrule = val;
    else if (key === "EXDATE") {
      for (const v of val.split(",")) {
        const d = parseDate(v.trim());
        if (d) ev.exdates.push(d);
      }
    }
  }
  return events;
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
  const cap = Number.isFinite(cal.cap) ? cal.cap : 30;
  // External calendars (ics-single, ics-filtered) link directly to event/program pages;
  // built-in Nextcloud sources use the timeGridDay day view, so we keep eventUrl unset.
  const isExternal = cal.type === "ics-filtered" || cal.type === "ics-single";
  return icsEvents
    .filter((e) => e.dtstart > now && !isInternal(e.summary))
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    const guid = c.uid || `bitcircus101-${c.date.replace(/-/g, "")}-${c.type}`;
    const datePart = c.time ? `${c.date} ${c.time}` : c.date;
    const titleParts = [`[${datePart}] ${c.title}`];
    if (c.location) titleParts.push(`@ ${c.location}`);
    const fullTitle = titleParts.join(" ");

    const tags = (c.tags || []).filter((t) => t && t !== "#community");

    xml += `
    <item>
      <title>${escXml(fullTitle)}</title>
      <link>${SITE_URL}/events.html</link>
      <description>${escXml(c.description || c.title + " · " + c.date)}</description>`;
    for (const tag of tags) {
      xml += `
      <category>${escXml(tag)}</category>`;
    }
    xml += `
      <pubDate>${toRFC822(c.firstSeen || new Date().toISOString())}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
    </item>`;
  }

  xml += `
  </channel>
</rss>
`;
  return xml;
}

// ── Main ────────────────────────────────────────────────────────────────────

/** Read previous sync state for diff and fallback on errors */
function loadPrevious() {
  try {
    const prev = JSON.parse(readFileSync("events-data.json", "utf8"));
    const events = Array.isArray(prev) ? prev : prev.events || [];
    const sources = prev.sources || [];
    // icsKeys stores ALL calendar events (before time filtering) from previous run
    const icsKeys = prev.icsKeys || {};
    return { icsKeys, events, sources };
  } catch {
    return { icsKeys: {}, events: [], sources: [] };
  }
}

async function main() {
  const calendars = loadCalendars();
  const prev = loadPrevious();
  let allCards = [];
  const sources = [];
  const newIcsKeys = {};

  for (const cal of calendars) {
    console.log(`[${cal.id}] Fetching ${cal.ics}`);
    const prevSource = prev.sources.find((s) => s.id === cal.id);

    try {
      const res = await fetch(cal.ics);
      if (!res.ok) {
        const reason = `HTTP ${res.status}`;
        console.error(`[${cal.id}] ${reason} – using cached events`);
        // Keep previous events alive, mark source as degraded
        const cached = prev.events.filter((e) => e.source === cal.name);
        allCards = allCards.concat(cached);
        sources.push({
          id: cal.id, name: cal.name,
          fetchedAt: prevSource?.fetchedAt || null,
          status: "stale", error: reason,
          events: cached.length, added: 0, removed: 0,
        });
        continue;
      }
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
      allCards = allCards.concat(cards);

      // Diff against previous sync — prefer UID (stable), fall back to date|summary
      // so natural event expiry doesn't count as a "removed" change.
      const keyOf = (e) => e.uid || (e.dtstart.toISOString().slice(0, 10) + "|" + e.summary);
      const now = new Date().toISOString().slice(0, 10);
      const allIcsKeys = new Set(icsEvents.map(keyOf));
      const prevIcsKeys = new Set(prev.icsKeys[cal.name] || []);
      const added = [...allIcsKeys].filter((k) => !prevIcsKeys.has(k)).length;
      const removed = [...prevIcsKeys].filter((k) => !allIcsKeys.has(k)).length;
      newIcsKeys[cal.name] = [...allIcsKeys];

      // Count past vs upcoming in full calendar
      let past = 0, upcoming = 0;
      for (const k of allIcsKeys) {
        if (k.split("|")[0] >= now) upcoming++; else past++;
      }

      sources.push({
        id: cal.id, name: cal.name, fetchedAt, status: "ok",
        events: cards.length, added, removed,
        total: allIcsKeys.size, past, upcoming,
      });
    } catch (err) {
      const reason = err.message;
      console.error(`[${cal.id}] Error: ${reason} – using cached events`);
      // Keep previous events alive
      const cached = prev.events.filter((e) => e.source === cal.name);
      allCards = allCards.concat(cached);
      sources.push({
        id: cal.id, name: cal.name,
        fetchedAt: prevSource?.fetchedAt || null,
        status: "stale", error: reason,
        events: cached.length, added: 0, removed: 0,
      });
    }
  }

  // Carry over firstSeen from previous sync, set to now for new events.
  // Prefer UID lookup (stable across title edits), fall back to date|title for migration
  // from pre-UID events-data.json — first run after rollout still picks up old entries.
  const prevByUid = {};
  const prevByDateTitle = {};
  for (const e of prev.events) {
    if (!e.firstSeen) continue;
    if (e.uid) prevByUid[e.uid] = e.firstSeen;
    prevByDateTitle[e.date + "|" + e.title] = e.firstSeen;
  }
  const nowISO = new Date().toISOString();
  for (const c of allCards) {
    c.firstSeen = (c.uid && prevByUid[c.uid])
      || prevByDateTitle[c.date + "|" + c.title]
      || nowISO;
  }

  // Sort all cards by date, limit to 40
  allCards.sort((a, b) => a.date.localeCompare(b.date));
  allCards = allCards.slice(0, 40);
  console.log(`Total: ${allCards.length} event cards from ${calendars.length} calendars`);

  // Update source event counts to reflect what actually made it into the output
  for (const s of sources) {
    s.events = allCards.filter((c) => c.source === s.name).length;
  }

  const output = { lastSync: new Date().toISOString(), sources, icsKeys: newIcsKeys, events: allCards };
  writeFileSync("events-data.json", JSON.stringify(output, null, 2) + "\n");
  console.log("Written events-data.json");

  // RSS only from primary calendar
  const primaryCards = allCards.filter((c) =>
    calendars.find((cal) => cal.name === c.source && cal.rss)
  );
  const rss = generateRSS(primaryCards);
  writeFileSync("feed.xml", rss);
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
  parseDate, nthWeekday, expandRRule, clean, parseTzid, parseICS,
  isInternal, applyFilter, guessType, extractHashtags, keywordTags,
  buildTags, cleanLocation, truncateDesc, toCards,
  escXml, toRFC822, generateRSS,
};
