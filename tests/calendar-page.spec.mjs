/**
 * Unit tests for scripts/build-calendar-page.mjs (/calendar/) and the
 * "→ kalender" link target, EventsCore.calendarHref. Runs with:
 *   node --test tests/calendar-page.spec.mjs
 * No browser, no network, no writes.
 *
 * At stake: /calendar/ is where the old Nextcloud view link redirects and where
 * subscribers are sent. It must put everything of ours first and in one place,
 * offer the COMPLETE calendar as the one obvious button (the site's own feeds
 * are only a window of upcoming events), keep look-alike feeds apart by scope
 * and span, and exist even when the manifest is missing.
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
  planCalendarPage,
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
    toys: { name: "Toys", ics: "/feeds/source/toys.ics", rss: "/feeds/source/toys.xml" },
    other: { name: "Space <b>&</b> Co", ics: "/feeds/source/other.ics", rss: "/feeds/source/other.xml" },
  },
};
const OWN_ICS = "https://cal.example.org/pub/abc?export";
const CALENDARS = [
  { id: "bitcircus", name: "bitcircus101", ics: OWN_ICS, rss: true },
  { id: "toys", name: "Toys", ics: "https://toys.example.org/cal.ics", rss: true },
  { id: "other", name: "Space <b>&</b> Co", ics: "https://friends.example.org/cal.ics", rss: false },
];

/** The markup of one panel section, by id. */
function section(html, id) {
  const start = html.indexOf(`<section id="${id}"`);
  assert.ok(start >= 0, `section #${id} missing`);
  return html.slice(start, html.indexOf("</section>", start));
}

