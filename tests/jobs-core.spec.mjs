/**
 * Unit tests for jobs-core.js — expiry math for the job board (pinnwand.html).
 * Runs with: node --test tests/jobs-core.spec.mjs
 *
 * Pure functions, no DOM, no network, no wall clock: every case pins `today` or
 * injects `now`.
 *
 * RULE for this file: build a `now` from LOCAL components — new Date(2026, 8, 15).
 * Never new Date('2026-09-15'), which is UTC midnight and lands on the previous
 * day in any negative offset, so the test would pass in Berlin and fail in CI.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JobsCore from "../jobs-core.js";

const { MONTHS, lastDay, todayString, isActive, activeEntries, formatDay } = JobsCore;

describe("MONTHS", () => {
  it("is the sold price list, in order", () => {
    assert.deepEqual(MONTHS, [1, 3, 12]);
  });
});

describe("lastDay", () => {
  it("ends the day before the same day-of-month", () => {
    // "1 month from 01.09." is 01.09.–30.09. inclusive, not through 01.10.
    assert.equal(lastDay("2026-09-01", 1), "2026-09-30");
    assert.equal(lastDay("2026-09-15", 3), "2026-12-14");
    assert.equal(lastDay("2026-09-01", 12), "2027-08-31");
  });

  it("falls back to the target month's last day when the anniversary is missing", () => {
    assert.equal(lastDay("2026-01-31", 1), "2026-02-28");
    assert.equal(lastDay("2028-01-31", 1), "2028-02-29"); // leap year
    assert.equal(lastDay("2026-08-31", 3), "2026-11-30");
    assert.equal(lastDay("2028-02-29", 12), "2029-02-28");
  });

  it("crosses the year boundary in both branches", () => {
    assert.equal(lastDay("2026-12-15", 1), "2027-01-14");
    assert.equal(lastDay("2026-12-01", 1), "2026-12-31"); // day-of-month 1 → back a month
    assert.equal(lastDay("2026-12-31", 1), "2027-01-30");
  });

  it("returns null for an unsold duration or a date that does not exist", () => {
    assert.equal(lastDay("2026-09-01", 2), null);
    assert.equal(lastDay("2026-09-01", 0), null);
    assert.equal(lastDay("2026-02-30", 1), null);
    assert.equal(lastDay("2026-13-01", 1), null);
    assert.equal(lastDay("01.09.2026", 1), null);
    assert.equal(lastDay(undefined, 1), null);
  });
});

describe("isActive", () => {
  // 1 month from 01.09.2026 → visible 2026-09-01 … 2026-09-30.
  const entry = { id: "a", from: "2026-09-01", months: 1 };

  it("is inclusive at both ends and false outside them", () => {
    assert.equal(isActive(entry, "2026-08-31"), false); // day before `from`
    assert.equal(isActive(entry, "2026-09-01"), true); // first day
    assert.equal(isActive(entry, "2026-09-30"), true); // last day
    assert.equal(isActive(entry, "2026-10-01"), false); // day after
  });

  it("is false for an entry whose dates do not compute", () => {
    assert.equal(isActive({ from: "2026-09-01", months: 5 }, "2026-09-10"), false);
    assert.equal(isActive({ from: "nope", months: 1 }, "2026-09-10"), false);
    assert.equal(isActive(null, "2026-09-10"), false);
    assert.equal(isActive(entry, undefined), false);
  });
});

describe("todayString", () => {
  it("reads local date components, so a late or early hour stays on its own day", () => {
    assert.equal(todayString(new Date(2026, 8, 15, 0, 15)), "2026-09-15");
    assert.equal(todayString(new Date(2026, 8, 15, 23, 30)), "2026-09-15");
    assert.equal(todayString(new Date(2026, 9, 1, 0, 30)), "2026-10-01");
  });

  it("pads month and day", () => {
    assert.equal(todayString(new Date(2027, 0, 5)), "2027-01-05");
  });
});

describe("activeEntries", () => {
  const list = [
    { id: "old", from: "2026-07-01", months: 1 }, // expired 2026-07-31
    { id: "beta", from: "2026-09-01", months: 3 },
    { id: "alpha", from: "2026-09-01", months: 1 },
    { id: "newest", from: "2026-09-10", months: 1 },
    { id: "future", from: "2026-10-01", months: 1 },
  ];

  it("keeps only what is up today, newest first, ties by id", () => {
    const out = activeEntries(list, "2026-09-15");
    assert.deepEqual(
      out.map((e) => e.id),
      ["newest", "alpha", "beta"]
    );
  });

  it("does not mutate or alias the caller's list", () => {
    const input = list.slice();
    const out = activeEntries(input, "2026-09-15");
    assert.deepEqual(
      input.map((e) => e.id),
      ["old", "beta", "alpha", "newest", "future"]
    );
    assert.notEqual(out, input);
  });

  it("returns an empty array for no input and for a day with nothing up", () => {
    assert.deepEqual(activeEntries([], "2026-09-15"), []);
    assert.deepEqual(activeEntries(undefined, "2026-09-15"), []);
    assert.deepEqual(activeEntries(list, "2026-08-15"), []);
  });
});

describe("formatDay", () => {
  it("renders the German day order", () => {
    assert.equal(formatDay("2026-09-30"), "30.09.2026");
    assert.equal(formatDay("2027-01-05"), "05.01.2027");
  });

  it("passes anything else through", () => {
    assert.equal(formatDay("bald"), "bald");
    assert.equal(formatDay(null), "");
  });
});
