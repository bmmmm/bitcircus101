/**
 * Unit tests for scripts/finanz-data.mjs — the pure data layer behind the
 * "Finanz-Steuerzentrale" CLI. Runs with:
 *   node --test tests/finanz-data.spec.mjs
 * No browser, no network. File I/O is exercised against a TEMP copy under
 * os.tmpdir() — the repo's finanz.json / funding.json are never touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  read,
  write,
  validate,
  parseAmount,
  isCalendarDate,
  raiseProject,
  finishProject,
  addEinmalig,
  addMonatlich,
  removeItem,
  setPulse,
  setPercent,
  ROOT_KEYS,
  PULSE_KEYS,
  EINMALIG_KEYS,
  MONATLICH_KEYS,
} from "../scripts/finanz-data.mjs";

// fs.readFileSync accepts a URL directly — the canonical, cross-platform way to
// resolve a sibling file from an ESM module (no __dirname, no pathname juggling).
const SCHEMA = JSON.parse(
  fs.readFileSync(new URL("../finanz.schema.json", import.meta.url), "utf8")
);

const DATE = "2026-06-22";

/** A minimal-but-valid board used as the starting point in most tests. */
function fixture() {
  return {
    currency: "EUR",
    updated: "2026-06-19",
    pulse: { updated: "2026-06-19", levels: [1, 2, 3] },
    einmalig: [
      {
        id: "solar-speicher",
        title: "Solarzellen + Speicher",
        target: 2000,
        raised: 250,
      },
    ],
    monatlich: [{ id: "glasfaser", title: "Schnelleres Internet", monthly: 30 }],
  };
}

