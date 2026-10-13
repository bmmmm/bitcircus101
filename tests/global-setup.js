// Playwright globalSetup — builds the event pages the suite navigates to.
//
// The pages under e/<id>/ and archiv/ are live-only artifacts (the sync writes
// them on the live branch), so a checkout has none. The suite still has to open
// one ("No JavaScript errors"), follow the "→ details" pills the events fixture
// renders ("Internal links") and read the archive index — so they are generated
// here from the SAME fixture the tests serve, via the real generator, into the
// git-ignored e/ and archiv/ directories. Deterministic: ids hash the uid.
// status-data.json (/status) is built from the same archive, for the same reason.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildEventsData } = require("./fixtures/events-data");

const ROOT = path.resolve(__dirname, "..");

function iso(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** The archive the pages are built from: the fixture's own cards plus a few
 *  past ones, so the archive index has something to list. */
function buildEventsArchive() {
  const data = buildEventsData();
  const day = iso(new Date());
  const events = {};
  for (const card of data.events) {
    if (card.source !== "bitcircus101") continue; // only primary sources get pages
    events[card.id] = { ...card, firstSeen: data.lastSync, lastSeen: day };
  }
  const past = (n, title, uid, description, extra = {}) => {
    const d = iso(new Date(Date.now() - n * 86400000));
    const { firstSeen = data.lastSync, ...fields } = extra;
    const card = {
      title, subtitle: "", description, location: "Dorotheenstraße 101",
      date: d, time: "19:00", endDate: d, endTime: "22:00",
      tags: ["#workshop"], type: "workshop", source: "bitcircus101", uid,
      calendarUrl: "https://nc.example.org/apps/calendar/p/abc",
      ...fields,
    };
    card.id = require("../events-core.js").eventId(card, { name: card.source });
    events[card.id] = { ...card, firstSeen, lastSeen: day };
  };
  past(20, "Vergangener Lötabend", "fixture-past-1", "Erster Absatz.\n\nZweiter Absatz mit https://example.org/link.");
  past(400, "Sehr alter Termin", "fixture-past-2", "");
  // The status page reads these through scripts/build-status-data.mjs: past
  // linkups a week apart (never the same ISO week), one cancelled — the
  // incident the e2e clicks — and one old enough to sit in a squashed month
  // bucket; the fixture's own future cards above are its "geplant" bars. All
  // older than the Lötabend above, which the archive test expects on top.
  const linkup = { tags: ["#meetup"], type: "linkup" };
  past(27, "Casual Linkup (Fixture)", "fixture-linkup-1", "", linkup);
  past(34, "Casual Linkup (Fixture)", "fixture-linkup-2", "", linkup);
  past(41, "Casual Linkup (Fixture)", "fixture-linkup-3", "", linkup);
  // Vanished entries count only after MIN_VISIBLE_DAYS in the export, so this
  // one was first seen ten days before its date (the default firstSeen is today).
  past(48, "Linkup ausgefallen (Fixture)", "fixture-linkup-4", "", {
    ...linkup, cancelled: true, firstSeen: iso(new Date(Date.now() - 58 * 86400000)) + "T12:00:00.000Z",
  });
  past(62, "Linkup@bitcircus101 (Fixture)", "fixture-linkup-5", "", linkup);
  past(400, "Uralter Linkup (Fixture)", "fixture-linkup-6", "", linkup);
  return { version: 1, events };
}

/** Throws when baseURL is served by anything but this checkout's
 *  tests/serve.mjs — with reuseExistingServer a server another checkout left
 *  on the port would otherwise run the suite against that checkout's files.
 *  Nothing listening yet: nothing to check. */
async function assertServesCheckout(baseURL, root = ROOT) {
  let res;
  try {
    res = await fetch(baseURL);
  } catch {
    return;
  }
  const served = res.headers.get("x-serve-root");
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  if (!served || real(served) !== real(root)) {
    throw new Error(`${baseURL} serves ${served || "an unknown server"}, not this checkout — stop it`);
  }
}

module.exports = async function globalSetup(config) {
  await assertServesCheckout(config.projects[0].use.baseURL);
  const file = path.join(os.tmpdir(), `bc101-e2e-archive-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(buildEventsArchive(), null, 2));
  // build-status-data.mjs also stamps the homepage's streak line. Hand it a
  // throwaway page: the suite must not leave the tracked index.html dirty, and
  // the fallback text committed there is what the e2e should see.
  const home = path.join(os.tmpdir(), `bc101-e2e-home-${process.pid}.html`);
  fs.writeFileSync(home, "<p><!-- status-streak:start --><a>x</a><!-- status-streak:end --></p>\n");
  // /calendar/ (live-only too) from the fixture's events data — the homepage
  // and the lite page link it, so the link crawl must find it.
  const data = path.join(os.tmpdir(), `bc101-e2e-events-${process.pid}.json`);
  fs.writeFileSync(data, JSON.stringify(buildEventsData()));
  try {
    execFileSync(process.execPath, ["scripts/build-calendar-page.mjs", data], {
      cwd: ROOT,
      stdio: "inherit",
    });
    execFileSync(process.execPath, ["scripts/build-event-pages.mjs", file], {
      cwd: ROOT,
      stdio: "inherit",
    });
    // The status page's data from the same archive (live-only otherwise).
    execFileSync(process.execPath, ["scripts/build-status-data.mjs", file, path.join(ROOT, "status-data.json"), home], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(home, { force: true });
    fs.rmSync(data, { force: true });
  }
};

module.exports.buildEventsArchive = buildEventsArchive;
module.exports.assertServesCheckout = assertServesCheckout;
