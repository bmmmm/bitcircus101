/**
 * Unit tests for finanz-core.js — cost/funding math for the one-time
 * (`einmalig`) items shown on donations.html#projekte. Runs with:
 *   node --test tests/finanz-core.spec.mjs
 * Pure functions, no DOM, no network. Recurring monthly costs carry no target
 * and never pass through here, so they are intentionally out of scope.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import FinanzCore from "../finanz-core.js";

const { rawPercent, asciiBar, formatAmount, computeGoal, aggregate, BAR_WIDTH } =
  FinanzCore;

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

describe("computeGoal", () => {
  it("derives pct, reached, remaining and a bar", () => {
    const g = computeGoal({ id: "x", title: "X", raised: 145, target: 800 });
    assert.equal(g.pct, 18); // 145/800 = 18.1 -> 18
    assert.equal(g.reached, false);
    assert.equal(g.remaining, 655);
    assert.equal(g.bar.width, BAR_WIDTH);
  });
  it("marks a goal reached at exactly the target", () => {
    const g = computeGoal({ raised: 200, target: 200 });
    assert.equal(g.reached, true);
    assert.equal(g.pct, 100);
    assert.equal(g.remaining, 0);
  });
  it("clamps the bar but keeps rawPct when over-funded", () => {
    const g = computeGoal({ raised: 1000, target: 800 });
    assert.equal(g.pct, 100);
    assert.equal(g.rawPct, 125);
    assert.equal(g.bar.filledCount, BAR_WIDTH);
  });
  it("never divides by zero on a missing target (e.g. a monthly item shape)", () => {
    const g = computeGoal({ raised: 50, target: 0 });
    assert.equal(g.pct, 0);
    assert.equal(g.reached, false);
    assert.equal(g.remaining, 0);
  });
  it("floors a negative raised at 0", () => {
    const g = computeGoal({ raised: -5, target: 100 });
    assert.equal(g.raised, 0);
    assert.equal(g.pct, 0);
  });
});

describe("aggregate", () => {
  it("sums raised/target across one-time items and counts reached", () => {
    const a = aggregate([
      { raised: 145, target: 800 },
      { raised: 200, target: 200 },
      { raised: 0, target: 100 },
    ]);
    assert.equal(a.count, 3);
    assert.equal(a.reachedCount, 1);
    assert.equal(a.totalRaised, 345);
    assert.equal(a.totalTarget, 1100);
    assert.equal(a.pct, 31); // 345/1100 = 31.4 -> 31
  });
  it("handles an empty list without dividing by zero", () => {
    const a = aggregate([]);
    assert.equal(a.count, 0);
    assert.equal(a.pct, 0);
    assert.equal(a.totalTarget, 0);
    assert.equal(a.bar.filledCount, 0);
  });
  it("only totals what it is given — monthly costs stay out of the one-time total", () => {
    // The renderer passes ONLY the einmalig list here; recurring monthly items
    // (no target) are never included, so the total reflects one-time money only.
    const einmalig = [{ raised: 145, target: 2000 }];
    const a = aggregate(einmalig);
    assert.equal(a.count, 1);
    assert.equal(a.totalTarget, 2000);
    assert.equal(a.totalRaised, 145);
  });
});
