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
  SLOT_KEYS,
  MONTHS,
  LIMITS,
  ID_RE,
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
/** A valid permanent-slot entry; each test breaks exactly one field. */
const slot = (over = {}) => ({
  name: "kippdata",
  url: "https://www.kippdata.de",
  ...over,
});
const withSlots = (...slots) => ({ postings: [], karussell: slots });

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

describe("validate — the permanent slot (karussell)", () => {
  it("accepts a board with slots, and one without the key at all", () => {
    assert.deepEqual(validate(withSlots(slot(), slot({ name: "terrasense", url: "https://www.terrasense.de" }))).errors, []);
    assert.deepEqual(validate(board()).errors, []);
  });

  it("accepts the exact boundary length of a name", () => {
    assert.deepEqual(validate(withSlots(slot({ name: "x".repeat(LIMITS.name.maxLength) }))).errors, []);
  });

  const cases = {
    "karussell that is not an array": { postings: [], karussell: { name: "x" } },
    "a slot that is not an object": withSlots("kippdata"),
    "an unknown key on a slot": withSlots(slot({ from: "2026-09-01" })),
    "a slot without a name": withSlots({ url: "https://www.kippdata.de" }),
    "a slot without a url": withSlots({ name: "kippdata" }),
    "a name made only of spaces": withSlots(slot({ name: "   " })),
    "a name over the limit": withSlots(slot({ name: "x".repeat(LIMITS.name.maxLength + 1) })),
    "an http url": withSlots(slot({ url: "http://www.kippdata.de" })),
    "a javascript: url": withSlots(slot({ url: "javascript:alert(1)" })),
  };
  for (const [name, data] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      const errors = errorsFor(data);
      assert.ok(errors.length >= 1, "expected at least one error");
      assert.ok(errors.every((e) => /karussell/.test(e)), errors.join(" | "));
    });
  }

  it("keeps the slot errors apart from the posting errors, by index", () => {
    const errors = errorsFor({ postings: [], karussell: [slot(), slot({ url: "ftp://x" })] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^karussell\[1\]\.url/);
  });

  it("reports slot errors even when postings is missing — one red run, not two", () => {
    const errors = errorsFor({ karussell: [slot({ url: "http://x" })] });
    assert.ok(errors.some((e) => /^karussell\[0\]\.url/.test(e)), errors.join(" | "));
    assert.ok(errors.some((e) => /"postings" fehlt/.test(e)), errors.join(" | "));
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

  it("rejects a company or title made only of spaces", () => {
    // minLength:1 in the schema cannot say "not just whitespace"; the gate can.
    for (const field of ["company", "title"]) {
      const data = board(posting({ [field]: "   " }));
      const errors = errorsFor(data);
      assert.equal(validate(data).ok, false, field);
      assert.ok(
        errors.some((e) => e.includes(`postings[0].${field}: zu kurz`)),
        errors.join(" | ")
      );
    }
  });

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
    // every() on [] is vacuously true — assert there IS an error before asserting
    // about it, or a validate() that stopped reporting would pass this test.
    assert.ok(errors.length > 0, "expected the second entry to be rejected");
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

describe("staleWarnings on data that never validated", () => {
  it("skips what has no usable date instead of throwing", () => {
    // Exported, so a future --probe mode could hand it raw input.
    assert.deepEqual(staleWarnings({ postings: [{ id: "a", months: 1 }] }, "2026-09-15"), []);
    assert.deepEqual(staleWarnings({ postings: [null, "acme", 42] }, "2026-09-15"), []);
    assert.deepEqual(
      staleWarnings({ postings: [{ id: "a", from: 20260901, months: 1 }] }, "2026-09-15"),
      []
    );
    assert.deepEqual(staleWarnings({}, "2026-09-15"), []);
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

  it("SLOT_KEYS matches the schema's slot properties, all of them required", () => {
    assert.deepEqual(sorted(SLOT_KEYS), sorted(Object.keys(SCHEMA.$defs.slot.properties)));
    assert.deepEqual(sorted(SCHEMA.$defs.slot.required), sorted(SLOT_KEYS));
    assert.deepEqual(LIMITS.name, {
      minLength: SCHEMA.$defs.slot.properties.name.minLength,
      maxLength: SCHEMA.$defs.slot.properties.name.maxLength,
    });
    // The two rules the gate enforces by hand: no extra keys, https only. An
    // editor validating against a schema that lost either would go green
    // where CI stays red.
    assert.equal(SCHEMA.$defs.slot.additionalProperties, false);
    assert.equal(SCHEMA.$defs.slot.properties.url.pattern, "^https://");
  });

  it("MONTHS matches the schema's months enum — the price list is stated once", () => {
    assert.deepEqual(MONTHS, SCHEMA.$defs.posting.properties.months.enum);
  });

  it("the runtimes the page offers are exactly MONTHS, in order", () => {
    // Three files name 1/3/12: jobs-core.js (the source), the schema's enum, and
    // the sentence a buyer reads. The lockstep test above covers the first two;
    // this covers the one a company acts on.
    const html = fs.readFileSync(path.join(root, "pinnwand.html"), "utf8");
    const pitch = /<p class="jobs-pitch">([\s\S]*?)<\/p>/.exec(html);
    assert.ok(pitch, 'no <p class="jobs-pitch"> found in pinnwand.html');
    // The WHOLE paragraph, deliberately. An earlier version stopped at the word
    // "Richtwerte" to skip a worked example that has since moved into the
    // how-to — which left everything after that word unscanned, so "Sonderfall:
    // 6 monate ab 220 €" would have passed while the schema refuses a 6.
    const offered = [...pitch[1].matchAll(/(\d+)\s+monate?\b/gi)].map((m) => Number(m[1]));
    assert.deepEqual(offered, MONTHS);
  });

  it("the length limits match the schema a contributor's editor validates against", () => {
    const props = SCHEMA.$defs.posting.properties;
    assert.deepEqual(LIMITS.id, {
      minLength: SCHEMA.$defs.id.minLength,
      maxLength: SCHEMA.$defs.id.maxLength,
    });
    assert.deepEqual(LIMITS.company, {
      minLength: props.company.minLength,
      maxLength: props.company.maxLength,
    });
    assert.deepEqual(LIMITS.title, {
      minLength: props.title.minLength,
      maxLength: props.title.maxLength,
    });
    assert.equal(ID_RE.source, SCHEMA.$defs.id.pattern);
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

  it("the permanent-slot snippet is an entry the gate accepts, too", () => {
    const html = fs.readFileSync(path.join(root, "pinnwand.html"), "utf8");
    const m = /<pre class="jobs-snippet jobs-snippet--slot"><code>([\s\S]*?)<\/code><\/pre>/.exec(html);
    assert.ok(m, 'no <pre class="jobs-snippet jobs-snippet--slot"><code> block found in pinnwand.html');
    const entry = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    const { ok, errors } = validate({ postings: [], karussell: [entry] });
    assert.equal(ok, true, errors.join(" | "));
  });
});

/** Return a copy of `obj` without `key` — a missing required field. */
function omit(obj, key) {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
