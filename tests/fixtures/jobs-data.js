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

/**
 * Postings the CI gate would REFUSE — which is exactly why they are here.
 *
 * jobs.js escapes every field and independently drops any url that is not
 * https, and its header calls that "defense in depth: even if the gate were
 * bypassed". A claim like that is worth nothing until something can prove it,
 * so this fixture is the bypass: it reaches the renderer without ever passing
 * scripts/check-jobs.mjs.
 *
 * Only the last entry has a usable https url, so exactly ONE card may render —
 * and that card's own text is hostile, so it also proves the escaping.
 */
function buildHostileJobsData() {
  const live = { from: '2026-09-01', months: 3 };
  return {
    postings: [
      { id: 'scheme-js', company: 'Böse GmbH', title: 'javascript: URL',
        url: 'javascript:window.__pwned = 1', ...live },
      { id: 'scheme-data', company: 'Böse GmbH', title: 'data: URL',
        url: 'data:text/html,<script>window.__pwned = 1</script>', ...live },
      { id: 'scheme-relative', company: 'Böse GmbH', title: 'protocol-relative URL',
        url: '//evil.example/jobs', ...live },
      { id: 'scheme-upper', company: 'Böse GmbH', title: 'uppercase scheme',
        url: 'HTTPS://evil.example/jobs', ...live },
      {
        id: 'markup"><img src=x onerror="window.__pwned = 1">',
        company: '"><img src=x onerror="window.__pwned = 1">',
        title: '</h3><svg onload="window.__pwned = 1"></svg>',
        url: 'https://ok.example/jobs/real',
        ...live,
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

module.exports = { buildJobsData, buildHostileJobsData, useJobsFixture, TODAY };
