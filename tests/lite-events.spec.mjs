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
import {
  esc,
  formatDate,
  toDatetime,
  normalizeUrl,
  buildMarkup,
  resolveRssPath,
  selectUpcoming,
} from "../scripts/build-lite-events.mjs";

const ev = (date, extra = {}) => ({
  source: "bitcircus101",
  title: "Linkup",
  date,
  ...extra,
});

describe("selectUpcoming", () => {
  const TODAY = "2026-09-01";

  it("keeps today's events — an event is not past until the day is over", () => {
    const out = selectUpcoming({ events: [ev(TODAY)] }, TODAY);
    assert.equal(out.length, 1);
  });

  it("drops past events and foreign sources", () => {
    const out = selectUpcoming(
      {
        events: [
          ev("2026-08-31"),
          ev("2026-09-02"),
          { source: "datenburg", title: "Fremd", date: "2026-09-03" },
        ],
      },
      TODAY
    );
    assert.deepEqual(
      out.map((e) => e.date),
      ["2026-09-02"]
    );
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
    assert.equal(selectUpcoming({ events }, TODAY).length, 8);
    // …and keeps the EARLIEST eight, not an arbitrary window.
    assert.equal(selectUpcoming({ events }, TODAY)[0].date, "2026-09-02");
  });

  it("does not mutate the input array's order", () => {
    const events = [ev("2026-09-05"), ev("2026-09-02")];
    const snapshot = events.map((e) => e.date);
    selectUpcoming({ events }, TODAY);
    assert.deepEqual(
      events.map((e) => e.date),
      snapshot
    );
  });

  it("survives a missing or empty manifest", () => {
    assert.deepEqual(selectUpcoming({}, TODAY), []);
    assert.deepEqual(selectUpcoming(null, TODAY), []);
  });
});

describe("resolveRssPath", () => {
  it("prefers the bitcircus per-source feed, resolved by card-facing name", () => {
    const data = {
      feeds: {
        sources: {
          "cal-7": { name: "bitcircus101", rss: "/feeds/source/bitcircus.xml" },
        },
      },
    };
    assert.equal(resolveRssPath(data), "/feeds/source/bitcircus.xml");
  });

  it("ignores a foreign source that also carries an rss feed", () => {
    // The primary feed is bitcircus-only today, but that is a config flag, not
    // a guarantee — this page must never advertise someone else's feed.
    const data = {
      feeds: { sources: { d: { name: "datenburg", rss: "/feeds/source/datenburg.xml" } } },
    };
    assert.equal(resolveRssPath(data), "../feed.xml");
  });

  it("falls back when the source exists but has no feed", () => {
    const data = { feeds: { sources: { b: { name: "bitcircus101" } } } };
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
    assert.match(out, /<time datetime="2026-09-04T20:00" class="dim">FR 4\. SEP · 20:00<\/time>/);
  });

  it("renders a plain title when the URL is unusable", () => {
    const out = buildMarkup([ev("2026-09-04", { eventUrl: "javascript:alert(1)" })], null, "../feed.xml");
    assert.ok(!out.includes("<a href=\"javascript:"), "javascript: URL reached the page");
    assert.match(out, /— Linkup<\/li>/);
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

  it("says so instead of rendering an empty list", () => {
    const out = buildMarkup([], null, "../feed.xml");
    assert.match(out, /Keine Termine eingetragen/);
    assert.ok(!out.includes("<ul>"));
  });
});

describe("esc", () => {
  it("escapes the four characters that can break out of markup", () => {
    assert.equal(esc('<&">'), "&lt;&amp;&quot;&gt;");
  });
});
