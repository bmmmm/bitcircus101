/**
 * Unit tests for scripts/check-jobs.mjs — the offline gate behind jobs.json.
 * Runs with: node --test tests/jobs-data.spec.mjs
 *
 * No browser, no network, no clock: validate() is pure and staleWarnings() takes
 * `today` in. The repo's own jobs.json is read but never written.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validate,
  staleWarnings,
  ROOT_KEYS,
  POSTING_KEYS,
  MONTHS,
  JOBS_PATH,
} from "../scripts/check-jobs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(root, "jobs.schema.json"), "utf8")
);

/** A valid posting; each test breaks exactly one field. */
const posting = (over = {}) => ({
  id: "acme-2026-09",
  company: "ACME GmbH",
  title: "Embedded-Entwickler:in (m/w/d), Bonn oder remote",
  url: "https://acme.example/jobs/embedded",
  from: "2026-09-03",
  months: 3,
  ...over,
});
const board = (...postings) => ({ postings });
const errorsFor = (data) => validate(data).errors;

describe("validate — the shapes that pass", () => {
  it("accepts an empty board and a full posting", () => {
    assert.deepEqual(validate({ postings: [] }), { ok: true, errors: [] });
    assert.equal(validate(board(posting())).ok, true);
  });

  it("accepts the exact boundary lengths", () => {
    assert.equal(
      validate(
        board(
          posting({
            id: "a".repeat(48),
            company: "c".repeat(60),
            title: "t".repeat(100),
          })
        )
      ).ok,
      true
    );
  });

  it("accepts every sold duration", () => {
    for (const months of MONTHS) {
      assert.equal(validate(board(posting({ months }))).ok, true, `months=${months}`);
    }
  });
});

describe("validate — one error class per case, each naming its field", () => {
  const cases = [
    ["root is not an object", [], "muss ein JSON-Objekt sein"],
    ["unknown root key", { postings: [], updated: "2026-09-03" }, 'unbekannter Schlüssel "updated"'],
    ["postings missing", {}, 'Pflichtfeld "postings" fehlt'],
    ["postings not an array", { postings: {} }, "muss ein Array sein"],
    ["entry not an object", board("acme"), "postings[0]: muss ein Objekt sein"],
    ["unknown entry key", board(posting({ tags: ["a"] })), 'unbekannter Schlüssel "tags"'],
    ["id missing", board(omit(posting(), "id")), 'postings[0]: Pflichtfeld "id" fehlt'],
    ["id not a slug", board(posting({ id: "ACME GmbH" })), "postings[0].id:"],
    ["id too long", board(posting({ id: "a".repeat(49) })), "höchstens 48 Zeichen"],
    ["company missing", board(omit(posting(), "company")), 'Pflichtfeld "company" fehlt'],
    ["company empty", board(posting({ company: "" })), "postings[0].company: zu kurz"],
    ["company too long", board(posting({ company: "c".repeat(61) })), "postings[0].company: zu lang"],
    ["title missing", board(omit(posting(), "title")), 'Pflichtfeld "title" fehlt'],
    ["title too long", board(posting({ title: "t".repeat(101) })), "postings[0].title: zu lang"],
    ["title wrong type", board(posting({ title: 42 })), "postings[0].title: muss ein String sein"],
    ["url missing", board(omit(posting(), "url")), 'Pflichtfeld "url" fehlt'],
    ["url not https", board(posting({ url: "http://acme.example/j" })), 'muss mit "https://" beginnen'],
    ["url without host", board(posting({ url: "https://" })), "postings[0].url: keine gültige URL"],
    ["url with whitespace", board(posting({ url: "https://a b.example" })), "postings[0].url: keine gültige URL"],
    ["from missing", board(omit(posting(), "from")), 'Pflichtfeld "from" fehlt'],
    ["from not a calendar day", board(posting({ from: "2026-02-30" })), "postings[0].from: kein gültiges Kalenderdatum"],
    ["from German-formatted", board(posting({ from: "03.09.2026" })), "postings[0].from: kein gültiges Kalenderdatum"],
    ["months missing", board(omit(posting(), "months")), 'Pflichtfeld "months" fehlt'],
    ["months not sold", board(posting({ months: 2 })), "postings[0].months: muss 1, 3, 12 sein"],
    ["months not an integer", board(posting({ months: 1.5 })), "postings[0].months: muss eine ganze Zahl sein"],
    ["months as a string", board(posting({ months: "3" })), "postings[0].months: muss eine ganze Zahl sein"],
  ];

  for (const [name, data, needle] of cases) {
    it(`rejects: ${name}`, () => {
      const errors = errorsFor(data);
      assert.equal(validate(data).ok, false, `expected ${name} to fail`);
      assert.ok(
        errors.some((e) => e.includes(needle)),
        `no error mentioned "${needle}" — got: ${errors.join(" | ")}`
      );
    });
  }

  it("rejects a duplicate id and names it", () => {
    const data = board(posting(), posting({ from: "2026-10-01" }));
    const errors = errorsFor(data);
    assert.equal(validate(data).ok, false);
    assert.ok(
      errors.some((e) => e.includes('postings[1].id: "acme-2026-09" ist doppelt')),
      errors.join(" | ")
    );
  });

  it("reports the index of the offending entry, not just the first", () => {
    const errors = errorsFor(board(posting(), posting({ id: "b", months: 5 })));
    assert.ok(errors.every((e) => e.startsWith("postings[1]")), errors.join(" | "));
  });
});

