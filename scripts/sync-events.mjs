#!/usr/bin/env node
/**
 * sync-events.mjs — Fetches ICS from Nextcloud, generates events-data.json + feed.xml
 * Runs in GitHub Actions (Node 20, no dependencies).
 */

const ICS_URL =
  "https://nc.6bm.de/remote.php/dav/public-calendars/DCaFSYECrcTJRJjC?export";
const SITE_URL = "https://bitcircus101.de";
const HORIZON_DAYS = 120;

import { writeFileSync } from "node:fs";

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
    const m = p.BYDAY.match(/^(\d+)([A-Z]{2})$/);
    if (m) {
      const nth = +m[1], twd = WD[m[2]];
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

function parseICS(text) {
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
      const base = {
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
    const key = line.slice(0, ci).split(";")[0].toUpperCase();
    const val = line.slice(ci + 1);
    if (key === "DTSTART") ev.dtstart = val;
    else if (key === "DTEND") ev.dtend = val;
    else if (key === "SUMMARY") ev.summary = val;
    else if (key === "DESCRIPTION") ev.description = val;
    else if (key === "LOCATION") ev.location = val;
    else if (key === "CATEGORIES") ev.categories = val;
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

function buildTags(summary, description, categories) {
  // 1. Explicit hashtags from description
  const explicit = extractHashtags(description);

  // 2. ICS CATEGORIES
  const catTags = categories
    ? categories.split(",").map((c) => "#" + c.trim().toLowerCase().replace(/\s+/g, "-"))
    : [];

  // 3. Keyword fallback
  const text = (summary + " " + description).toLowerCase();
  const auto = keywordTags(text);

  // Merge, deduplicate, keep order
  const seen = new Set();
  const merged = [];
  for (const t of [...explicit, ...catTags, ...auto]) {
    if (!seen.has(t)) { seen.add(t); merged.push(t); }
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

function toCards(icsEvents) {
  const now = new Date();
  return icsEvents
    .filter((e) => e.dtstart > now && !isInternal(e.summary))
    .sort((a, b) => a.dtstart - b.dtstart)
    .slice(0, 30)
    .map((e) => ({
      title: e.summary,
      subtitle: "",
      description: truncateDesc(e.description),
      location: cleanLocation(e.location),
      date: `${e.dtstart.getFullYear()}-${pad(e.dtstart.getMonth() + 1)}-${pad(e.dtstart.getDate())}`,
      time: e.allDay ? "" : `${pad(e.dtstart.getHours())}:${pad(e.dtstart.getMinutes())}`,
      tags: buildTags(e.summary, e.description, e.categories),
      type: guessType(e.summary),
    }));
}

// ── Generate RSS feed ───────────────────────────────────────────────────────

function escXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toRFC822(dateStr, time) {
  const d = new Date(dateStr + "T" + (time || "20:00") + ":00");
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
    const guid = `bitcircus101-${c.date.replace(/-/g, "")}-${c.type}`;
    xml += `
    <item>
      <title>${escXml(c.title)}${c.subtitle ? " – " + escXml(c.subtitle) : ""}</title>
      <link>${SITE_URL}/events.html</link>
      <description>${escXml(c.description || c.title + " · " + c.date)}</description>
      <pubDate>${toRFC822(c.date, c.time)}</pubDate>
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

async function main() {
  console.log("Fetching ICS from", ICS_URL);
  const res = await fetch(ICS_URL);
  if (!res.ok) {
    console.error(`HTTP ${res.status} – ${res.statusText}`);
    process.exit(1);
  }

  const text = await res.text();
  console.log(`Received ${text.length} bytes`);

  const icsEvents = parseICS(text);
  console.log(`Parsed ${icsEvents.length} VEVENT entries`);

  const cards = toCards(icsEvents);
  console.log(`Generated ${cards.length} upcoming event cards`);

  writeFileSync("events-data.json", JSON.stringify(cards, null, 2) + "\n");
  console.log("Written events-data.json");

  const rss = generateRSS(cards);
  writeFileSync("feed.xml", rss);
  console.log("Written feed.xml");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
