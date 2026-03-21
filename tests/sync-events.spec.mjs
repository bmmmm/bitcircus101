/**
 * Unit tests for the ICS parser and event pipeline in sync-events.mjs.
 * Runs with: node --test tests/sync-events.spec.mjs
 *
 * These tests use synthetic ICS data — no network access needed.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ── Inline the parser functions so we can test them in isolation ──────────

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

function expandRRule(dtstart, rule, exdates, horizonDays = 120) {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + horizonDays);
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

// ── Tests ─────────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses all-day date (YYYYMMDD)", () => {
    const d = parseDate("20260315");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2); // March = 2
    assert.equal(d.getDate(), 15);
  });

  it("parses datetime with T (local)", () => {
    const d = parseDate("20260315T190000");
    assert.equal(d.getHours(), 19);
    assert.equal(d.getMinutes(), 0);
  });

  it("parses UTC datetime (Z suffix)", () => {
    const d = parseDate("20260315T180000Z");
    assert.equal(d.getUTCHours(), 18);
    assert.equal(d.getUTCMinutes(), 0);
  });

  it("returns null for empty input", () => {
    assert.equal(parseDate(""), null);
    assert.equal(parseDate(null), null);
  });
});

describe("nthWeekday", () => {
  it("finds 3rd Thursday of March 2026", () => {
    const d = nthWeekday(2026, 2, 4, 3); // month=2 (March), wd=4 (Thursday), nth=3
    assert.equal(d.getDate(), 19);
  });

  it("finds 1st Sunday of May 2026", () => {
    const d = nthWeekday(2026, 4, 0, 1); // month=4 (May), wd=0 (Sunday), nth=1
    assert.equal(d.getDate(), 3);
  });

  it("returns null if nth overflows the month", () => {
    const d = nthWeekday(2026, 1, 1, 5); // 5th Monday of February — doesn't exist
    assert.equal(d, null);
  });
});

describe("expandRRule — MONTHLY with BYSETPOS", () => {
  it("expands BYDAY=TH;BYSETPOS=3 (3rd Thursday)", () => {
    const dtstart = new Date(2026, 0, 15, 19, 0); // Jan 15 2026 19:00
    const rule = "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0, "should produce at least one occurrence");
    for (const d of dates) {
      assert.equal(d.getDay(), 4, "every occurrence should be a Thursday");
      // Check it's the 3rd Thursday: date should be between 15-21
      assert(d.getDate() >= 15 && d.getDate() <= 21,
        `3rd Thursday should be day 15-21, got ${d.getDate()}`);
      assert.equal(d.getHours(), 19, "should preserve start hour");
    }
  });

  it("expands BYDAY=SU;BYSETPOS=1 (1st Sunday)", () => {
    const dtstart = new Date(2026, 0, 4, 14, 0); // Jan 4 2026 14:00
    const rule = "FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0, "should produce at least one occurrence");
    for (const d of dates) {
      assert.equal(d.getDay(), 0, "every occurrence should be a Sunday");
      assert(d.getDate() <= 7,
        `1st Sunday should be day 1-7, got ${d.getDate()}`);
    }
  });

  it("also handles classic BYDAY=3TH format", () => {
    const dtstart = new Date(2026, 0, 15, 20, 0);
    const rule = "FREQ=MONTHLY;BYDAY=3TH";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0);
    for (const d of dates) {
      assert.equal(d.getDay(), 4);
    }
  });

  it("respects EXDATE exclusions", () => {
    const dtstart = new Date(2026, 0, 4, 14, 0);
    const rule = "FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1";
    // Exclude the first occurrence in Feb (1st Sunday = Feb 1)
    const exdates = [new Date(2026, 1, 1)];
    const dates = expandRRule(dtstart, rule, exdates);
    const febDates = dates.filter(d => d.getMonth() === 1);
    assert.equal(febDates.length, 0, "February should be excluded");
  });
});

describe("expandRRule — WEEKLY", () => {
  it("expands weekly recurrence", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0); // Mon March 2
    const rule = "FREQ=WEEKLY;BYDAY=MO";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0);
    for (const d of dates) {
      assert.equal(d.getDay(), 1, "should all be Mondays");
    }
    // Check they're 7 days apart (use date math to avoid DST issues)
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
      assert.equal(diff, 7, "should be 7 days apart");
    }
  });

  it("respects COUNT limit", () => {
    const dtstart = new Date(2026, 0, 5, 19, 0);
    const rule = "FREQ=WEEKLY;BYDAY=MO;COUNT=3";
    const dates = expandRRule(dtstart, rule, []);
    assert.equal(dates.length, 3);
  });
});

describe("parseICS", () => {
  it("parses a simple single event", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601T190000",
      "DTEND:20260601T210000",
      "SUMMARY:Test Event",
      "DESCRIPTION:A test description",
      "LOCATION:Bonn",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, "Test Event");
    assert.equal(events[0].description, "A test description");
    assert.equal(events[0].location, "Bonn");
    assert.equal(events[0].allDay, false);
  });

  it("parses all-day event", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601",
      "SUMMARY:All Day Event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert.equal(events.length, 1);
    assert.equal(events[0].allDay, true);
  });

  it("handles DTSTART with TZID parameter", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=Europe/Berlin:20260601T190000",
      "SUMMARY:Berlin Event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, "Berlin Event");
    assert.equal(events[0].dtstart.getHours(), 19);
  });

  it("handles line folding (continuation lines)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601T190000",
      "SUMMARY:This is a very long",
      " event title that wraps",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert.equal(events[0].summary, "This is a very longevent title that wraps");
  });

  it("expands recurring event with BYSETPOS", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=Europe/Berlin:20260104T140000",
      "DTEND;TZID=Europe/Berlin:20260104T160000",
      "SUMMARY:Digital Independence Day (DID)",
      "RRULE:FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert(events.length > 1, `Expected multiple occurrences, got ${events.length}`);
    for (const e of events) {
      assert.equal(e.summary, "Digital Independence Day (DID)");
      assert.equal(e.dtstart.getDay(), 0, "should be Sunday");
      assert(e.dtstart.getDate() <= 7, "should be 1st Sunday");
    }
  });

  it("skips events without DTSTART", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:No date event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert.equal(events.length, 0);
  });

  it("unescapes ICS special characters", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601T190000",
      "SUMMARY:Hello\\, World",
      "DESCRIPTION:Line1\\nLine2\\;end",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const events = parseICS(ics);
    assert.equal(events[0].summary, "Hello, World");
    assert.equal(events[0].description, "Line1 Line2;end");
  });
});

describe("clean", () => {
  it("unescapes \\n \\, \\;", () => {
    assert.equal(clean("Hello\\nWorld"), "Hello World");
    assert.equal(clean("a\\,b"), "a,b");
    assert.equal(clean("a\\;b"), "a;b");
  });

  it("trims whitespace", () => {
    assert.equal(clean("  hello  "), "hello");
  });
});

// ── RSS generation (inline the functions so tests stay self-contained) ────

function escXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toRFC822(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toUTCString().replace("GMT", "+0000");
}

function generateRSS(cards) {
  const SITE_URL = "https://bitcircus101.de";
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
    const titleParts = [`[${c.date}] ${c.title}`];
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

describe("escXml", () => {
  it("escapes &, <, >, and quotes", () => {
    assert.equal(escXml('A & B <"C">'), 'A &amp; B &lt;&quot;C&quot;&gt;');
  });
});

describe("toRFC822", () => {
  it("accepts an ISO string", () => {
    const result = toRFC822("2026-03-10T22:45:00.000Z");
    assert.match(result, /Tue, 10 Mar 2026 22:45:00 \+0000/);
  });

  it("accepts a Date object", () => {
    const d = new Date("2026-01-01T12:00:00Z");
    const result = toRFC822(d);
    assert.match(result, /Thu, 01 Jan 2026 12:00:00 \+0000/);
  });
});

describe("generateRSS", () => {
  const baseCard = {
    title: "Crowd Gaming",
    subtitle: "",
    description: "Laser pointer fun",
    location: "Dorotheenstraße 101, 53113 Bonn",
    date: "2026-03-21",
    time: "20:00",
    tags: ["Games", "HackerSpace"],
    type: "special",
    source: "bitcircus101",
    firstSeen: "2026-03-10T22:45:00.000Z",
  };

  it("includes date and location in title", () => {
    const xml = generateRSS([baseCard]);
    assert.match(xml, /\[2026-03-21\] Crowd Gaming @ Dorotheenstraße 101, 53113 Bonn/);
  });

  it("omits @ location when location is empty", () => {
    const card = { ...baseCard, location: "" };
    const xml = generateRSS([card]);
    assert.match(xml, /<title>\[2026-03-21\] Crowd Gaming<\/title>/);
    assert.ok(!xml.includes("@ "), "should not contain @ when no location");
  });

  it("renders category tags from card tags", () => {
    const xml = generateRSS([baseCard]);
    assert.match(xml, /<category>Games<\/category>/);
    assert.match(xml, /<category>HackerSpace<\/category>/);
  });

  it("filters out empty tags and #community fallback", () => {
    const card = { ...baseCard, tags: ["#community", "", "Meetup"] };
    const xml = generateRSS([card]);
    assert.ok(!xml.includes("<category>#community</category>"), "should filter #community");
    assert.ok(!xml.includes("<category></category>"), "should filter empty tags");
    assert.match(xml, /<category>Meetup<\/category>/);
  });

  it("omits category block entirely when all tags are filtered", () => {
    const card = { ...baseCard, tags: ["#community"] };
    const xml = generateRSS([card]);
    assert.ok(!xml.includes("<category>"), "no category tags when only fallback tag");
  });

  it("uses firstSeen as pubDate instead of event start time", () => {
    const xml = generateRSS([baseCard]);
    // pubDate should reflect firstSeen (March 10), not event date (March 21)
    assert.match(xml, /<pubDate>Tue, 10 Mar 2026 22:45:00 \+0000<\/pubDate>/);
  });

  it("limits output to 15 items", () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({
      ...baseCard,
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      firstSeen: "2026-03-01T00:00:00.000Z",
    }));
    const xml = generateRSS(cards);
    const count = (xml.match(/<item>/g) || []).length;
    assert.equal(count, 15);
  });

  it("escapes special characters in title and description", () => {
    const card = { ...baseCard, title: "A & B", description: '<script>alert("xss")</script>' };
    const xml = generateRSS([card]);
    assert.match(xml, /A &amp; B/);
    assert.match(xml, /&lt;script&gt;/);
  });
});