describe("staleWarnings — housekeeping only, never an error", () => {
  it("warns about an expired posting while validate() still says ok", () => {
    const data = board(posting({ from: "2026-01-01", months: 1 }));
    assert.equal(validate(data).ok, true);
    const warnings = staleWarnings(data, "2026-09-15");
    assert.equal(warnings.length, 1);
    assert.ok(
      warnings[0].includes("ist seit 2026-01-31 abgelaufen"),
      warnings[0]
    );
  });

  it("stays quiet on its last day and warns the day after", () => {
    const data = board(posting({ from: "2026-09-01", months: 1 }));
    assert.deepEqual(staleWarnings(data, "2026-09-30"), []);
    assert.equal(staleWarnings(data, "2026-10-01").length, 1);
  });

  it("warns about a start more than 31 days out (a typo'd year)", () => {
    const data = board(posting({ from: "2027-09-03" }));
    const warnings = staleWarnings(data, "2026-09-15");
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("Jahreszahl prüfen"), warnings[0]);
    // Exactly 31 days out is still normal lead time.
    assert.deepEqual(
      staleWarnings(board(posting({ from: "2026-10-16" })), "2026-09-15"),
      []
    );
  });
});

describe("schema/gate lockstep (the hand-maintained mirror must match jobs.schema.json)", () => {
  const sorted = (a) => [...a].sort();

  it("ROOT_KEYS matches the schema's root properties", () => {
    assert.deepEqual(sorted(ROOT_KEYS), sorted(Object.keys(SCHEMA.properties)));
  });

  it("POSTING_KEYS matches the schema's posting properties", () => {
    assert.deepEqual(
      sorted(POSTING_KEYS),
      sorted(Object.keys(SCHEMA.$defs.posting.properties))
    );
  });

  it("every posting field is required — there are no optional ones", () => {
    assert.deepEqual(sorted(SCHEMA.$defs.posting.required), sorted(POSTING_KEYS));
  });

  it("MONTHS matches the schema's months enum — the price list is stated once", () => {
    assert.deepEqual(MONTHS, SCHEMA.$defs.posting.properties.months.enum);
  });
});

describe("the committed jobs.json", () => {
  it("validates", () => {
    const data = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));
    const { ok, errors } = validate(data);
    assert.equal(ok, true, errors.join(" | "));
  });
});

describe("the copy-paste snippet on pinnwand.html", () => {
  it("is a posting the gate accepts — the instructions cannot drift from the rules", () => {
    const html = fs.readFileSync(path.join(root, "pinnwand.html"), "utf8");
    const m = /<pre class="jobs-snippet"><code>([\s\S]*?)<\/code><\/pre>/.exec(html);
    assert.ok(m, "no <pre class=\"jobs-snippet\"><code> block found in pinnwand.html");
    const json = m[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&"); // last: an escaped &amp;lt; must not become "<"
    const entry = JSON.parse(json);
    const { ok, errors } = validate({ postings: [entry] });
    assert.equal(ok, true, errors.join(" | "));
  });
});

/** Return a copy of `obj` without `key` — a missing required field. */
function omit(obj, key) {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
