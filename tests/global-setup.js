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
    const card = {
      title, subtitle: "", description, location: "Dorotheenstraße 101",
      date: d, time: "19:00", endDate: d, endTime: "22:00",
      tags: ["#workshop"], type: "workshop", source: "bitcircus101", uid,
      calendarUrl: "https://nc.example.org/apps/calendar/p/abc",
      ...extra,
    };
    card.id = require("../events-core.js").eventId(card, { name: card.source });
    events[card.id] = { ...card, firstSeen: data.lastSync, lastSeen: day };
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
  past(48, "Linkup ausgefallen (Fixture)", "fixture-linkup-4", "", { ...linkup, cancelled: true });
  past(62, "Linkup@bitcircus101 (Fixture)", "fixture-linkup-5", "", linkup);
  past(400, "Uralter Linkup (Fixture)", "fixture-linkup-6", "", linkup);
  return { version: 1, events };
}

module.exports = async function globalSetup() {
  const file = path.join(os.tmpdir(), `bc101-e2e-archive-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(buildEventsArchive(), null, 2));
  try {
    execFileSync(process.execPath, ["scripts/build-event-pages.mjs", file], {
      cwd: ROOT,
      stdio: "inherit",
    });
    // The status page's data from the same archive (live-only otherwise).
    execFileSync(process.execPath, ["scripts/build-status-data.mjs", file], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
};

module.exports.buildEventsArchive = buildEventsArchive;
