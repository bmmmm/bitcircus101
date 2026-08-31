/**
 * Unit tests for finanz-core.js — cost/funding math for the one-time
 * (`einmalig`) items shown on support.html#projekte. Runs with:
 *   node --test tests/finanz-core.spec.mjs
 * Pure functions, no DOM, no network. Recurring monthly costs carry no target
 * and never pass through here, so they are intentionally out of scope.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import FinanzCore from "../finanz-core.js";

const {
  rawPercent,
  asciiBar,
  formatAmount,
  computeProject,
  donateTarget,
  BAR_WIDTH,
  PULSE_MAX,
  pulseLevel,
  pulseGlyph,
  pulseSparkline,
  pushPulse,
  isCalendarDate,
  isCleanHttpsUrl,
} = FinanzCore;

describe("rawPercent", () => {
  it("computes the ratio in percent", () => {
    assert.equal(rawPercent(50, 200), 25);
  });
  it("returns 0 for a zero or negative target (no divide-by-zero)", () => {
    assert.equal(rawPercent(50, 0), 0);
    assert.equal(rawPercent(50, -10), 0);
  });
  it("can exceed 100 when over-funded", () => {
    assert.equal(rawPercent(300, 200), 150);
  });
  it("floors a negative raised at 0", () => {
    assert.equal(rawPercent(-50, 200), 0);
  });
});

describe("asciiBar", () => {
  it("fills proportionally and pads the rest", () => {
    const b = asciiBar(50, 20);
    assert.equal(b.filledCount, 10);
    assert.equal(b.filled.length, 10);
    assert.equal(b.empty.length, 10);
    assert.equal(b.filled.length + b.empty.length, 20);
  });
  it("clamps over-funding to a full bar", () => {
    const b = asciiBar(150, 20);
    assert.equal(b.filledCount, 20);
    assert.equal(b.empty.length, 0);
  });
  it("renders an empty bar at 0%", () => {
    const b = asciiBar(0, 20);
    assert.equal(b.filledCount, 0);
    assert.equal(b.filled, "");
    assert.equal(b.empty.length, 20);
  });
  it("defaults to BAR_WIDTH when no width is given", () => {
    const b = asciiBar(100);
    assert.equal(b.width, BAR_WIDTH);
    assert.equal(b.filledCount, BAR_WIDTH);
  });
  it("uses the block / light-shade characters", () => {
    const b = asciiBar(50, 2);
    assert.equal(b.filled, "█");
    assert.equal(b.empty, "░");
  });
});

describe("formatAmount", () => {
  it("groups thousands and appends the euro symbol", () => {
    assert.equal(formatAmount(1450, "EUR"), "1.450 €");
  });
  it("handles small amounts and zero", () => {
    assert.equal(formatAmount(0, "EUR"), "0 €");
    assert.equal(formatAmount(145, "EUR"), "145 €");
  });
  it("rounds to whole units", () => {
    assert.equal(formatAmount(99.6, "EUR"), "100 €");
  });
  it("falls back to the euro symbol for an unknown currency", () => {
    assert.equal(formatAmount(5, "XYZ"), "5 €");
  });
});

describe("computeProject", () => {
  it("derives pct, reached, remaining and a bar", () => {
    const p = computeProject({ id: "x", title: "X", raised: 145, target: 800 });
    assert.equal(p.pct, 18); // 145/800 = 18.1 -> 18
    assert.equal(p.reached, false);
    assert.equal(p.remaining, 655);
    assert.equal(p.bar.width, BAR_WIDTH);
  });
  it("marks a project reached at exactly the target", () => {
    const p = computeProject({ raised: 200, target: 200 });
    assert.equal(p.reached, true);
    assert.equal(p.pct, 100);
    assert.equal(p.remaining, 0);
  });
  it("clamps the bar but keeps rawPct when over-funded", () => {
    const p = computeProject({ raised: 1000, target: 800 });
    assert.equal(p.pct, 100);
    assert.equal(p.rawPct, 125);
    assert.equal(p.bar.filledCount, BAR_WIDTH);
  });
  it("never divides by zero on a missing target (e.g. a monthly item shape)", () => {
    const p = computeProject({ raised: 50, target: 0 });
    assert.equal(p.pct, 0);
    assert.equal(p.reached, false);
    assert.equal(p.remaining, 0);
  });
  it("floors a negative raised at 0", () => {
    const p = computeProject({ raised: -5, target: 100 });
    assert.equal(p.raised, 0);
    assert.equal(p.pct, 0);
  });
});

describe("donateTarget", () => {
  it("links to a project's own Ko-fi page externally when it has one", () => {
    const t = donateTarget({ kofi: "https://ko-fi.com/s/abc123" });
    assert.equal(t.href, "https://ko-fi.com/s/abc123");
    assert.equal(t.external, true);
  });
  it("stays on-site (#dauerhaft) when the project has no own Ko-fi page", () => {
    const t = donateTarget({ id: "solar", title: "Solar" });
    assert.equal(t.href, "#dauerhaft");
    assert.equal(t.external, false);
  });
  it("is internal for an empty or missing item", () => {
    assert.equal(donateTarget({}).external, false);
    assert.equal(donateTarget(null).href, "#dauerhaft");
  });
});

describe("pulseLevel", () => {
  it("buckets a value into 0..PULSE_MAX against a scale", () => {
    assert.equal(pulseLevel(0, 100), 0);
    assert.equal(pulseLevel(100, 100), PULSE_MAX);
    assert.equal(pulseLevel(50, 100), Math.round(0.5 * PULSE_MAX)); // 4
  });
  it("returns 0 for a zero or negative scale (no divide-by-zero)", () => {
    assert.equal(pulseLevel(50, 0), 0);
    assert.equal(pulseLevel(50, -10), 0);
  });
  it("clamps over-scale and negative values into range", () => {
    assert.equal(pulseLevel(999, 100), PULSE_MAX);
    assert.equal(pulseLevel(-5, 100), 0);
  });
});

describe("pulseGlyph", () => {
  it("maps a level to its block glyph", () => {
    assert.equal(pulseGlyph(0), "▁");
    assert.equal(pulseGlyph(PULSE_MAX), "█");
  });
  it("clamps out-of-range levels", () => {
    assert.equal(pulseGlyph(99), "█");
    assert.equal(pulseGlyph(-3), "▁");
  });
  it("falls back to the baseline glyph for a non-number", () => {
    assert.equal(pulseGlyph("x"), "▁");
  });
});

describe("pulseSparkline", () => {
  it("renders each level as a glyph", () => {
    assert.equal(pulseSparkline([0, PULSE_MAX, 0]), "▁█▁");
  });
  it("returns an empty string for a non-array", () => {
    assert.equal(pulseSparkline(null), "");
    assert.equal(pulseSparkline(undefined), "");
  });
  it("never leaks an exact euro amount — output is glyphs only", () => {
    const out = pulseSparkline([1, 2, 3, 4]);
    assert.match(out, /^[▁▂▃▄▅▆▇█]+$/u);
  });
});

describe("pushPulse", () => {
  it("appends a clamped level without mutating the input", () => {
    const src = [1, 2, 3];
    const next = pushPulse(src, 9);
    assert.deepEqual(src, [1, 2, 3]); // unchanged
    assert.deepEqual(next, [1, 2, 3, PULSE_MAX]); // 9 clamped to max
  });
  it("caps the track to the most recent maxLen entries", () => {
    const next = pushPulse([1, 2, 3, 4], 5, 3);
    assert.deepEqual(next, [3, 4, 5]);
  });
  it("treats a non-array as an empty track", () => {
    assert.deepEqual(pushPulse(null, 2), [2]);
  });
  it("defaults to a 24-entry cap", () => {
    let track = [];
    for (let i = 0; i < 30; i++) track = pushPulse(track, i % 8);
    assert.equal(track.length, 24);
  });
});

// Shared field predicates — one source, so the CLI validator
// (scripts/finanz-data.mjs) and any future browser-side check cannot drift.
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
    assert.equal(isCalendarDate(null), false);
  });
});

describe("isCleanHttpsUrl", () => {
  it("accepts a normal https URL", () => {
    assert.equal(isCleanHttpsUrl("https://ko-fi.com/bitcircus"), true);
  });
  it("rejects a bare scheme, whitespace, non-https and non-strings", () => {
    assert.equal(isCleanHttpsUrl("https://"), false);
    assert.equal(isCleanHttpsUrl("https://a b c"), false);
    assert.equal(isCleanHttpsUrl("http://ko-fi.com"), false);
    assert.equal(isCleanHttpsUrl(""), false);
    assert.equal(isCleanHttpsUrl(null), false);
  });
});
