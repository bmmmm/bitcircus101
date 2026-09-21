/**
 * Unit tests for scripts/build-status-data.mjs — the JSON behind /status.
 * Runs with: node --test tests/build-status-data.spec.mjs
 *
 * Importing the script is inert (its main() is guarded). buildStatusData()
 * is pure, so the filter and the shape are tested in-process; main() is run
 * as a child process against a temp archive for the file contract.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildStatusData, PRIMARY_SOURCE, SERIES, STATUS_SINCE } from "../scripts/build-status-data.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/build-status-data.mjs", import.meta.url));

/** An archive entry as the sync writes it — everything the page must NOT carry. */
const entry = (id, date, extra = {}) => ({
  id,
  title: "Linkup " + date,
  subtitle: "",
  description: "Absatz eins.\n\nAbsatz zwei mit https://example.org/link. ".repeat(20),
  location: "Dorotheenstraße 101, 53111 Bonn",
  date,
  time: "20:00",
  endDate: date,
  endTime: "23:00",
  tags: ["#meetup"],
  type: "linkup",
  source: PRIMARY_SOURCE,
  uid: "uid-" + id,
  calendarUrl: "https://bitcircus101.de",
  recurring: true,
  firstSeen: "2026-09-13T16:50:55.355Z",
  lastSeen: date,
  ...extra,
});
const archive = (...entries) => ({ version: 1, events: Object.fromEntries(entries.map((e) => [e.id, e])) });

describe("buildStatusData", () => {
  const a = archive(
    entry("bbb", "2026-01-16"),
    entry("aaa", "2026-01-16", { type: "workshop", title: "Lötabend" }),
    entry("ccc", "2025-06-13", { type: "special", cancelled: true }),
    entry("ddd", "2026-03-06", { cancelled: false }),
    entry("eee", "2025-01-10"), // before STATUS_SINCE
    entry("fff", "2026-02-06", { source: "Datenburg e.V." }), // a friend's calendar
    entry("ggg", "2026-02-13", { type: "party" }), // unknown type
    entry("hhh", "not-a-date"),
    entry("iii", "2026-04-03", { type: "workshop", cancelled: "yes" }) // a truthy non-boolean
  );
  const out = buildStatusData(a);

  it("keeps primary-source events of a known type since STATUS_SINCE, sorted by date then id", () => {
    assert.deepEqual(
      out.events.map((e) => e.id),
      ["ccc", "aaa", "bbb", "ddd", "iii"]
    );
    assert.equal(out.since, STATUS_SINCE);
    assert.equal(out.version, 1);
  });

  it("carries exactly five fields per event — the size guard", () => {
    for (const e of out.events) {
      assert.deepEqual(Object.keys(e).sort(), ["cancelled", "date", "id", "series", "title"]);
    }
    assert.equal(out.events.find((e) => e.id === "aaa").series, "workshop");
    assert.equal(out.events.find((e) => e.id === "aaa").title, "Lötabend");
  });

  it("normalises cancelled to a real boolean (absent, false, truthy junk)", () => {
    const by = Object.fromEntries(out.events.map((e) => [e.id, e.cancelled]));
    assert.deepEqual(by, { ccc: true, aaa: false, bbb: false, ddd: false, iii: false });
  });

  it("lists the series in page order, as a copy", () => {
    assert.deepEqual(out.series, SERIES);
    assert.notEqual(out.series, SERIES);
    assert.notEqual(out.series[0], SERIES[0]);
    assert.deepEqual(out.series.map((s) => s.key), ["linkup", "workshop", "special"]);
  });

  it("survives an empty, malformed or missing archive", () => {
    assert.deepEqual(buildStatusData({}).events, []);
    assert.deepEqual(buildStatusData(null).events, []);
    assert.deepEqual(buildStatusData({ events: { x: null } }).events, []);
  });

  it("carries no timestamp: the same archive yields the same bytes", () => {
    assert.equal(JSON.stringify(buildStatusData(a)), JSON.stringify(buildStatusData(a)));
    assert.equal("generatedAt" in out, false);
  });

  it("stays small: 500 events serialise well under 80 kB", () => {
    const many = archive(...Array.from({ length: 500 }, (_, i) => entry("e" + i, "2025-06-" + String((i % 28) + 1).padStart(2, "0"))));
    const bytes = Buffer.byteLength(JSON.stringify(buildStatusData(many), null, 2));
    assert.ok(bytes < 80_000, `500 events serialise to ${bytes} bytes`);
  });
});

describe("main()", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bc101-status-"));

  it("writes the status data next to a given archive and reports the count", () => {
    const dir = tmp();
    const src = path.join(dir, "events-archive.json");
    const out = path.join(dir, "out", "status-data.json");
    fs.writeFileSync(src, JSON.stringify(archive(entry("a1", "2026-01-16"), entry("a2", "2024-01-01"))));
    const stdout = execFileSync(process.execPath, [SCRIPT, src, out], { encoding: "utf8" });
    assert.match(stdout, /1 event\(s\)/);
    const data = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepEqual(data.events.map((e) => e.id), ["a1"]);
    assert.ok(fs.readFileSync(out, "utf8").endsWith("\n"));
  });

  it("warns and writes nothing when the archive is missing — exit 0, the sync must go on", () => {
    const dir = tmp();
    const out = path.join(dir, "status-data.json");
    const res = spawnSync(process.execPath, [SCRIPT, path.join(dir, "nope.json"), out], { encoding: "utf8" });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /not found/);
    assert.equal(fs.existsSync(out), false);
  });

  it("refuses a corrupt archive loudly rather than publishing an empty timeline", () => {
    const dir = tmp();
    const src = path.join(dir, "events-archive.json");
    const out = path.join(dir, "status-data.json");
    fs.writeFileSync(src, "{oops");
    const res = spawnSync(process.execPath, [SCRIPT, src, out], { encoding: "utf8" });
    assert.notEqual(res.status, 0);
    assert.equal(fs.existsSync(out), false);
  });
});
