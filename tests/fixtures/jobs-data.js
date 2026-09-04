// Deterministic jobs.json for the E2E suite.
//
// Why this exists: the committed jobs.json starts empty and fills up with real
// postings over time. Asserting the board against it would mean the first
// company to hang a note breaks the suite — and until then the card rendering,
// the ordering and the expiry filter would never be exercised at all.
//
// Dates are ABSOLUTE, not relative to now: the board test pins the clock with
// page.clock.install(), so "today" is 2026-09-15 and every entry below sits at a
// known distance from it. Keep the two in step if either moves.
//
// The shape mirrors the real jobs.json (see jobs.schema.json): { postings: [] },
// six required fields per entry, no optional ones.

const TODAY = "2026-09-15";

/**
 * Four postings around TODAY:
 *   - two active with different `from` (so the newest-first order is testable)
 *   - one that expired yesterday (2026-08-14 + 1 month → up to 2026-09-13)
 *   - one that only starts next month
 * Exactly two cards must render.
 */
function buildJobsData() {
  return {
    postings: [
      {
        id: "expired-gmbh-2026-08",
        company: "Abgelaufen GmbH",
        title: "Diese Anzeige ist vorgestern ausgelaufen",
        url: "https://expired.example/jobs/old",
        from: "2026-08-14",
        months: 1,
      },
      {
        id: "acme-2026-09",
        company: "ACME GmbH",
        title: "Embedded-Entwickler:in (m/w/d), Bonn oder remote",
        url: "https://acme.example/jobs/embedded",
        from: "2026-09-01",
        months: 3,
      },
      {
        id: "bytewerk-2026-09",
        company: "Bytewerk eG",
        title: "Systemadministrator:in (m/w/d), Bonn",
        url: "https://bytewerk.example/karriere/sysadmin",
        from: "2026-09-10",
        months: 1,
      },
      {
        id: "future-ag-2026-10",
        company: "Später AG",
        title: "Startet erst im nächsten Monat",
        url: "https://future.example/jobs/later",
        from: "2026-10-01",
        months: 1,
      },
    ],
  };
}

/** Serve the fixture for every jobs.json request on this page. */
async function useJobsFixture(page, data) {
  const body = JSON.stringify(data || buildJobsData());
  // Trailing `*` mirrors the events fixture: a cache-busted URL must match too.
  await page.route("**/jobs.json*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body })
  );
}

module.exports = { buildJobsData, useJobsFixture, TODAY };