describe("validate", () => {
  it("accepts a well-formed board", () => {
    const { ok, errors } = validate(fixture());
    assert.equal(ok, true, errors.join("; "));
    assert.deepEqual(errors, []);
  });

  it("rejects a non-object root", () => {
    assert.equal(validate(null).ok, false);
    assert.equal(validate([]).ok, false);
    assert.equal(validate("x").ok, false);
  });

  it("flags a missing required root field", () => {
    const d = fixture();
    delete d.currency;
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("currency")));
  });

  it("rejects an unknown root key (additionalProperties:false)", () => {
    const d = fixture();
    d.bogus = 1;
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("bogus")));
  });

  it("rejects a currency outside the enum", () => {
    const d = fixture();
    d.currency = "CHF";
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("EUR")));
  });

  it("rejects a malformed updated date", () => {
    const d = fixture();
    d.updated = "22.06.2026";
    assert.equal(validate(d).ok, false);
  });

  it("rejects a well-formed but impossible date (2026-13-99)", () => {
    const d = fixture();
    d.updated = "2026-13-99";
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("gültiges Datum")), errors.join("; "));
    // A real edge date still passes (leap day 2024-02-29).
    const ok2 = fixture();
    ok2.updated = "2024-02-29";
    assert.equal(validate(ok2).ok, true);
  });

  it("rejects a bad id slug", () => {
    const d = fixture();
    d.einmalig[0].id = "Solar Speicher";
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("^[a-z0-9]")));
  });

  it("rejects duplicate ids within a list", () => {
    const d = fixture();
    d.einmalig.push({ id: "solar-speicher", title: "Dup", target: 5, raised: 0 });
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("doppelt")));
  });

  it("rejects target <= 0", () => {
    const d = fixture();
    d.einmalig[0].target = 0;
    assert.equal(validate(d).ok, false);
  });

  it("rejects negative raised", () => {
    const d = fixture();
    d.einmalig[0].raised = -1;
    assert.equal(validate(d).ok, false);
  });

  it("rejects monthly <= 0", () => {
    const d = fixture();
    d.monatlich[0].monthly = 0;
    assert.equal(validate(d).ok, false);
  });

  it("rejects a non-https url1 link", () => {
    const d = fixture();
    d.einmalig[0].url1 = "http://ko-fi.com/x";
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("https://")));
  });

  it("rejects an https URL with whitespace or no host (schema format:uri intent)", () => {
    const spaced = fixture();
    spaced.einmalig[0].url1 = "https://a b c";
    const r1 = validate(spaced);
    assert.equal(r1.ok, false);
    assert.ok(r1.errors.some((e) => e.includes("Leerzeichen")), r1.errors.join("; "));
    // A bare scheme with no host is rejected too.
    const bare = fixture();
    bare.einmalig[0].url2 = "https://";
    assert.equal(validate(bare).ok, false);
    // A normal https URL still passes.
    const okUrl = fixture();
    okUrl.einmalig[0].url1 = "https://ko-fi.com/bitcircus";
    assert.equal(validate(okUrl).ok, true);
  });

  it("rejects a pulse level outside 0..7", () => {
    const d = fixture();
    d.pulse.levels = [0, 8];
    assert.equal(validate(d).ok, false);
  });

  it("rejects a non-integer pulse level", () => {
    const d = fixture();
    d.pulse.levels = [0, 3.5];
    assert.equal(validate(d).ok, false);
  });

  it("rejects a fractional euro amount (integer-only contract)", () => {
    const d = fixture();
    d.einmalig[0].target = 1999.5;
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("ganze Zahl")), errors.join("; "));
  });

  it("rejects a fractional monthly cost", () => {
    const d = fixture();
    d.monatlich[0].monthly = 29.99;
    assert.equal(validate(d).ok, false);
  });

  it("rejects an unknown key inside an einmalig item", () => {
    const d = fixture();
    d.einmalig[0].extra = "nope";
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("extra")));
  });

  // String-length bounds — kept in lockstep with finanz.schema.json so the CLI,
  // the browser editor and the schema all reject the same data.
  it("rejects an empty title (schema minLength 1)", () => {
    const d = fixture();
    d.einmalig[0].title = "";
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("title") && e.includes("kurz")));
  });

  it("rejects an id longer than 48 chars", () => {
    const d = fixture();
    d.einmalig[0].id = "a".repeat(49);
    const { ok, errors } = validate(d);
    assert.equal(ok, false);
    assert.ok(errors.some((e) => e.includes("48")));
  });

  it("rejects an over-long title / tagline / description / icon", () => {
    const tooLong = (d, field, n) => {
      const x = fixture();
      x.einmalig[0][field] = "x".repeat(n);
      return validate(x).ok;
    };
    assert.equal(tooLong(null, "title", 81), false);
    assert.equal(tooLong(null, "tagline", 121), false);
    assert.equal(tooLong(null, "description", 401), false);
    assert.equal(tooLong(null, "icon", 9), false);
  });

  it("still accepts strings at the exact length bounds", () => {
    const d = fixture();
    d.einmalig[0].title = "t".repeat(80);
    d.einmalig[0].icon = "12345678"; // 8
    d.einmalig[0].id = "a".repeat(48);
    const { ok, errors } = validate(d);
    assert.equal(ok, true, errors.join("; "));
  });
});

describe("raiseProject", () => {
  it("adds to raised and bumps updated", () => {
    const next = raiseProject(fixture(), "solar-speicher", 100, DATE);
    assert.equal(next.einmalig[0].raised, 350);
    assert.equal(next.updated, DATE);
  });

  it("floors raised at 0 for a large negative amount", () => {
    const next = raiseProject(fixture(), "solar-speicher", -9999, DATE);
    assert.equal(next.einmalig[0].raised, 0);
  });

  it("does not mutate the input", () => {
    const d = fixture();
    raiseProject(d, "solar-speicher", 100, DATE);
    assert.equal(d.einmalig[0].raised, 250);
    assert.equal(d.updated, "2026-06-19");
  });

  it("throws an actionable error for an unknown id", () => {
    assert.throws(() => raiseProject(fixture(), "nope", 10, DATE), /nope/);
  });

  it("rejects a non-numeric amount", () => {
    assert.throws(() => raiseProject(fixture(), "solar-speicher", "x", DATE));
  });

  it("rejects a fractional amount so no IEEE-754 float total is persisted", () => {
    // The integer contract means a fractional raise can never accumulate a
    // 0.30000000000000004-style total — it is refused with the integer message.
    assert.throws(
      () => raiseProject(fixture(), "solar-speicher", 0.1, DATE),
      /ganze Zahl/
    );
  });
});

