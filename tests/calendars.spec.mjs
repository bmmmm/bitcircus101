/**
 * Unit tests for the calendar source manifest: loadCalendars() (sync-events.mjs)
 * and validateCalendars() (check-calendars.mjs).
 *
 * Runs with: node --test tests/calendars.spec.mjs
 *
 * Every case builds a real fixture directory on disk — the loader and the validator
 * both read the filesystem, so mocking would only test the mock. No network.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCalendars } from "../scripts/sync-events.mjs";
import { validateCalendars, suggestId } from "../scripts/check-calendars.mjs";

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), "bc101-cal-"));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
});

let seq = 0;

/**
 * Build a calendars/ fixture. `files` maps a path relative to the dir to either an
 * object (written as JSON) or a string (written raw, for malformed-JSON cases).
 * `sources` becomes the manifest's source list. Returns the directory path.
 */
function fixture(files, sources) {
  const dir = join(root, `case-${seq++}`);
  mkdirSync(join(dir, "external"), { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ sources: sources ?? Object.keys(files) }, null, 2)
  );
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(
      join(dir, rel),
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return dir;
}

/** A source file that passes every rule; spread-override one field per test. */
const valid = (over = {}) => ({
  id: "example",
  name: "Example Space",
  ics: "https://example.org/cal.ics",
  url: "https://example.org/",
  rss: false,
  ...over,
});

/** Assert that at least one error mentions `needle`; show all errors when it doesn't. */
function assertError(result, needle) {
  assert.ok(
    result.errors.some((e) => e.includes(needle)),
    `expected an error mentioning ${JSON.stringify(needle)}, got: ${JSON.stringify(result.errors)}`
  );
}
function assertWarning(result, needle) {
  assert.ok(
    result.warnings.some((w) => w.includes(needle)),
    `expected a warning mentioning ${JSON.stringify(needle)}, got: ${JSON.stringify(result.warnings)}`
  );
}

// ── loadCalendars ────────────────────────────────────────────────────────────

describe("loadCalendars", () => {
  it("loads sources in manifest order (order drives dedupe priority)", () => {
    const dir = fixture(
      {
        "b.json": valid({ id: "b", name: "B" }),
        "a.json": valid({ id: "a", name: "A" }),
        "external/c.json": valid({ id: "c", name: "C" }),
      },
      ["b.json", "a.json", "external/c.json"]
    );
    assert.deepEqual(loadCalendars(dir).map((c) => c.id), ["b", "a", "c"]);
  });

  it("ignores files that exist but are not listed in the manifest", () => {
    const dir = fixture(
      { "a.json": valid({ id: "a", name: "A" }), "orphan.json": valid({ id: "orphan", name: "O" }) },
      ["a.json"]
    );
    assert.deepEqual(loadCalendars(dir).map((c) => c.id), ["a"]);
  });

  it("skips entries without id or ics instead of throwing", () => {
    const dir = fixture(
      {
        "noid.json": { name: "No id", ics: "https://example.org/c.ics" },
        "noics.json": { id: "noics", name: "No ics" },
        "ok.json": valid({ id: "ok", name: "OK" }),
      },
      ["noid.json", "noics.json", "ok.json"]
    );
    assert.deepEqual(loadCalendars(dir).map((c) => c.id), ["ok"]);
  });

  it("skips a malformed or missing file without taking the others down", () => {
    const dir = fixture(
      { "broken.json": "{ not json", "ok.json": valid({ id: "ok", name: "OK" }) },
      ["broken.json", "gone.json", "ok.json"]
    );
    assert.deepEqual(loadCalendars(dir).map((c) => c.id), ["ok"]);
  });
});

// ── validateCalendars: the happy path ────────────────────────────────────────

