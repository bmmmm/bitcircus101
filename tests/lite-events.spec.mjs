/**
 * Unit tests for scripts/build-lite-events.mjs — the generator that writes the
 * event list of lite/index.html. Runs with:
 *   node --test tests/lite-events.spec.mjs
 * No browser, no network, no file writes: the script only runs main() when it
 * is invoked directly, so importing it here is inert.
 *
 * The script shipped without any tests. Its two real decisions — which events
 * the page shows and which RSS feed it advertises — lived inside main() next to
 * the file I/O and could not be exercised at all; they are pure functions now.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { esc } from "../scripts/html-text.mjs";
import {
  formatDate,
  toDatetime,
  normalizeUrl,
  buildMarkup,
  resolveRssPath,
  selectUpcoming,
  main,
} from "../scripts/build-lite-events.mjs";
import EventsCore from "../events-core.js";

const { rhythmLabel } = EventsCore;

const ev = (date, extra = {}) => ({
  source: "bitcircus101",
  title: "Linkup",
  date,
  ...extra,
});

// selectUpcoming's clock: a local wall time, the start of the day by default.
const at = (date, time = "00:00") => new Date(`${date}T${time}:00`);

// Dates of one weekly series — 2026-09-01 is a Tuesday.
const weekly = (date, extra = {}) => ev(date, { uid: "toys@x", recurring: true, title: "Look at my toys!", ...extra });

describe("selectUpcoming", () => {
  const TODAY = "2026-09-01";

  it("keeps an event until it is over: all-day the whole day, timed until its end", () => {
    const events = [
      ev(TODAY, { title: "Ganztags" }),
      ev(TODAY, { title: "Läuft", time: "19:00", endTime: "22:00" }),
      ev(TODAY, { title: "Vorbei", time: "17:00", endTime: "19:00" }),
    ];
    const titles = (time) => selectUpcoming({ events }, at(TODAY, time)).map((e) => e.title);
    assert.deepEqual(titles("00:00"), ["Ganztags", "Vorbei", "Läuft"]);
    assert.deepEqual(titles("20:30"), ["Ganztags", "Läuft"]);
    assert.deepEqual(titles("23:59"), ["Ganztags"]);
    // …and says where it stands today
    assert.deepEqual(
      selectUpcoming({ events }, at(TODAY, "20:30")).map((e) => e.word),
      ["heute", "läuft"]
    );
  });

  it("drops past events and the friends' calendars, keeps a home calendar's", () => {
    const sources = [
      { id: "bitcircus", name: "bitcircus101", relation: "own" },
      { id: "toys", name: "Toys", relation: "home" },
      { id: "datenburg", name: "datenburg", relation: "friend" },
    ];
    const events = [
      ev("2026-08-31"),
      ev("2026-09-02"),
      { source: "datenburg", title: "Fremd", date: "2026-09-03" },
      { source: "Toys", title: "Bei uns", date: "2026-09-04" },
      { source: "Nobody", title: "Unbekannt", date: "2026-09-05" }, // not in the list: a friend by default
    ];
    const out = selectUpcoming({ sources, events }, at(TODAY));
    assert.deepEqual(
      out.map((e) => e.date),
      ["2026-09-02", "2026-09-04"]
    );
    // pre-field data (no relation anywhere) has no friends: everything upcoming shows
    const legacy = selectUpcoming({ events }, at(TODAY));
    assert.deepEqual(legacy.map((e) => e.date), ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  });

  it("sorts chronologically, using the time as the tiebreaker within a day", () => {
    const out = selectUpcoming(
      {
        events: [
          ev("2026-09-04", { time: "20:00", title: "spät" }),
          ev("2026-09-02", { title: "früh" }),
          ev("2026-09-04", { time: "09:00", title: "morgens" }),
        ],
      },
      TODAY
    );
    assert.deepEqual(
      out.map((e) => e.title),
      ["früh", "morgens", "spät"]
    );
  });

  it("caps the list at 8 — the lite page is a summary, not the archive", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      ev(`2026-09-${String(i + 2).padStart(2, "0")}`)
    );
    assert.equal(selectUpcoming({ events }, at(TODAY)).length, 8);
    // …and keeps the EARLIEST eight, not an arbitrary window.
    assert.equal(selectUpcoming({ events }, at(TODAY))[0].date, "2026-09-02");
  });

  it("does not mutate the input array's order", () => {
    const events = [ev("2026-09-05"), ev("2026-09-02")];
    const snapshot = events.map((e) => e.date);
    selectUpcoming({ events }, at(TODAY));
    assert.deepEqual(
      events.map((e) => e.date),
      snapshot
    );
    // …nor the cards: the rhythm lands on copies
    const series = [weekly("2026-09-08"), weekly("2026-09-01"), weekly("2026-09-15")];
    const before = JSON.stringify(series);
    selectUpcoming({ events: series }, at(TODAY));
    assert.equal(JSON.stringify(series), before);
  });

  it("survives a missing or empty manifest", () => {
    assert.deepEqual(selectUpcoming({}, at(TODAY)), []);
    assert.deepEqual(selectUpcoming(null, at(TODAY)), []);
  });
});

describe("selectUpcoming — one line per series", () => {
  const TODAY = "2026-09-01";

  it("shows a series once, at its next date, and the cap counts lines, not dates", () => {
    const events = [
      weekly("2026-09-01"), weekly("2026-09-08"), weekly("2026-09-15"), weekly("2026-09-22"),
      ...Array.from({ length: 8 }, (_, i) => ev(`2026-09-${String(i + 2).padStart(2, "0")}`, { title: `Einmal ${i}` })),
    ];
    const out = selectUpcoming({ events }, at(TODAY));
    assert.equal(out.length, 8);
    assert.deepEqual(out.filter((e) => e.uid === "toys@x").map((e) => e.date), ["2026-09-01"]);
    assert.equal(out[0].rhythm, "jeden Dienstag");
    // the lines the series' later dates took go to what comes next
    assert.equal(out.at(-1).title, "Einmal 6");
    assert.ok(out.slice(1).every((e) => e.rhythm === ""), "a one-off has no rhythm");
  });

  it("gives a cancelled date a line of its own, and the series' next real date follows it", () => {
    const events = [
      weekly("2026-09-01", { title: "ABGESAGT: Look at my toys!" }),
      weekly("2026-09-08"),
      weekly("2026-09-15"),
      weekly("2026-09-22", { title: "CANCELED: Look at my toys!" }),
    ];
    // a week off does not change the rhythm: the cancelled dates count for it
    assert.deepEqual(
      selectUpcoming({ events }, at(TODAY)).map((e) => [e.date, e.rhythm]),
      [["2026-09-01", ""], ["2026-09-08", "jeden Dienstag"], ["2026-09-22", ""]]
    );
  });

  it("merges nothing but a series: the same UID in another source, or on one-offs, stays apart", () => {
    const events = [
      weekly("2026-09-01"),
      weekly("2026-09-08", { source: "Look at my toys!" }),
      ev("2026-09-02", { uid: "once@x" }),
      ev("2026-09-03", { uid: "once@x" }),
    ];
    assert.equal(selectUpcoming({ events }, at(TODAY)).length, 4);
  });
});

// events-core's, tested here with its first consumer.
describe("rhythmLabel", () => {
  it("names the weekday when three dates or more run in steps of one week", () => {
    assert.equal(rhythmLabel(["2026-09-01", "2026-09-08", "2026-09-15"]), "jeden Dienstag");
    assert.equal(rhythmLabel(["2026-09-25", "2026-09-04", "2026-09-18", "2026-09-11"]), "jeden Freitag", "any order");
    // across the end of summer time (25 Oct 2026) the steps are still whole weeks
    assert.equal(rhythmLabel(["2026-10-20", "2026-10-27", "2026-11-03"]), "jeden Dienstag");
  });

  it("names the nth weekday of consecutive months, and the last one", () => {
    assert.equal(rhythmLabel(["2026-09-18", "2026-10-16", "2026-11-20"]), "jeden 3. Freitag");
    assert.equal(rhythmLabel(["2026-11-20", "2026-12-18", "2027-01-15"]), "jeden 3. Freitag", "across the year");
    // 28 Oct, 25 Nov, 30 Dec: the 4th, 4th and 5th Wednesday — always the last
    assert.equal(rhythmLabel(["2026-10-28", "2026-11-25", "2026-12-30"]), "jeden letzten Mittwoch");
  });

  it("says nothing about a rhythm the dates do not show", () => {
    assert.equal(rhythmLabel(["2026-09-01", "2026-09-08"]), "", "two dates may be all there is");
    assert.equal(rhythmLabel(["2026-09-01", "2026-09-15", "2026-09-22"]), "", "a skipped week");
    assert.equal(rhythmLabel(["2026-09-18", "2026-11-20", "2026-12-18"]), "", "a skipped month");
    assert.equal(rhythmLabel(["2026-10-02", "2026-10-09", "2026-10-23", "2026-10-30"]), "", "1st, 2nd, 4th, 5th Friday");
    assert.equal(rhythmLabel(["2026-10-30", "2027-01-29", "2027-04-30"]), "", "5th Fridays: no month in a row");
    assert.equal(rhythmLabel(["2026-09-01"]), "");
    assert.equal(rhythmLabel([]), "");
    assert.equal(rhythmLabel(undefined), "");
  });
});

describe("resolveRssPath", () => {
  it("advertises the primary feed from the manifest — the one that carries what the list shows", () => {
    const data = {
      feeds: {
        primary: { ics: "/ical.ics", rss: "/feed.xml" },
        sources: { "cal-7": { name: "bitcircus101", rss: "/feeds/source/bitcircus.xml" } },
      },
    };
    assert.equal(resolveRssPath(data), "/feed.xml");
  });

  it("never picks a per-source feed, however it is named", () => {
    const data = {
      feeds: { sources: { b: { name: "bitcircus101", rss: "/feeds/source/bitcircus.xml" } } },
    };
    assert.equal(resolveRssPath(data), "../feed.xml");
  });

  it("falls back when the manifest names no primary rss", () => {
    const data = { feeds: { primary: { ics: "/ical.ics" } } };
    assert.equal(resolveRssPath(data), "../feed.xml");
  });

  it("falls back on a manifest-free file", () => {
    assert.equal(resolveRssPath({}), "../feed.xml");
    assert.equal(resolveRssPath(null), "../feed.xml");
  });
});

describe("formatDate / toDatetime", () => {
  it("renders the page's terse German form, with the time only when set", () => {
    assert.equal(formatDate("2026-09-04", "20:00"), "FR 4. SEP · 20:00");
    assert.equal(formatDate("2026-09-04"), "FR 4. SEP");
    assert.equal(formatDate("2026-03-01"), "SO 1. MÄR");
  });

  it("builds a machine-readable datetime attribute", () => {
    assert.equal(toDatetime("2026-09-04", "20:00"), "2026-09-04T20:00");
    assert.equal(toDatetime("2026-09-04"), "2026-09-04");
  });
});

describe("normalizeUrl", () => {
  it("passes through http(s) and webcal untouched", () => {
    assert.equal(normalizeUrl("https://a.example/x"), "https://a.example/x");
    assert.equal(normalizeUrl("webcal://a.example/x"), "webcal://a.example/x");
  });
  it("upgrades a bare host to https", () => {
    assert.equal(normalizeUrl("bitcircus101.de/x"), "https://bitcircus101.de/x");
  });
  it("rejects anything that is not a link, so no javascript: gets rendered", () => {
    assert.equal(normalizeUrl("javascript:alert(1)"), null);
    assert.equal(normalizeUrl("just some text"), null);
    assert.equal(normalizeUrl(""), null);
    assert.equal(normalizeUrl(null), null);
  });
});

describe("buildMarkup", () => {
  it("links a title only when the event carries a usable URL", () => {
    const out = buildMarkup(
      [ev("2026-09-04", { time: "20:00", eventUrl: "https://bitcircus101.de" })],
      null,
      "../feed.xml"
    );
    assert.match(out, /<a href="https:\/\/bitcircus101\.de" rel="noopener noreferrer">Linkup<\/a>/);
    assert.match(out, /<time datetime="2026-09-04T20:00" class="when">FR 4\. SEP · 20:00<\/time>/);
  });

  it("links a title with an id to its own page, the external URL beside it", () => {
    const out = buildMarkup(
      [
        ev("2026-09-04", { id: "0a1b2c3d4e5f", page: true, eventUrl: "https://kurse.example/x" }),
        ev("2026-09-05", { id: "<x>", page: true, title: "Ohne Link" }),
      ],
      null,
      "../feed.xml"
    );
    assert.match(out, /<span class="sep"> — <\/span><a href="\.\.\/e\/0a1b2c3d4e5f\/">Linkup<\/a> · <a href="https:\/\/kurse\.example\/x" rel="noopener noreferrer">extern<\/a><\/li>/);
    assert.match(out, /<span class="sep"> — <\/span><a href="\.\.\/e\/&lt;x&gt;\/">Ohne Link<\/a><\/li>/);
    // a card links its page only when the sync flagged it
    const flag = buildMarkup(
      [ev("2026-09-04", { id: "0a1b2c3d4e5f" }), ev("2026-09-05", { id: "ffffffffffff", page: true })],
      null, "../feed.xml"
    );
    assert.ok(!flag.includes("/e/0a1b2c3d4e5f/"), "an unflagged card got a page link");
    assert.ok(flag.includes('<a href="../e/ffffffffffff/">'), "a flagged card lost its page link");
  });

  it("renders a plain title when the URL is unusable", () => {
    const out = buildMarkup([ev("2026-09-04", { eventUrl: "javascript:alert(1)" })], null, "../feed.xml");
    assert.ok(!out.includes("<a href=\"javascript:"), "javascript: URL reached the page");
    assert.match(out, /<span class="sep"> — <\/span>Linkup<\/li>/);
  });

  it("escapes HTML in titles", () => {
    const out = buildMarkup([ev("2026-09-04", { title: "<b>x</b>" })], null, "../feed.xml");
    assert.ok(!out.includes("<b>"));
    assert.match(out, /&lt;b&gt;x&lt;\/b&gt;/);
  });

  it("offers a webcal and an ICS link derived from the calendar URL", () => {
    const out = buildMarkup([ev("2026-09-04")], "https://nc.example/cal?export", "../feed.xml");
    assert.match(out, /href="webcal:\/\/nc\.example\/cal\?export"/);
    assert.match(out, /href="https:\/\/nc\.example\/cal\?export"/);
  });

  it("omits the subscribe links entirely when no calendar URL is configured", () => {
    const out = buildMarkup([ev("2026-09-04")], null, "../feed.xml");
    assert.ok(!out.includes("webcal://"));
    assert.ok(!out.includes("Kalender-Abo"));
    assert.match(out, /<a href="\.\.\/feed\.xml">RSS-Feed<\/a>/);
  });

  it("strikes a cancelled title through, without the marker, and labels it", () => {
    const out = buildMarkup(
      [ev("2026-09-04", { id: "0a1b2c3d4e5f", page: true, title: "CANCELED: Linkup" }), ev("2026-09-05")],
      null,
      "../feed.xml"
    );
    assert.match(out, /<li class="cancelled"><time[^>]*>FR 4\. SEP<\/time>/);
    assert.match(
      out,
      /<a href="\.\.\/e\/0a1b2c3d4e5f\/"><s>Linkup<\/s><\/a> <span class="abgesagt"><span aria-hidden="true">✕ <\/span>abgesagt<\/span><\/li>/
    );
    assert.ok(!out.includes("CANCELED"), "the marker reached the page");
    // the other line is untouched
    assert.match(out, /<li><time datetime="2026-09-05"/);
    assert.equal((out.match(/class="abgesagt"/g) || []).length, 1, "one badge, on the cancelled line only");
  });

  it("names a series' rhythm after the title, escaped, and nothing without one", () => {
    const out = buildMarkup([ev("2026-09-01", { rhythm: "jeden <Dienstag>" })], null, "../feed.xml");
    assert.match(out, /Linkup <span class="dim">· jeden &lt;Dienstag&gt;<\/span><\/li>/);
    assert.ok(!buildMarkup([ev("2026-09-01")], null, "../feed.xml").includes('<span class="dim">'));
  });

  it("puts the word of the day inside the date, never on a cancelled line", () => {
    const out = buildMarkup([
      ev("2026-09-01", { time: "19:00", word: "läuft" }),
      ev("2026-09-02", { title: "ABGESAGT: Linkup", word: "morgen" }),
    ], null, "../feed.xml");
    // inside the <time>: on a phone the date line takes it along
    assert.match(out, /DI 1\. SEP · 19:00 <span class="jetzt">läuft<\/span><\/time>/);
    assert.equal((out.match(/class="jetzt"/g) || []).length, 1);
  });

  it("names another group's event and links their site", () => {
    const sources = [
      { id: "bitcircus", name: "bitcircus101", relation: "own" },
      { id: "toys", name: "Look at my toys!", relation: "home", site: "https://my.stim.toys/workshops" },
    ];
    const events = [ev("2026-09-01"), ev("2026-09-01", { source: "Look at my toys!", title: "Postkarten", time: "19:00" })];
    const out = buildMarkup(selectUpcoming({ sources, events }, at("2026-09-01")), null, "../feed.xml");
    assert.match(out, /Postkarten <span class="dim">· veranstaltet von <a href="https:\/\/my\.stim\.toys\/workshops" rel="noopener noreferrer">Look at my toys! ↗<\/a><\/span><\/li>/);
    assert.equal((out.match(/veranstaltet von/g) || []).length, 1, "ours carries no origin");
  });

  it("says so instead of rendering an empty list", () => {
    const out = buildMarkup([], null, "../feed.xml");
    assert.match(out, /Keine Termine eingetragen/);
    assert.ok(!out.includes("<ul"), "an empty list must not render a list element");
  });
});

describe("esc", () => {
  it("escapes the four characters that can break out of markup", () => {
    assert.equal(esc('<&">'), "&lt;&amp;&quot;&gt;");
  });
});

describe("main", () => {
  const TRACKED = fileURLToPath(new URL("../lite/index.html", import.meta.url));
  const localDay = (offsetDays) => {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };

  it("writes the list into the page it is handed and leaves the tracked one alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "lite-events-"));
    try {
      const tracked = readFileSync(TRACKED, "utf8");
      const page = join(dir, "index.html");
      const data = join(dir, "events-data.json");
      writeFileSync(page, tracked);
      writeFileSync(data, JSON.stringify({ events: [ev(localDay(3), { title: "Fixture-Abend" })] }));
      main([data, page]);
      assert.match(readFileSync(page, "utf8"), /<ul class="termine">\n<li>[^\n]*Fixture-Abend<\/li>\n<\/ul>/);
      assert.equal(readFileSync(TRACKED, "utf8"), tracked, "lite/index.html was written");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