describe("finishProject", () => {
  it("sets raised to target", () => {
    const next = finishProject(fixture(), "solar-speicher", DATE);
    assert.equal(next.einmalig[0].raised, 2000);
    assert.equal(next.einmalig[0].target, 2000);
    assert.equal(next.updated, DATE);
  });

  it("throws for an unknown id", () => {
    assert.throws(() => finishProject(fixture(), "nope", DATE), /nope/);
  });
});

describe("addEinmalig", () => {
  it("appends a valid new project", () => {
    const next = addEinmalig(
      fixture(),
      { id: "werkbank", title: "Neue Werkbank", target: 500, raised: 0 },
      DATE
    );
    assert.equal(next.einmalig.length, 2);
    assert.equal(next.einmalig[1].id, "werkbank");
    assert.equal(next.updated, DATE);
  });

  it("rejects a duplicate id", () => {
    assert.throws(
      () =>
        addEinmalig(
          fixture(),
          { id: "solar-speicher", title: "Dup", target: 5, raised: 0 },
          DATE
        ),
      /doppelt/
    );
  });

  it("rejects a bad id slug", () => {
    assert.throws(
      () =>
        addEinmalig(
          fixture(),
          { id: "Bad Slug", title: "X", target: 5, raised: 0 },
          DATE
        ),
      /\^\[a-z0-9\]/
    );
  });

  it("rejects a missing target", () => {
    assert.throws(() =>
      addEinmalig(fixture(), { id: "x", title: "X", raised: 0 }, DATE)
    );
  });

  it("rejects a zero target", () => {
    assert.throws(() =>
      addEinmalig(fixture(), { id: "x", title: "X", target: 0, raised: 0 }, DATE)
    );
  });
});

describe("addMonatlich", () => {
  it("appends a valid recurring cost", () => {
    const next = addMonatlich(
      fixture(),
      { id: "strom", title: "Strom", monthly: 80 },
      DATE
    );
    assert.equal(next.monatlich.length, 2);
    assert.equal(next.monatlich[1].id, "strom");
  });

  it("rejects a missing monthly", () => {
    assert.throws(() =>
      addMonatlich(fixture(), { id: "strom", title: "Strom" }, DATE)
    );
  });
});

describe("removeItem", () => {
  it("removes a one-time project", () => {
    const next = removeItem(fixture(), "solar-speicher", DATE);
    assert.equal(next.einmalig.length, 0);
    assert.equal(next.updated, DATE);
  });

  it("removes a monthly cost", () => {
    const next = removeItem(fixture(), "glasfaser", DATE);
    assert.equal(next.monatlich.length, 0);
  });

  it("throws for an unknown id", () => {
    assert.throws(() => removeItem(fixture(), "ghost", DATE), /ghost/);
  });
});

describe("setPulse", () => {
  it("appends a clamped level and stamps both updated fields", () => {
    const next = setPulse(fixture(), 5, DATE);
    assert.deepEqual(next.pulse.levels, [1, 2, 3, 5]);
    assert.equal(next.pulse.updated, DATE);
    assert.equal(next.updated, DATE);
  });

  it("clamps an out-of-range level to 0..7", () => {
    const next = setPulse(fixture(), 99, DATE);
    assert.equal(next.pulse.levels[next.pulse.levels.length - 1], 7);
  });

  it("seeds the track when no pulse exists yet", () => {
    const d = fixture();
    delete d.pulse;
    const next = setPulse(d, 4, DATE);
    assert.deepEqual(next.pulse.levels, [4]);
  });

  it("never stores a euro amount — only integer levels", () => {
    const next = setPulse(fixture(), 3, DATE);
    assert.ok(next.pulse.levels.every((l) => Number.isInteger(l) && l >= 0 && l <= 7));
  });

  it("caps the stored track at 64 (schema maxItems), not the renderer's 24", () => {
    let d = fixture();
    d.pulse.levels = [];
    for (let i = 0; i < 80; i++) d = setPulse(d, i % 8, DATE);
    assert.equal(d.pulse.levels.length, 64);
  });
});