describe("validateCalendars — accepts valid setups", () => {
  it("passes a minimal source and every optional key", () => {
    const dir = fixture(
      {
        "a.json": valid({ id: "a", name: "A" }),
        "external/b.json": {
          _note: "underscore keys are free-form comments",
          id: "b",
          name: "B",
          type: "ics-filtered",
          ics: "https://example.org/b.ics",
          url: "https://example.org/b",
          eventUrl: "https://example.org/b/programm",
          rss: true,
          cap: 5,
          tags: ["#b", "#theater"],
          filter: { categoryAllow: ["Public"], titleDeny: ["intern"] },
        },
      },
      ["a.json", "external/b.json"]
    );
    const r = validateCalendars(dir);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.sources.length, 2);
  });

  it("accepts every documented type", () => {
    for (const type of ["ics-full", "ics-single", "ics-filtered"]) {
      const dir = fixture({ "a.json": valid({ type }) }, ["a.json"]);
      assert.deepEqual(validateCalendars(dir).errors, [], `type ${type} should be valid`);
    }
  });

  it("validates the repo's own calendars/ directory", () => {
    // The real thing — this is what CI gates on.
    const r = validateCalendars("calendars");
    assert.deepEqual(r.errors, []);
    assert.ok(r.sources.length > 0, "expected at least one configured source");
  });
});

// ── validateCalendars: the silent failures it exists to catch ────────────────

describe("validateCalendars — manifest problems", () => {
  it("errors when the manifest lists a file that does not exist", () => {
    const dir = fixture({ "a.json": valid() }, ["a.json", "ghost.json"]);
    assertError(validateCalendars(dir), "does not exist");
  });

  it("errors on a malformed source file", () => {
    const dir = fixture({ "a.json": "{ nope" }, ["a.json"]);
    assert.ok(validateCalendars(dir).errors.length > 0);
  });

  it("errors on a malformed config.json", () => {
    const dir = fixture({ "a.json": valid() }, ["a.json"]);
    writeFileSync(join(dir, "config.json"), "{ broken");
    assertError(validateCalendars(dir), "config.json");
  });

  it("errors when sources is not an array", () => {
    const dir = fixture({ "a.json": valid() }, ["a.json"]);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ sources: "a.json" }));
    assertError(validateCalendars(dir), '"sources" must be an array');
  });

  it("errors when the same file is listed twice", () => {
    const dir = fixture({ "a.json": valid() }, ["a.json", "a.json"]);
    assertError(validateCalendars(dir), "listed twice");
  });

  it("warns — does not error — on an unlisted orphan file", () => {
    // Parking a source by removing its manifest line is a documented feature, so this
    // must stay a warning; the message has to name the fix.
    const dir = fixture(
      { "a.json": valid({ id: "a", name: "A" }), "external/parked.json": valid({ id: "p", name: "P" }) },
      ["a.json"]
    );
    const r = validateCalendars(dir);
    assert.deepEqual(r.errors, []);
    assertWarning(r, "external/parked.json");
    assertWarning(r, "NOT synced");
  });

  it("warns on an empty source list", () => {
    const dir = fixture({}, []);
    assertWarning(validateCalendars(dir), "no events");
  });
});

