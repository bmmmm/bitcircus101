/**
 * Unit tests for scripts/build-calendar-page.mjs (/calendar/) and the
 * "→ kalender" link target, EventsCore.calendarHref. Runs with:
 *   node --test tests/calendar-page.spec.mjs
 * No browser, no network, no writes.
 *
 * At stake: /calendar/ is where the old Nextcloud view link redirects and where
 * subscribers are sent. It must offer the COMPLETE calendar (the site's own
 * feeds are only a window of upcoming events), say what the window is, and
 * exist even when the manifest is missing.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { extractChrome } from "../scripts/build-event-pages.mjs";
import {
  completeCalendars,
  feedUrls,
  manifestOf,
  renderCalendarPage,
} from "../scripts/build-calendar-page.mjs";
import EventsCore from "../events-core.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const chrome = extractChrome(fs.readFileSync(`${ROOT}events.html`, "utf8"));

const FEEDS = {
  primary: { ics: "/ical.ics", rss: "/feed.xml", title: "bitcircus101 – Termine" },
  all: { ics: "/feeds/all.ics", rss: "/feeds/all.xml", count: 40 },
  tags: { "#workshop": { ics: "/feeds/tag/workshop.ics", rss: "/feeds/tag/workshop.xml", count: 2 } },
  sources: {
    bitcircus: { name: "bitcircus101", ics: "/feeds/source/bitcircus.ics", rss: "/feeds/source/bitcircus.xml" },
    other: { name: "Space <b>&</b> Co", ics: "/feeds/source/other.ics", rss: "/feeds/source/other.xml" },
  },
};
const CALENDARS = [
  { id: "bitcircus", name: "bitcircus101", ics: "https://cal.example.org/pub/abc?export", rss: true },
  { id: "friends", name: "Friends", ics: "https://friends.example.org/cal.ics", rss: false },
];

describe("calendar page", () => {
  it("the template still yields chrome to build on", () => {
    assert.ok(chrome, "events.html lost its <header>/<footer>/style.css?v=");
  });

  it("lists the complete calendar of each primary source, from its configured ics", () => {
    const complete = completeCalendars(CALENDARS);
    assert.deepEqual(complete, [{ name: "bitcircus101", ics: "https://cal.example.org/pub/abc?export" }]);
    const html = renderCalendarPage(FEEDS, chrome, complete);
    assert.ok(html.includes(`href="webcal://cal.example.org/pub/abc?export"`));
    assert.ok(html.includes(`href="https://cal.example.org/pub/abc?export"`));
    assert.ok(!html.includes("friends.example.org"), "a non-primary source's raw calendar is not listed");
    assert.ok(html.indexOf("kompletter kalender") < html.indexOf("feeds dieser website"), "complete calendar first");
  });

  it("lists webcal + https for the site's primary, all and every source feed and states the window", () => {
    const html = renderCalendarPage(FEEDS, chrome, []);
    for (const p of ["/ical.ics", "/feeds/all.ics", "/feeds/source/bitcircus.ics", "/feeds/source/other.ics"]) {
      assert.ok(html.includes(`href="webcal://bitcircus101.de${p}"`), `webcal ${p}`);
      assert.ok(html.includes(`href="https://bitcircus101.de${p}"`), `https ${p}`);
    }
    assert.ok(html.includes(`href="https://bitcircus101.de/feed.xml"`));
    assert.match(html, /keine vergangenen/);
    assert.ok(!html.includes("kompletter kalender"), "no complete-calendar section without a configured source");
    assert.ok(html.includes(`<link rel="canonical" href="https://bitcircus101.de/calendar/" />`));
  });

  it("escapes source names", () => {
    const html = renderCalendarPage(FEEDS, chrome, []);
    assert.ok(html.includes("Space &lt;b&gt;&amp;&lt;/b&gt; Co"));
    assert.ok(!html.includes("<b>&</b>"));
  });

  it("falls back to the primary feeds when the manifest is missing", () => {
    const feeds = manifestOf(null);
    const html = renderCalendarPage(feeds, chrome, []);
    assert.ok(html.includes(`href="webcal://bitcircus101.de/ical.ics"`));
    assert.ok(html.includes(`href="https://bitcircus101.de/feeds/all.ics"`));
    assert.deepEqual(manifestOf({ events: [] }), feeds, "data without feeds uses the fallback too");
  });

  it("rebases the chrome one level down", () => {
    const html = renderCalendarPage(FEEDS, chrome, []);
    assert.ok(html.includes(`href="../style.css?v=${chrome.assetVersion}"`));
  });

  it("feedUrls turns a root path or an absolute URL into https and webcal", () => {
    assert.deepEqual(feedUrls("/ical.ics"), {
      https: "https://bitcircus101.de/ical.ics",
      webcal: "webcal://bitcircus101.de/ical.ics",
    });
    assert.equal(feedUrls("https://cal.example.org/x?export").webcal, "webcal://cal.example.org/x?export");
  });
});

describe("calendarHref", () => {
  it("opens a Nextcloud calendar view on the event's day", () => {
    assert.equal(
      EventsCore.calendarHref("https://nc.example.org/apps/calendar/p/abc", "2026-10-16"),
      "https://nc.example.org/apps/calendar/p/abc/timeGridDay/2026-10-16"
    );
    assert.equal(
      EventsCore.calendarHref("https://nc.example.org/apps/calendar/p/abc/", "2026-10-16"),
      "https://nc.example.org/apps/calendar/p/abc/timeGridDay/2026-10-16"
    );
  });

  it("links any other calendar page as is — it has no day route", () => {
    assert.equal(
      EventsCore.calendarHref("https://bitcircus101.de/calendar/", "2026-10-16"),
      "https://bitcircus101.de/calendar/"
    );
  });
});