describe("read / write (atomic, temp copy)", () => {
  let tmpFile;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finanz-data-"));
    tmpFile = path.join(dir, "finanz.json");
    write(fixture(), tmpFile);
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    } catch {}
  });

  it("round-trips through write + read", () => {
    const back = read(tmpFile);
    assert.equal(back.einmalig[0].id, "solar-speicher");
  });

  it("writes 2-space indent and a single trailing newline", () => {
    const text = fs.readFileSync(tmpFile, "utf8");
    assert.ok(text.endsWith("}\n"));
    assert.ok(text.includes('\n  "currency"'));
  });

  it("leaves no temp file behind", () => {
    const leftovers = fs
      .readdirSync(path.dirname(tmpFile))
      .filter((n) => n.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
  });
});

describe("setPercent (funding.json, temp copy)", () => {
  let tmpFile;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finanz-pct-"));
    tmpFile = path.join(dir, "funding.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    } catch {}
  });

  it("clamps to 0..100 and rounds to an integer", () => {
    assert.equal(setPercent(150, tmpFile), 100);
    assert.equal(setPercent(-20, tmpFile), 0);
    assert.equal(setPercent(42.6, tmpFile), 43);
  });

  it("writes the canonical { \"percent\": n } single-line shape", () => {
    setPercent(55, tmpFile);
    assert.equal(fs.readFileSync(tmpFile, "utf8"), '{ "percent": 55 }\n');
  });

  it("rejects a non-numeric percent", () => {
    assert.throws(() => setPercent("abc", tmpFile));
  });
});

describe("parseAmount (shared CLI input parser)", () => {
  it("accepts plain and signed decimals", () => {
    assert.equal(parseAmount("100"), 100);
    assert.equal(parseAmount("-50"), -50);
    assert.equal(parseAmount("  42 "), 42);
    assert.equal(parseAmount("100.5"), 100.5);
  });

  it("accepts a German comma decimal (then the integer gate catches cents)", () => {
    assert.equal(parseAmount("100,50"), 100.5);
    assert.equal(parseAmount("0,5"), 0.5);
  });

  it("returns null (not 0) for empty/whitespace — no silent coercion", () => {
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount("   "), null);
    assert.equal(parseAmount(undefined), null);
    assert.equal(parseAmount(null), null);
  });

  it("rejects hex, scientific notation and stray text", () => {
    assert.equal(parseAmount("0x10"), null);
    assert.equal(parseAmount("1e3"), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parseAmount("https://x"), null);
  });

  it("rejects thousands-grouped input instead of silently misreading it as 1", () => {
    // "1.000"/"1,000" must NOT parse to 1 — a separator may carry at most two
    // cent digits, so a grouped thousand is refused rather than read as 1 €.
    assert.equal(parseAmount("1.000"), null);
    assert.equal(parseAmount("1,000"), null);
    assert.equal(parseAmount("12.345"), null);
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates including a leap day", () => {
    assert.equal(isCalendarDate("2026-06-22"), true);
    assert.equal(isCalendarDate("2024-02-29"), true);
  });
  it("rejects impossible or malformed dates", () => {
    assert.equal(isCalendarDate("2026-13-99"), false);
    assert.equal(isCalendarDate("2026-02-30"), false);
    assert.equal(isCalendarDate("2023-02-29"), false); // 2023 is not a leap year
    assert.equal(isCalendarDate("22.06.2026"), false);
    assert.equal(isCalendarDate(""), false);
  });
});

describe("schema/CLI lockstep (the hand-maintained mirror must match finanz.schema.json)", () => {
  const sorted = (a) => [...a].sort();
  it("ROOT_KEYS matches the schema's root properties", () => {
    assert.deepEqual(sorted(ROOT_KEYS), sorted(Object.keys(SCHEMA.properties)));
  });
  it("PULSE_KEYS matches the schema's pulse properties", () => {
    assert.deepEqual(
      sorted(PULSE_KEYS),
      sorted(Object.keys(SCHEMA.properties.pulse.properties))
    );
  });
  it("EINMALIG_KEYS matches the schema's einmaligItem properties", () => {
    assert.deepEqual(
      sorted(EINMALIG_KEYS),
      sorted(Object.keys(SCHEMA.$defs.einmaligItem.properties))
    );
  });
  it("MONATLICH_KEYS matches the schema's monatlichItem properties", () => {
    assert.deepEqual(
      sorted(MONATLICH_KEYS),
      sorted(Object.keys(SCHEMA.$defs.monatlichItem.properties))
    );
  });
});
