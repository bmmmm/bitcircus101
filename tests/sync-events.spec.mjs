/**
 * Unit tests for the ICS parser and event pipeline in sync-events.mjs.
 * Runs with: node --test tests/sync-events.spec.mjs
 *
 * These tests import the real functions from sync-events.mjs (no inline drift)
 * and use synthetic ICS data — no network access needed.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseDate, parseDuration, nthWeekday, expandRRule, clean, parseICS,
  applyFilter, buildTags, toCards,
  escXml, toRFC822, generateRSS, generateICS,
  eventSlot, eventGuid,
  aggregate, eventAnchor,
} from "../scripts/sync-events.mjs";

// ── parseDate ─────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses all-day date (YYYYMMDD)", () => {
    const d = parseDate("20260315");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2);
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
    const d = nthWeekday(2026, 2, 4, 3);
    assert.equal(d.getDate(), 19);
  });

  it("finds 1st Sunday of May 2026", () => {
    const d = nthWeekday(2026, 4, 0, 1);
    assert.equal(d.getDate(), 3);
  });

  it("returns null if nth overflows the month", () => {
    const d = nthWeekday(2026, 1, 1, 5);
    assert.equal(d, null);
  });
});

describe("expandRRule — MONTHLY with BYSETPOS", () => {
  it("expands BYDAY=TH;BYSETPOS=3 (3rd Thursday)", () => {
    const dtstart = new Date(2026, 0, 15, 19, 0);
    const rule = "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0);
    for (const d of dates) {
      assert.equal(d.getDay(), 4);
      assert(d.getDate() >= 15 && d.getDate() <= 21);
      assert.equal(d.getHours(), 19);
    }
  });

  it("expands BYDAY=SU;BYSETPOS=1 (1st Sunday)", () => {
    const dtstart = new Date(2026, 0, 4, 14, 0);
    const rule = "FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0);
    for (const d of dates) {
      assert.equal(d.getDay(), 0);
      assert(d.getDate() <= 7);
    }
  });

  it("also handles classic BYDAY=3TH format", () => {
    const dtstart = new Date(2026, 0, 15, 20, 0);
    const rule = "FREQ=MONTHLY;BYDAY=3TH";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0);
    for (const d of dates) assert.equal(d.getDay(), 4);
  });

  it("respects EXDATE exclusions", () => {
    const dtstart = new Date(2026, 0, 4, 14, 0);
    const rule = "FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1";
    const exdates = [new Date(2026, 1, 1)];
    const dates = expandRRule(dtstart, rule, exdates);
    const febDates = dates.filter((d) => d.getMonth() === 1);
    assert.equal(febDates.length, 0);
  });
});

describe("expandRRule — WEEKLY", () => {
  it("expands weekly recurrence", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0);
    const rule = "FREQ=WEEKLY;BYDAY=MO";
    const dates = expandRRule(dtstart, rule, []);
    assert(dates.length > 0);
    for (const d of dates) assert.equal(d.getDay(), 1);
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
      assert.equal(diff, 7);
    }
  });

  it("respects COUNT limit", () => {
    const dtstart = new Date(2026, 0, 5, 19, 0);
    const rule = "FREQ=WEEKLY;BYDAY=MO;COUNT=3";
    const dates = expandRRule(dtstart, rule, []);
    assert.equal(dates.length, 3);
  });

  it("expands every weekday when BYDAY lists several (MO,WE,FR)", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0); // Mon 2026-03-02
    const dates = expandRRule(dtstart, "FREQ=WEEKLY;BYDAY=MO,WE,FR", []);
    const days = [...new Set(dates.map((d) => d.getDay()))].sort((a, b) => a - b);
    assert.deepEqual(days, [1, 3, 5]); // Mon, Wed, Fri all present, not just the last
    assert(dates.every((d) => d.getHours() === 19));
  });

  it("honours WEEKLY INTERVAL=2 (every other week)", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0); // Mon
    const dates = expandRRule(dtstart, "FREQ=WEEKLY;BYDAY=MO;INTERVAL=2", []);
    assert(dates.length > 1);
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round((dates[i] - dates[i - 1]) / 86400000);
      assert.equal(diff, 14);
    }
  });

  it("keeps a timed occurrence on a date-only UNTIL day", () => {
    const dtstart = new Date(2026, 5, 15, 19, 0); // Mon 2026-06-15 19:00
    const dates = expandRRule(dtstart, "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260629", []);
    // 6/15, 6/22, 6/29 — the 29th must survive despite 19:00 > local midnight
    assert.ok(dates.some((d) => d.getMonth() === 5 && d.getDate() === 29));
  });

  it("counts EXDATE-excluded slots toward COUNT (RFC5545)", () => {
    const dtstart = new Date(2026, 0, 5, 19, 0); // Mon 2026-01-05
    // COUNT=3 generates 1/5, 1/12, 1/19; excluding 1/12 leaves [1/5, 1/19], NOT +1/26
    const dates = expandRRule(dtstart, "FREQ=WEEKLY;BYDAY=MO;COUNT=3", [new Date(2026, 0, 12)]);
    assert.equal(dates.length, 2);
    assert.ok(!dates.some((d) => d.getDate() === 26));
  });
});

describe("expandRRule — DAILY / YEARLY / unsupported", () => {
  it("expands daily recurrence one day apart", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0);
    const dates = expandRRule(dtstart, "FREQ=DAILY", []);
    assert(dates.length > 1);
    const diff = Math.round((dates[1] - dates[0]) / 86400000);
    assert.equal(diff, 1);
  });

  it("honours DAILY INTERVAL", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0);
    const dates = expandRRule(dtstart, "FREQ=DAILY;INTERVAL=3", []);
    assert(dates.length > 1);
    const diff = Math.round((dates[1] - dates[0]) / 86400000);
    assert.equal(diff, 3);
  });

  it("expands yearly recurrence keeping month/day", () => {
    const dtstart = new Date(2026, 2, 2, 19, 0);
    const dates = expandRRule(dtstart, "FREQ=YEARLY", []);
    assert(dates.length >= 1);
    assert.equal(dates[0].getMonth(), 2);
    assert.equal(dates[0].getDate(), 2);
  });

  it("warns once on an unsupported FREQ instead of silently dropping", () => {
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (m) => warnings.push(m);
    try {
      const dates = expandRRule(new Date(2026, 2, 2, 19, 0), "FREQ=HOURLY", []);
      assert.equal(dates.length, 0);
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unsupported FREQ=HOURLY/);
  });
});

// ── parseICS ──────────────────────────────────────────────────────────────

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
    assert.equal(events[0].summary, "Berlin Event");
    assert.equal(events[0].dtstart.getHours(), 19);
  });

  it("extracts UID and URL fields", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601T190000",
      "SUMMARY:Linked Event",
      "UID:2418@kult41.de",
      "URL:https://kult41.de/events/linked-event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseICS(ics);
    assert.equal(events[0].uid, "2418@kult41.de");
    assert.equal(events[0].url, "https://kult41.de/events/linked-event");
  });

  it("normalizes bare-domain URL to https://", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601T190000",
      "SUMMARY:Test",
      "UID:test@example.de",
      "URL:bitcircus101.de",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseICS(ics);
    assert.equal(events[0].url, "https://bitcircus101.de");
  });

  it("leaves a root-relative URL alone (no https:/// corruption)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260601T190000",
      "SUMMARY:Rel",
      "UID:rel@example.de",
      "URL:/events/foo",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    assert.equal(parseICS(ics)[0].url, "/events/foo");
  });

  it("warns once per source/zone for non-Europe TZID", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20260601T190000",
      "SUMMARY:NY Event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (msg) => warnings.push(msg);
    try {
      parseICS(ics, "test-ny");
      parseICS(ics, "test-ny"); // second call should NOT warn again
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /test-ny.*America\/New_York/);
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
    assert(events.length > 1);
    for (const e of events) {
      assert.equal(e.summary, "Digital Independence Day (DID)");
      assert.equal(e.dtstart.getDay(), 0);
      assert(e.dtstart.getDate() <= 7);
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
    assert.equal(parseICS(ics).length, 0);
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
  it("unescapes a literal backslash without mangling the next char", () => {
    assert.equal(clean("C:\\\\nope"), "C:\\nope"); // \\ -> \, not "C:\ ope"
    assert.equal(clean("a\\\\b"), "a\\b");
  });
});

// ── applyFilter ───────────────────────────────────────────────────────────

describe("applyFilter", () => {
  const ev = (summary, categories) => ({ summary, categories, dtstart: new Date() });
  const events = [
    ev("Konzert: Punk-Band", "Konzert, KULT41"),
    ev("Theater Tumult", "Theater, KULT41"),
    ev("Buchtreff", "Literatur, KULT41"),
    ev("Klimatreff", "Info, KULT41"),
    ev("Vernissage Trash Art", "Ausstellung, KULT41, Vernissage"),
  ];

  it("returns all events when filter is undefined", () => {
    assert.equal(applyFilter(events, undefined).length, events.length);
  });

  it("excludes events whose category matches categoryDeny (case-insensitive)", () => {
    const r = applyFilter(events, { categoryDeny: ["konzert"] });
    assert.equal(r.length, 4);
    assert.ok(!r.some((e) => e.summary.includes("Konzert")));
  });

  it("excludes by titleDeny substring (case-insensitive)", () => {
    const r = applyFilter(events, { titleDeny: ["punk"] });
    assert.equal(r.length, 4);
  });

  it("with categoryAllow set, only matching categories pass", () => {
    const r = applyFilter(events, { categoryAllow: ["Theater", "Literatur"] });
    assert.equal(r.length, 2);
    assert.ok(r.some((e) => e.summary === "Theater Tumult"));
    assert.ok(r.some((e) => e.summary === "Buchtreff"));
  });

  it("deny rules take precedence over allow rules", () => {
    const r = applyFilter(events, {
      categoryAllow: ["Theater", "Konzert"],
      categoryDeny: ["Konzert"],
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].summary, "Theater Tumult");
  });

  it("titleAllow narrows further", () => {
    const r = applyFilter(events, { titleAllow: ["tumult"] });
    assert.equal(r.length, 1);
    assert.equal(r[0].summary, "Theater Tumult");
  });

  it("events without CATEGORIES are excluded when categoryAllow is set", () => {
    const list = [...events, ev("Picanha de Chernobill", "")];
    const r = applyFilter(list, { categoryAllow: ["Konzert"] });
    assert.ok(!r.some((e) => e.summary === "Picanha de Chernobill"));
  });
});

// ── buildTags ─────────────────────────────────────────────────────────────

describe("buildTags", () => {
  it("includes cal.tags first and deduplicates against auto-detected tags", () => {
    const tags = buildTags("Workshop Löten", "", "", ["#kult41", "#workshop"]);
    assert.equal(tags[0], "#kult41");
    assert.equal(tags[1], "#workshop");
    // Auto-detection would also produce #workshop and #hardware; dedup keeps first occurrence
    assert.equal(tags.filter((t) => t === "#workshop").length, 1);
    assert.ok(tags.includes("#hardware"));
  });

  it("falls back to #community when nothing matches", () => {
    assert.deepEqual(buildTags("xyz", "", "", []), ["#community"]);
  });

  it("uses ICS CATEGORIES as fallback when no calTags", () => {
    const tags = buildTags("xyz", "", "Theater, KULT41", []);
    assert.ok(tags.includes("#theater"));
    assert.ok(tags.includes("#kult41"));
  });
});

// ── toCards ───────────────────────────────────────────────────────────────

describe("toCards", () => {
  const futureDate = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d;
  };

  const mkEvent = (extra = {}) => ({
    summary: "Future Event",
    description: "",
    location: "",
    categories: "",
    uid: "evt-1@example.com",
    url: "",
    dtstart: futureDate(),
    allDay: false,
    ...extra,
  });

  it("respects cal.cap override", () => {
    const events = Array.from({ length: 50 }, (_, i) => mkEvent({ uid: `evt-${i}` }));
    const r = toCards(events, { name: "X", url: "https://x.example", cap: 5 });
    assert.equal(r.length, 5);
  });

  it("falls back to default cap of 30 when cal.cap missing", () => {
    const events = Array.from({ length: 50 }, (_, i) => mkEvent({ uid: `evt-${i}` }));
    const r = toCards(events, { name: "X", url: "https://x.example" });
    assert.equal(r.length, 30);
  });

  it("propagates ICS URL field to card.eventUrl and overrides calendarUrl", () => {
    const events = [mkEvent({ url: "https://kult41.de/events/foo" })];
    const r = toCards(events, { name: "Kult 41", url: "https://kult41.de/program" });
    assert.equal(r[0].eventUrl, "https://kult41.de/events/foo");
    assert.equal(r[0].calendarUrl, "https://kult41.de/events/foo");
  });

  it("uses cal.eventUrl when ICS URL is missing", () => {
    const events = [mkEvent({ url: "" })];
    const r = toCards(events, {
      name: "Kult 41",
      url: "https://kult41.de/program",
      eventUrl: "https://kult41.de/events/specific",
    });
    assert.equal(r[0].eventUrl, "https://kult41.de/events/specific");
  });

  it("falls back to cal.url and no eventUrl when no per-event link (built-in source)", () => {
    const events = [mkEvent({ url: "" })];
    const r = toCards(events, { name: "X", url: "https://x.example" });
    assert.equal(r[0].calendarUrl, "https://x.example");
    assert.equal(r[0].eventUrl, undefined);
  });

  it("for ics-filtered sources, eventUrl falls back to cal.url so external links never get timeGridDay suffix", () => {
    const events = [mkEvent({ url: "" })];
    const r = toCards(events, {
      name: "Kult 41",
      type: "ics-filtered",
      url: "https://kult41.de/programm",
    });
    assert.equal(r[0].eventUrl, "https://kult41.de/programm");
  });

  it("passes uid through to card", () => {
    const events = [mkEvent({ uid: "abc-123" })];
    const r = toCards(events, { name: "X", url: "https://x.example" });
    assert.equal(r[0].uid, "abc-123");
  });

  it("merges cal.tags into card.tags", () => {
    const events = [mkEvent()];
    const r = toCards(events, { name: "X", url: "https://x.example", tags: ["#kult41"] });
    assert.ok(r[0].tags.includes("#kult41"));
  });

  it("keeps an all-day event happening today (not dropped as past)", () => {
    const t = new Date();
    const midnightToday = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const events = [mkEvent({ allDay: true, dtstart: midnightToday, uid: "allday-today" })];
    const r = toCards(events, { name: "X", url: "https://x.example" });
    assert.equal(r.length, 1);
  });

  it("still drops an all-day event from yesterday", () => {
    const t = new Date();
    const yesterday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    const events = [mkEvent({ allDay: true, dtstart: yesterday, uid: "allday-past" })];
    const r = toCards(events, { name: "X", url: "https://x.example" });
    assert.equal(r.length, 0);
  });
});

// ── RSS ───────────────────────────────────────────────────────────────────

describe("escXml", () => {
  it("escapes &, <, >, and quotes", () => {
    assert.equal(escXml('A & B <"C">'), 'A &amp; B &lt;&quot;C&quot;&gt;');
  });
});

describe("toRFC822", () => {
  it("accepts an ISO string", () => {
    assert.match(toRFC822("2026-03-10T22:45:00.000Z"), /Tue, 10 Mar 2026 22:45:00 \+0000/);
  });
  it("accepts a Date object", () => {
    assert.match(toRFC822(new Date("2026-01-01T12:00:00Z")), /Thu, 01 Jan 2026 12:00:00 \+0000/);
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
    assert.match(xml, /\[2026-03-21 20:00\] Crowd Gaming @ Dorotheenstraße 101, 53113 Bonn/);
  });

  it("omits @ location when location is empty", () => {
    const xml = generateRSS([{ ...baseCard, location: "" }]);
    assert.match(xml, /<title>\[2026-03-21 20:00\] Crowd Gaming<\/title>/);
    assert.ok(!xml.includes("@ "));
  });

  it("renders category tags from card tags", () => {
    const xml = generateRSS([baseCard]);
    assert.match(xml, /<category>Games<\/category>/);
    assert.match(xml, /<category>HackerSpace<\/category>/);
  });

  it("filters out empty tags and #community fallback", () => {
    const xml = generateRSS([{ ...baseCard, tags: ["#community", "", "Meetup"] }]);
    assert.ok(!xml.includes("<category>#community</category>"));
    assert.ok(!xml.includes("<category></category>"));
    assert.match(xml, /<category>Meetup<\/category>/);
  });

  it("omits category block entirely when all tags are filtered", () => {
    const xml = generateRSS([{ ...baseCard, tags: ["#community"] }]);
    assert.ok(!xml.includes("<category>"));
  });

  it("uses firstSeen as pubDate instead of event start time", () => {
    const xml = generateRSS([baseCard]);
    assert.match(xml, /<pubDate>Tue, 10 Mar 2026 22:45:00 \+0000<\/pubDate>/);
  });

  it("limits output to 15 items", () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({
      ...baseCard,
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      firstSeen: "2026-03-01T00:00:00.000Z",
    }));
    const xml = generateRSS(cards);
    assert.equal((xml.match(/<item>/g) || []).length, 15);
  });

  it("escapes special characters in title and description", () => {
    const card = { ...baseCard, title: "A & B", description: '<script>alert("xss")</script>' };
    const xml = generateRSS([card]);
    assert.match(xml, /A &amp; B/);
    assert.match(xml, /&lt;script&gt;/);
  });

  it("uses uid + date/time slot as guid when available", () => {
    const xml = generateRSS([{ ...baseCard, uid: "stable-uid-123" }]);
    assert.match(xml, /<guid isPermaLink="false">stable-uid-123-20260321T2000<\/guid>/);
  });

  it("falls back to date+type guid when no uid", () => {
    const xml = generateRSS([baseCard]);
    assert.match(xml, /<guid isPermaLink="false">bitcircus101-20260321T2000-special<\/guid>/);
  });

  it("gives recurring instances (shared uid) distinct GUIDs", () => {
    const xml = generateRSS([
      { ...baseCard, uid: "weekly@x", date: "2026-03-21", time: "20:00" },
      { ...baseCard, uid: "weekly@x", date: "2026-03-28", time: "20:00" },
    ]);
    const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
    assert.equal(guids.length, 2);
    assert.notEqual(guids[0], guids[1]);
  });

  it("XML-escapes the guid (uid with & and <)", () => {
    const xml = generateRSS([{ ...baseCard, uid: "a&b<c" }]);
    assert.match(xml, /<guid isPermaLink="false">a&amp;b&lt;c-20260321T2000<\/guid>/);
    // no raw, unescaped ampersand anywhere in the feed
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml));
  });

  it("deep-links the item to the event anchor", () => {
    const xml = generateRSS([baseCard]);
    assert.ok(
      xml.includes("<link>https://bitcircus101.de/events.html#" + eventAnchor(baseCard) + "</link>")
    );
  });

  it("stays well-formed XML with hostile field content", () => {
    const nasty = {
      ...baseCard,
      title: 'A & B <x> "q"',
      description: "<b>&amp;</b>",
      location: "M&Ms <i>",
      tags: ["<bad>&"],
      uid: "u&<id",
    };
    const xml = generateRSS([nasty]);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml), "no unescaped ampersand");
    for (const tag of ["item", "title", "link", "description", "guid", "pubDate"]) {
      const open = (xml.match(new RegExp("<" + tag + "[ >]", "g")) || []).length;
      const close = (xml.match(new RegExp("</" + tag + ">", "g")) || []).length;
      assert.equal(open, close, tag + " tags balanced");
    }
  });
});

// ── eventAnchor (shared deep-link slug) ───────────────────────────────────────

describe("eventAnchor", () => {
  it("builds a stable ev- anchor from date + title", () => {
    assert.equal(
      eventAnchor({ date: "2026-05-22", title: "Casual Linkup@bitcircus101 (4FR)" }),
      "ev-2026-05-22-casual-linkup-bitcircus101-4fr"
    );
  });

  it("keeps German umlauts and trims trailing separators", () => {
    assert.equal(
      eventAnchor({ date: "2026-06-01", title: "Löten für Anfänger!!!" }),
      "ev-2026-06-01-löten-für-anfänger"
    );
  });
});

// ── aggregate (cross-source merge) ────────────────────────────────────────────

describe("aggregate", () => {
  const NOW = "2026-04-01T00:00:00.000Z";
  const emptyPrev = { events: [], sources: [], icsKeys: {} };
  const card = (over) => ({
    title: "E", date: "2026-05-01", time: "20:00", uid: "",
    source: "A", tags: [], type: "special", ...over,
  });
  const result = (cards, name) => ({
    cards,
    source: { id: name, name, status: "ok", events: cards.length },
    icsKeys: { [name]: [] },
  });

  it("dedupes the same event cross-posted to two sources (first wins)", () => {
    const a = result([card({ uid: "shared@x", source: "A" })], "A");
    const b = result([card({ uid: "shared@x", source: "B" })], "B");
    const { events } = aggregate([a, b], emptyPrev, NOW);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "A");
  });

  it("keeps recurring instances (same uid, different date slot)", () => {
    const a = result([
      card({ uid: "weekly@x", date: "2026-05-01" }),
      card({ uid: "weekly@x", date: "2026-05-08" }),
    ], "A");
    const { events } = aggregate([a], emptyPrev, NOW);
    assert.equal(events.length, 2);
  });

  it("sorts same-day events by time, all-day first", () => {
    const a = result([
      card({ uid: "u1", time: "22:00", title: "late" }),
      card({ uid: "u2", time: "", title: "allday" }),
      card({ uid: "u3", time: "18:00", title: "early" }),
    ], "A");
    const { events } = aggregate([a], emptyPrev, NOW);
    assert.deepEqual(events.map((e) => e.title), ["allday", "early", "late"]);
  });

  it("caps the merged output at 40 cards", () => {
    const cards = Array.from({ length: 50 }, (_, i) =>
      card({ uid: "u" + i, date: "2026-05-" + String((i % 28) + 1).padStart(2, "0") })
    );
    const { events } = aggregate([result(cards, "A")], emptyPrev, NOW);
    assert.equal(events.length, 40);
  });

  it("carries firstSeen over by uid and defaults new events to nowISO", () => {
    const prev = {
      events: [{ uid: "old@x", date: "2026-05-01", title: "E", firstSeen: "2026-01-01T00:00:00.000Z" }],
      sources: [], icsKeys: {},
    };
    const a = result([card({ uid: "old@x" }), card({ uid: "new@x", date: "2026-05-02" })], "A");
    const { events } = aggregate([a], prev, NOW);
    const seen = Object.fromEntries(events.map((e) => [e.uid, e.firstSeen]));
    assert.equal(seen["old@x"], "2026-01-01T00:00:00.000Z");
    assert.equal(seen["new@x"], NOW);
  });

  it("recomputes source.events to reflect the deduped output", () => {
    const a = result([card({ uid: "shared@x", source: "A" })], "A");
    const b = result([card({ uid: "shared@x", source: "B" })], "B");
    const { sources } = aggregate([a, b], emptyPrev, NOW);
    assert.equal(sources.find((s) => s.name === "B").events, 0);
  });

  it("dedupes a cross-posted event when only one source carries a UID", () => {
    const a = result([card({ uid: "shared@x", title: "Linkup", source: "A" })], "A");
    const b = result([card({ uid: "", title: "Linkup", source: "B" })], "B");
    const { events } = aggregate([a, b], emptyPrev, NOW);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "A");
  });

  it("prefers the UID-bearing card when a UID-less twin from another source sorts first", () => {
    // The kept card flips to the UID-bearer (stable identity) regardless of source order.
    const a = result([card({ uid: "", title: "Linkup", date: "2026-07-01", time: "19:00", source: "A" })], "A");
    const b = result([card({ uid: "real@x", title: "Linkup", date: "2026-07-01", time: "19:00", source: "B" })], "B");
    const { events } = aggregate([a, b], emptyPrev, NOW);
    assert.equal(events.length, 1);
    assert.equal(events[0].uid, "real@x");
  });

  it("keeps two different-UID events in one slot even when a UID-less twin sorts first", () => {
    // Order-independence: a UID-less card listed first must not drop genuinely-distinct
    // UID events that share its title+slot — only the ambiguous UID-less card is dropped.
    const a = result([card({ uid: "", title: "T", date: "2026-07-01", time: "19:00" })], "A");
    const b = result([card({ uid: "bc@x", title: "T", date: "2026-07-01", time: "19:00" })], "B");
    const c = result([card({ uid: "db@y", title: "T", date: "2026-07-01", time: "19:00" })], "C");
    const { events } = aggregate([a, b, c], emptyPrev, NOW);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.uid).sort(), ["bc@x", "db@y"]);
  });

  it("does not leak firstSeen onto a different-UID event sharing date+title", () => {
    const prev = {
      events: [{ uid: "real@x", date: "2026-05-01", title: "E", firstSeen: "2026-01-01T00:00:00.000Z" }],
      sources: [], icsKeys: {},
    };
    const a = result([card({ uid: "other@y", date: "2026-05-01", title: "E" })], "A");
    const { events } = aggregate([a], prev, NOW);
    assert.equal(events[0].firstSeen, NOW);
  });

  it("migrates firstSeen by date+title for a once-UID-less event", () => {
    const prev = {
      events: [{ uid: "", date: "2026-05-01", title: "E", firstSeen: "2026-01-01T00:00:00.000Z" }],
      sources: [], icsKeys: {},
    };
    const a = result([card({ uid: "nowhas@x", date: "2026-05-01", title: "E" })], "A");
    const { events } = aggregate([a], prev, NOW);
    assert.equal(events[0].firstSeen, "2026-01-01T00:00:00.000Z");
  });
});

// ── parseDuration ─────────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses hours and minutes", () => {
    assert.equal(parseDuration("PT2H"), 2 * 3600 * 1000);
    assert.equal(parseDuration("PT1H30M"), 90 * 60 * 1000);
    assert.equal(parseDuration("PT45M"), 45 * 60 * 1000);
  });
  it("parses days and weeks", () => {
    assert.equal(parseDuration("P1D"), 86400 * 1000);
    assert.equal(parseDuration("P1W"), 604800 * 1000);
    assert.equal(parseDuration("P1DT1H"), (86400 + 3600) * 1000);
  });
  it("honours a negative sign", () => {
    assert.equal(parseDuration("-PT1H"), -3600 * 1000);
  });
  it("returns null for empty or componentless input", () => {
    assert.equal(parseDuration(""), null);
    assert.equal(parseDuration(null), null);
    assert.equal(parseDuration("P"), null);
    assert.equal(parseDuration("garbage"), null);
  });
});

// ── parseICS end-time extraction ──────────────────────────────────────────────

describe("parseICS — DTEND / DURATION", () => {
  const wrap = (...body) =>
    ["BEGIN:VCALENDAR", "BEGIN:VEVENT", ...body, "END:VEVENT", "END:VCALENDAR"].join("\r\n");

  it("extracts DTEND as a Date", () => {
    const e = parseICS(wrap("DTSTART:20260601T190000", "DTEND:20260601T210000", "SUMMARY:X"))[0];
    assert.equal(e.dtend.getHours(), 21);
    assert.equal(e.dtend - e.dtstart, 2 * 3600 * 1000);
  });

  it("derives dtend from DURATION when DTEND is absent", () => {
    const e = parseICS(wrap("DTSTART:20260601T190000", "DURATION:PT90M", "SUMMARY:X"))[0];
    assert.equal(e.dtend - e.dtstart, 90 * 60 * 1000);
  });

  it("leaves dtend null when neither DTEND nor DURATION is present", () => {
    const e = parseICS(wrap("DTSTART:20260601T190000", "SUMMARY:X"))[0];
    assert.equal(e.dtend, null);
  });

  it("gives each recurring instance a dtend offset by the same duration", () => {
    const events = parseICS(wrap(
      "DTSTART:20260105T190000", "DTEND:20260105T203000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3", "SUMMARY:Weekly"
    ));
    assert.equal(events.length, 3);
    for (const e of events) assert.equal(e.dtend - e.dtstart, 90 * 60 * 1000);
  });

  it("handles an all-day DTEND (exclusive next day)", () => {
    const e = parseICS(wrap("DTSTART:20260601", "DTEND:20260602", "SUMMARY:AllDay"))[0];
    assert.equal(e.allDay, true);
    assert.equal(e.dtend - e.dtstart, 86400 * 1000);
  });
});

// ── eventSlot / eventGuid (shared RSS + iCal keys) ────────────────────────────

describe("eventSlot / eventGuid", () => {
  it("builds a date+time slot", () => {
    assert.equal(eventSlot({ date: "2026-07-10", time: "20:00" }), "20260710T2000");
    assert.equal(eventSlot({ date: "2026-07-10", time: "" }), "20260710");
  });
  it("uses uid+slot when a uid is present, else a synthesized id", () => {
    assert.equal(eventGuid({ uid: "u@x", date: "2026-07-10", time: "20:00" }), "u@x-20260710T2000");
    assert.equal(
      eventGuid({ uid: "", date: "2026-07-10", time: "20:00", type: "special" }),
      "bitcircus101-20260710T2000-special"
    );
  });
});

// ── generateICS ───────────────────────────────────────────────────────────────

describe("generateICS", () => {
  const NOW = "2026-03-10T22:45:00.000Z";
  const baseCard = {
    title: "Crowd Gaming",
    description: "Laser fun",
    location: "Dorotheenstraße 101, 53113 Bonn",
    date: "2026-03-21",
    time: "20:00",
    endDate: "2026-03-21",
    endTime: "22:00",
    tags: ["#games", "#community"],
    type: "special",
    uid: "evt@x",
    eventUrl: "https://bitcircus101.de/events.html",
    firstSeen: "2026-03-01T00:00:00.000Z",
  };

  it("wraps events in a VCALENDAR with a VTIMEZONE and CRLF line endings", () => {
    const ics = generateICS([baseCard], NOW);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
    assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Berlin/);
    assert.ok(ics.includes("\r\n"), "uses CRLF");
  });

  it("emits a timed event with TZID start and end", () => {
    const ics = generateICS([baseCard], NOW);
    assert.match(ics, /DTSTART;TZID=Europe\/Berlin:20260321T200000/);
    assert.match(ics, /DTEND;TZID=Europe\/Berlin:20260321T220000/);
  });

  it("defaults DTEND to +2h when the card carries no end time", () => {
    const ics = generateICS([{ ...baseCard, endDate: "", endTime: "" }], NOW);
    assert.match(ics, /DTEND;TZID=Europe\/Berlin:20260321T220000/);
  });

  it("emits an all-day event as VALUE=DATE with an exclusive next-day DTEND", () => {
    const allDay = { ...baseCard, time: "", endDate: "", endTime: "" };
    const ics = generateICS([allDay], NOW);
    assert.match(ics, /DTSTART;VALUE=DATE:20260321/);
    assert.match(ics, /DTEND;VALUE=DATE:20260322/);
  });

  it("keeps an explicit multi-day all-day DTEND", () => {
    const allDay = { ...baseCard, time: "", endDate: "2026-03-23", endTime: "" };
    const ics = generateICS([allDay], NOW);
    assert.match(ics, /DTEND;VALUE=DATE:20260323/);
  });

  it("gives recurring instances (shared uid) distinct UIDs", () => {
    const ics = generateICS([
      { ...baseCard, uid: "weekly@x", date: "2026-03-21", time: "20:00" },
      { ...baseCard, uid: "weekly@x", date: "2026-03-28", time: "20:00" },
    ], NOW);
    const uids = [...ics.matchAll(/UID:(.+)/g)].map((m) => m[1].trim());
    assert.equal(uids.length, 2);
    assert.notEqual(uids[0], uids[1]);
  });

  it("escapes commas and strips the # from categories", () => {
    const ics = generateICS([baseCard], NOW);
    assert.match(ics, /CATEGORIES:games\\,community/);
    assert.match(ics, /LOCATION:Dorotheenstraße 101\\, 53113 Bonn/);
  });

  it("escapes newlines and semicolons in text", () => {
    const ics = generateICS([{ ...baseCard, description: "a;b\nc" }], NOW);
    assert.match(ics, /DESCRIPTION:a\\;b\\nc/);
  });

  it("folds content lines longer than 75 octets", () => {
    const long = { ...baseCard, description: "x".repeat(200) };
    const ics = generateICS([long], NOW);
    for (const line of ics.split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line.length}`);
    }
  });

  it("uses firstSeen for DTSTAMP as a UTC stamp", () => {
    const ics = generateICS([baseCard], NOW);
    assert.match(ics, /DTSTAMP:20260301T000000Z/);
  });

  it("omits DESCRIPTION/LOCATION/URL lines when the fields are empty", () => {
    const bare = { title: "T", date: "2026-03-21", time: "20:00", tags: [], type: "special",
      description: "", location: "", eventUrl: "", calendarUrl: "" };
    const ics = generateICS([bare], NOW);
    assert.ok(!ics.includes("DESCRIPTION:"));
    assert.ok(!ics.includes("LOCATION:"));
    assert.ok(!/\r\nURL:/.test(ics));
  });
});
