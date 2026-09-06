// Deterministic events-data.json for the E2E suite.
//
// Why this exists: the events tests used to run against whatever the live
// calendar happened to return, guarded by `if (!card.isVisible()) return`.
// That guard turned a network failure — or any local checkout, where
// events-data.json does not exist at all — into a silent pass: the whole
// interactive surface (filters, search, URL state, subscribe box) stopped
// being tested and CI still went green. Tests that cannot fail are not tests.
//
// Dates are relative to "now" so the fixture never rots: everything is in the
// future, and the +40d entry always lands in a later month than the +2d one,
// which is what makes the month grouping assertion meaningful.
//
// The shape mirrors a real events-data.json (see scripts/sync-events.mjs):
// { lastSync, sources, events, feeds }. Keep it in sync when that shape moves.

const DAY = 86400000;

function iso(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function inDays(n) {
  return iso(new Date(Date.now() + n * DAY));
}

/**
 * Tags are alphabetical in the filter bar (events.js sorts them), so the
 * FIRST chip is always "#hardware" — and it sits only on bitcircus101 events.
 * Both of those are load-bearing:
 *   - filtering by it must shrink the list (2 of 6), not keep it whole
 *   - it must survive the "nur bitcircus101" toggle, which is the regression
 *     the source-toggle assertion guards
 */
function buildEventsData() {
  const now = new Date().toISOString();

  const events = [
    {
      title: "Hardware Hackingabend",
      subtitle: "",
      description: "Löten, messen, reparieren.",
      location: "Dorotheenstraße 101",
      date: inDays(2),
      time: "19:00",
      endDate: inDays(2),
      endTime: "22:00",
      tags: ["#hardware", "#linux"],
      type: "linkup",
      source: "bitcircus101",
      uid: "fixture-1",
    },
    {
      title: "Lötworkshop für Einsteiger",
      subtitle: "",
      description: "",
      location: "Dorotheenstraße 101",
      date: inDays(5),
      time: "18:00",
      endDate: inDays(5),
      endTime: "21:00",
      tags: ["#hardware"],
      type: "workshop",
      source: "bitcircus101",
      uid: "fixture-2",
    },
    {
      title: "Offener Abend Datenburg",
      subtitle: "",
      description: "",
      location: "",
      date: inDays(9),
      time: "18:00",
      endDate: inDays(9),
      endTime: "22:00",
      tags: ["#linux"],
      type: "special",
      source: "Datenburg e.V.",
      uid: "fixture-3",
    },
    // +40d guarantees a second month group whatever today's date is
    {
      title: "Monatstreffen Orga",
      subtitle: "",
      description: "",
      location: "Dorotheenstraße 101",
      date: inDays(40),
      time: "20:00",
      endDate: inDays(40),
      endTime: "22:00",
      tags: ["#workshop"],
      type: "",
      source: "bitcircus101",
      uid: "fixture-4",
    },
    {
      title: "Datenburg Werkstatt",
      subtitle: "",
      description: "",
      location: "",
      date: inDays(45),
      time: "17:00",
      endDate: inDays(45),
      endTime: "20:00",
      tags: ["#linux", "#workshop"],
      type: "",
      source: "Datenburg e.V.",
      uid: "fixture-5",
    },
    {
      title: "Kryptoparty Bonn",
      subtitle: "",
      description: "",
      location: "Dorotheenstraße 101",
      date: inDays(50),
      time: "19:00",
      endDate: inDays(50),
      endTime: "22:00",
      tags: ["#workshop"],
      type: "",
      source: "bitcircus101",
      uid: "fixture-6",
    },
  ];

  return {
    lastSync: now,
    sources: [
      {
        id: "bitcircus",
        name: "bitcircus101",
        fetchedAt: now,
        status: "ok",
        events: 4,
        added: 0,
        removed: 0,
        total: 4,
        past: 0,
        upcoming: 4,
      },
      {
        id: "datenburg",
        name: "Datenburg e.V.",
        fetchedAt: now,
        status: "ok",
        events: 2,
        added: 0,
        removed: 0,
        total: 2,
        past: 0,
        upcoming: 2,
      },
    ],
    events,
    feeds: {
      all: { ics: "/feeds/all.ics", rss: "/feeds/all.xml", count: events.length },
      primary: { ics: "/ical.ics", rss: "/feed.xml", title: "bitcircus101 – Termine" },
      tags: {
        "#hardware": { ics: "/feeds/tag/hardware.ics", rss: "/feeds/tag/hardware.xml", count: 2 },
        "#linux": { ics: "/feeds/tag/linux.ics", rss: "/feeds/tag/linux.xml", count: 3 },
        "#workshop": { ics: "/feeds/tag/workshop.ics", rss: "/feeds/tag/workshop.xml", count: 3 },
      },
      sources: {
        bitcircus: {
          name: "bitcircus101",
          ics: "/feeds/source/bitcircus.ics",
          rss: "/feeds/source/bitcircus.xml",
          count: 4,
        },
        datenburg: {
          name: "Datenburg e.V.",
          ics: "/feeds/source/datenburg.ics",
          rss: "/feeds/source/datenburg.xml",
          count: 2,
        },
      },
      retired: {},
    },
  };
}

/**
 * Serve the fixture for every events-data.json request on this page, so the
 * test no longer depends on what the calendar returned today.
 */
/**
 * @param {import('@playwright/test').Page} page
 * @param {object} [data] fixture payload (default: buildEventsData())
 * @param {{ delayMs?: number }} [opts] delayMs holds the response back, so
 *   the page's loading state is guaranteed to paint before the data lands —
 *   what a layout-stability assertion needs (an instant answer would skip
 *   the very frame it measures). Playwright matches routes newest-first, so
 *   a test may call this again on top of the beforeEach fixture.
 */
async function useEventsFixture(page, data, opts) {
  const body = JSON.stringify(data || buildEventsData());
  const delayMs = (opts && opts.delayMs) || 0;
  // Trailing `*`: the kiosk fetches `../events-data.json?t=…` with a
  // cache buster, which a pattern ending at `.json` would not match.
  await page.route("**/events-data.json*", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

module.exports = { buildEventsData, useEventsFixture };