describe("validateCalendars — source field problems", () => {
  const cases = [
    ["unknown top-level key (icsUrl typo)", valid({ icsUrl: "https://x/y.ics" }), 'unknown key "icsUrl"'],
    ["missing id", { name: "A", ics: "https://example.org/c.ics" }, 'missing or empty "id"'],
    ["missing name", { id: "a", ics: "https://example.org/c.ics" }, 'missing or empty "name"'],
    ["missing ics", { id: "a", name: "A" }, 'missing or empty "ics"'],
    ["empty id", valid({ id: "   " }), 'missing or empty "id"'],
    ["non-kebab id", valid({ id: "My Cal" }), "kebab-case"],
    ["non-URL ics", valid({ ics: "example.org/cal.ics" }), '"ics" must be an http(s) URL'],
    ["non-URL eventUrl", valid({ eventUrl: "nope" }), '"eventUrl" must be an http(s) URL'],
    ["unknown type", valid({ type: "ics-filter" }), 'unknown "type"'],
    ["non-boolean rss", valid({ rss: "true" }), '"rss" must be true or false'],
    ["zero cap", valid({ cap: 0 }), '"cap" must be a positive integer'],
    ["non-integer cap", valid({ cap: 2.5 }), '"cap" must be a positive integer'],
    ["tags not an array", valid({ tags: "#a" }), '"tags" must be an array'],
    ["tag without hash", valid({ tags: ["#ok", "nope"] }), 'must start with "#"'],
    ["filter not an object", valid({ type: "ics-filtered", filter: [] }), '"filter" must be an object'],
    [
      "misspelled filter key",
      valid({ type: "ics-filtered", filter: { categoryAllowed: ["X"] } }),
      'unknown filter key "categoryAllowed"',
    ],
    [
      "filter rule not an array",
      valid({ type: "ics-filtered", filter: { titleDeny: "intern" } }),
      "filter.titleDeny must be a non-empty array",
    ],
    ["source file is an array", [], "not a JSON object"],
  ];

  for (const [label, entry, needle] of cases) {
    it(`errors on ${label}`, () => {
      const dir = fixture({ "a.json": entry }, ["a.json"]);
      assertError(validateCalendars(dir), needle);
    });
  }

  it("warns when a filter is set but the type does not say so", () => {
    const dir = fixture({ "a.json": valid({ filter: { titleDeny: ["intern"] } }) }, ["a.json"]);
    const r = validateCalendars(dir);
    assert.deepEqual(r.errors, []);
    assertWarning(r, "ics-filtered");
  });

  it("accepts underscore-prefixed comment keys", () => {
    const dir = fixture({ "a.json": valid({ _note: "why this source exists" }) }, ["a.json"]);
    assert.deepEqual(validateCalendars(dir).errors, []);
  });
});

describe("validateCalendars — collisions", () => {
  it("errors on a duplicate id", () => {
    const dir = fixture(
      { "a.json": valid({ id: "same", name: "A" }), "b.json": valid({ id: "same", name: "B" }) },
      ["a.json", "b.json"]
    );
    assertError(validateCalendars(dir), 'duplicate "id"');
  });

  it("errors on a duplicate name", () => {
    // name keys icsKeys, the RSS source filter and the stale-cache lookup in
    // sync-events.mjs — two sources sharing one silently cross-contaminate.
    const dir = fixture(
      { "a.json": valid({ id: "a", name: "Same" }), "b.json": valid({ id: "b", name: "Same" }) },
      ["a.json", "b.json"]
    );
    assertError(validateCalendars(dir), 'duplicate "name"');
  });
});

// ── suggestId (probe mode's paste-ready snippet) ─────────────────────────────

describe("suggestId", () => {
  it("uses the label before the TLD, not the hosting subdomain", () => {
    assert.equal(suggestId("https://cloud.datenb.org/remote.php/dav/x?export"), "datenb");
    assert.equal(suggestId("https://nc.6bm.de/remote.php/dav/y"), "6bm");
    assert.equal(suggestId("https://kult41.de/events/foo/ical/"), "kult41");
    assert.equal(suggestId("https://www.example.com/cal.ics"), "example");
  });

  it("steps past a generic second-level domain", () => {
    assert.equal(suggestId("https://calendar.example.co.uk/x.ics"), "example");
  });

  it("falls back instead of throwing on an unparseable URL", () => {
    assert.equal(suggestId("not a url"), "new-source");
  });

  it("falls back for hosts that name no org (bare IP, localhost)", () => {
    // A real probe against a local fixture server produced the id "0" before this.
    assert.equal(suggestId("http://127.0.0.1:8099/friend.ics"), "new-source");
    assert.equal(suggestId("http://192.168.1.20/cal.ics"), "new-source");
    assert.equal(suggestId("http://localhost:8080/cal.ics"), "localhost");
  });

  it("always suggests an id the validator accepts", () => {
    for (const url of [
      "https://cloud.datenb.org/x",
      "https://nc.6bm.de/y",
      "https://kult41.de/z",
      "not a url",
    ]) {
      const id = suggestId(url);
      const dir = fixture({ "a.json": valid({ id }) }, ["a.json"]);
      assert.deepEqual(validateCalendars(dir).errors, [], `suggested id ${id} must validate`);
    }
  });
});