describe("calendar page", () => {
  it("the template still yields chrome to build on", () => {
    assert.ok(chrome, "events.html lost its <header>/<footer>/style.css?v=");
  });

  it("bundles our feeds first: complete and window of bitcircus101, then the primary feed named by its sources", () => {
    const { own } = planCalendarPage(FEEDS, CALENDARS);
    assert.deepEqual(own, [
      {
        title: "bitcircus101",
        lines: [
          { span: "complete", ics: OWN_ICS, primary: true },
          { span: "window", ics: "/feeds/source/bitcircus.ics", rss: "/feeds/source/bitcircus.xml" },
        ],
      },
      { title: "bitcircus101 + Toys", lines: [{ span: "window", ics: "/ical.ics", rss: "/feed.xml" }] },
    ]);
  });

  it("lists every other source and the all-in-one feed after ours, raw calendars only for primary sources", () => {
    const html = renderCalendarPage(FEEDS, chrome, CALENDARS);
    assert.ok(html.indexOf(`<section id="bitcircus101"`) < html.indexOf(`<section id="weitere"`), "ours first");
    const ours = section(html, "bitcircus101");
    for (const p of [OWN_ICS.replace("https://", ""), "bitcircus101.de/feeds/source/bitcircus.ics", "bitcircus101.de/ical.ics"]) {
      assert.ok(ours.includes(`href="webcal://${p}"`), `ours: ${p}`);
    }
    assert.ok(!/feeds\/source\/(toys|other)|toys\.example|all\.ics/.test(ours), "nothing but our feeds in the first panel");
    const rest = section(html, "weitere");
    for (const p of ["toys.example.org/cal.ics", "bitcircus101.de/feeds/source/toys.ics",
      "bitcircus101.de/feeds/source/other.ics", "bitcircus101.de/feeds/all.ics"]) {
      assert.ok(rest.includes(`href="webcal://${p}"`), `rest: ${p}`);
    }
    assert.ok(rest.includes(`<p class="calendar-feed__note">bitcircus101 + Toys + Space &lt;b&gt;&amp;&lt;/b&gt; Co</p>`),
      "the all-in-one feed names what it carries");
    assert.ok(!html.includes("friends.example.org"), "a non-primary source's raw calendar is not listed");
    assert.ok(html.includes(`href="https://bitcircus101.de/feed.xml"`), "the primary feed keeps its rss");
    assert.ok(html.includes(`<link rel="canonical" href="https://bitcircus101.de/calendar/" />`));
  });

  it("makes exactly one button primary — our complete calendar", () => {
    const html = renderCalendarPage(FEEDS, chrome, CALENDARS);
    const primary = [...html.matchAll(/class="[^"]*events-subscribe__btn--primary" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(primary, ["webcal://cal.example.org/pub/abc?export"]);
  });

  it("shows each line's address as the text to copy — the same URL it subscribes to", () => {
    const html = renderCalendarPage(FEEDS, chrome, CALENDARS);
    const lines = [...html.matchAll(/<code class="calendar-feed__url">(.*?)<\/code>[\s\S]*?href="(webcal:[^"]+)"[^>]*>&#8595; abonnieren/g)];
    assert.equal(lines.length, 7, "one address per line");
    for (const [, shown, webcal] of lines) {
      assert.equal(shown.replaceAll("<wbr>", "").replaceAll("&amp;", "&"), webcal.replace("webcal://", "https://"));
    }
  });

  it("labels every line with its span, and the legend explains both", () => {
    const html = renderCalendarPage(FEEDS, chrome, CALENDARS);
    const spans = [...html.matchAll(/class="calendar-feed__span"[^>]*><span aria-hidden="true">(.)<\/span> (\S+)</g)]
      .map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(spans, ["↔ komplett", "→ demnächst", "→ demnächst", "↔ komplett", "→ demnächst", "→ demnächst", "→ demnächst"]);
    const legend = section(html, "wie");
    assert.ok(legend.includes(`<dt><span aria-hidden="true">↔</span> komplett</dt>`));
    assert.ok(legend.includes(`<dt><span aria-hidden="true">→</span> demnächst</dt>`));
  });

  it("folds the primary feed into our box when it carries nothing but ours", () => {
    const { own } = planCalendarPage(FEEDS, CALENDARS.map((c) => (c.id === "toys" ? { ...c, rss: false } : c)));
    assert.deepEqual(own, [{
      title: "bitcircus101",
      lines: [
        { span: "complete", ics: OWN_ICS, primary: true },
        { span: "window", ics: "/ical.ics", rss: "/feed.xml" },
      ],
    }]);
  });

  it("escapes source names", () => {
    const html = renderCalendarPage(FEEDS, chrome, CALENDARS);
    assert.ok(html.includes("Space &lt;b&gt;&amp;&lt;/b&gt; Co"));
    assert.ok(!html.includes("<b>&</b>"));
  });

  it("falls back to the primary feeds when the manifest and the calendars are missing", () => {
    const feeds = manifestOf(null);
    const html = renderCalendarPage(feeds, chrome, []);
    assert.ok(section(html, "bitcircus101").includes(`href="webcal://bitcircus101.de/ical.ics"`));
    assert.ok(html.includes(`href="webcal://bitcircus101.de/feeds/all.ics"`));
    assert.match(html, /events-subscribe__btn--primary" href="webcal:\/\/bitcircus101.de\/ical.ics"/, "still one obvious button");
    assert.deepEqual(manifestOf({ events: [] }), feeds, "data without feeds uses the fallback too");
  });

  it("rebases the chrome one level down", () => {
    const html = renderCalendarPage(FEEDS, chrome, CALENDARS);
    assert.ok(html.includes(`href="../style.css?v=${chrome.assetVersion}"`));
  });

  it("feedUrls turns a root path or an absolute URL into https and webcal", () => {
    assert.deepEqual(feedUrls("/ical.ics"), {
      https: "https://bitcircus101.de/ical.ics",
      webcal: "webcal://bitcircus101.de/ical.ics",
    });
    assert.equal(feedUrls("https://cal.example.org/x?export").webcal, "webcal://cal.example.org/x?export");
  });

  it("completeCalendars keeps only primary sources with an http(s) ics", () => {
    assert.deepEqual(completeCalendars(CALENDARS), [
      { name: "bitcircus101", ics: OWN_ICS },
      { name: "Toys", ics: "https://toys.example.org/cal.ics" },
    ]);
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
