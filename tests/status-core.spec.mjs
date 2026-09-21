/**
 * Unit tests for status-core.js — the timeline math behind /status. Runs
 * with: node --test tests/status-core.spec.mjs
 *
 * `today` is always passed in, so nothing here depends on the wall clock.
 * TODAY is a Monday in ISO week 39; SINCE is the site's first linkup.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../status-core.js");

const TODAY = "2026-09-21";
const SINCE = "2025-05-25";

const ev = (date, { id: suffix = "", ...extra } = {}) => ({
  id: "id-" + date + suffix,
  date,
  title: "Termin " + date,
  series: "linkup",
  cancelled: false,
  ...extra,
});
const kinds = (b) => b.map((x) => x.kind);
const runs = (b) => kinds(b).filter((k, i, a) => i === 0 || a[i - 1] !== k);

describe("date helpers", () => {
  it("knows ISO weeks (the Thursday rule)", () => {
    assert.equal(Core.isoWeek("2026-09-21"), 39);
    assert.equal(Core.isoWeek("2026-03-23"), 13);
    assert.equal(Core.isoWeek("2024-12-30"), 1); // Monday of 2025's week 1
    assert.equal(Core.isoWeek("2027-01-01"), 53); // 2026 has 53 weeks
    assert.equal(Core.isoWeekStart("2026-09-27"), "2026-09-21");
  });
  it("adds days and months across year ends", () => {
    assert.equal(Core.addDays("2025-12-31", 1), "2026-01-01");
    assert.equal(Core.addMonths("2025-11-15", 2), "2026-01-01");
    assert.equal(Core.endOfMonth("2024-02-10"), "2024-02-29");
  });
  it("formats German dates and month labels", () => {
    assert.equal(Core.formatDate("2025-06-13"), "Fr, 13.06.2025");
    assert.equal(Core.monthLabel("2026-03"), "Mär 26");
  });
});

describe("eventState", () => {
  it("cancelled wins over the date, today is still scheduled", () => {
    assert.equal(Core.eventState(ev("2026-09-18"), TODAY), "happened");
    assert.equal(Core.eventState(ev("2026-09-18", { cancelled: true }), TODAY), "cancelled");
    assert.equal(Core.eventState(ev("2026-09-25"), TODAY), "scheduled");
    assert.equal(Core.eventState(ev("2026-09-25", { cancelled: true }), TODAY), "cancelled");
    assert.equal(Core.eventState(ev(TODAY), TODAY), "scheduled");
  });
  it("spells every state and trend in German", () => {
    for (const s of ["happened", "cancelled", "scheduled", "partial", "empty"]) {
      assert.match(Core.stateWord(s), /^[a-zäöüß ]+$/i);
    }
    assert.equal(Core.trendWord(1), "steigend");
    assert.equal(Core.trendWord(-1), "fallend");
    assert.equal(Core.trendWord(0), "gleich");
    assert.equal(Core.trendWord(null), "");
  });
});

describe("bucketState", () => {
  const c = (happened, cancelled, scheduled) => ({ happened, cancelled, scheduled });
  it("follows the precedence empty → partial → cancelled → happened → scheduled", () => {
    assert.equal(Core.bucketState(c(0, 0, 0)), "empty");
    assert.equal(Core.bucketState(c(1, 1, 0)), "partial");
    assert.equal(Core.bucketState(c(0, 1, 1)), "cancelled");
    assert.equal(Core.bucketState(c(2, 0, 1)), "happened");
    assert.equal(Core.bucketState(c(0, 0, 1)), "scheduled");
  });
  it("countsText names only what is there", () => {
    assert.equal(Core.countsText(c(1, 0, 0)), "1 stattgefunden");
    assert.equal(Core.countsText(c(2, 1, 1)), "2 stattgefunden, 1 abgesagt, 1 geplant");
    assert.equal(Core.countsText(c(0, 0, 0)), "kein Termin");
  });
});

describe("bucketizeRange", () => {
  it("cuts ISO weeks Monday–Sunday and clips both ends", () => {
    const b = Core.bucketizeRange("2026-09-02", "2026-09-22", "week");
    assert.deepEqual(b.map((x) => [x.from, x.to]), [
      ["2026-09-02", "2026-09-06"],
      ["2026-09-07", "2026-09-13"],
      ["2026-09-14", "2026-09-20"],
      ["2026-09-21", "2026-09-22"],
    ]);
    assert.deepEqual(b.map((x) => x.label), ["KW 36", "KW 37", "KW 38", "KW 39"]);
  });
  it("cuts months, quarters and years", () => {
    assert.deepEqual(Core.bucketizeRange("2025-11-20", "2026-01-05", "month").map((x) => x.label), ["Nov 25", "Dez 25", "Jan 26"]);
    assert.deepEqual(Core.bucketizeRange("2025-05-25", "2025-12-31", "quarter").map((x) => x.label), ["Q2 25", "Q3 25", "Q4 25"]);
    assert.deepEqual(Core.bucketizeRange("2024-06-01", "2025-06-01", "year").map((x) => x.label), ["2024", "2025"]);
  });
  it("returns nothing for an empty or inverted range", () => {
    assert.deepEqual(Core.bucketizeRange("2026-01-02", "2026-01-01", "week"), []);
    assert.deepEqual(Core.bucketizeRange("", "2026-01-01", "week"), []);
  });
  it("labels a range in German", () => {
    const [w] = Core.bucketizeRange("2026-03-23", "2026-03-29", "week");
    assert.equal(Core.rangeLabel(w), "23.03.–29.03.2026");
    const [y] = Core.bucketizeRange("2015-06-01", "2016-02-01", "year");
    assert.equal(Core.rangeLabel(y), "01.06.–31.12.2015");
    assert.equal(Core.rangeLabel({ from: "2025-12-29", to: "2026-01-04" }), "29.12.2025–04.01.2026");
    assert.equal(Core.rangeLabel({ from: "2026-01-04", to: "2026-01-04" }), "04.01.2026");
  });
  it("finerKind steps year → quarter → month → week → nothing", () => {
    assert.equal(Core.finerKind("year"), "quarter");
    assert.equal(Core.finerKind("quarter"), "month");
    assert.equal(Core.finerKind("month"), "week");
    assert.equal(Core.finerKind("week"), null);
  });
});

describe("ladder", () => {
  it("runs years → quarters → months → weeks, contiguous and oldest first", () => {
    const b = Core.ladder("2015-01-01", TODAY);
    assert.deepEqual(runs(b), ["year", "quarter", "month", "week"]);
    for (let i = 1; i < b.length; i++) {
      assert.equal(b[i].from, Core.addDays(b[i - 1].to, 1), `gap before ${b[i].key}`);
    }
    assert.equal(b[0].from, "2015-01-01");
    assert.equal(b[b.length - 1].to, "2026-09-27"); // today's ISO week runs to Sunday
    assert.equal(kinds(b).filter((k) => k === "week").length, 27); // 26 back + this one
  });
  it("keeps ISO weeks whole on a mid-week today — Monday start, Sunday end", () => {
    const wed = "2026-09-23";
    const b = Core.ladder("2015-01-01", wed);
    const weeks = b.filter((x) => x.kind === "week");
    assert.equal(weeks[0].from, "2026-03-23");
    assert.equal(weeks[weeks.length - 1].to, "2026-09-27");
    assert.equal(weeks.length, 27);
    const months = b.filter((x) => x.kind === "month");
    assert.equal(months[months.length - 1].to, "2026-03-22");
  });

  it("snaps the tier boundaries to period starts", () => {
    const b = Core.ladder("2015-01-01", TODAY);
    const first = (k) => b.find((x) => x.kind === k);
    assert.equal(first("week").from, "2026-03-23"); // a Monday, 26 weeks back
    assert.equal(first("month").from, "2024-09-01"); // 24 months back
    assert.equal(first("quarter").from, "2020-07-01"); // 72 months back, quarter start
    assert.equal(b.filter((x) => x.kind === "week")[0].label, "KW 13");
    assert.equal(b.filter((x) => x.kind === "month").pop().label, "Mär 26");
    assert.equal(b.filter((x) => x.kind === "quarter").pop().label, "Q3 24");
    assert.equal(b.filter((x) => x.kind === "year").pop().label, "2020");
  });
  it("clamps at `since` and skips the tiers the history has not reached", () => {
    const b = Core.ladder(SINCE, TODAY);
    assert.equal(b[0].from, SINCE);
    assert.deepEqual(runs(b), ["month", "week"]);
    assert.equal(b.filter((x) => x.kind === "month").length, 11); // Mai 25 … Mär 26
    assert.equal(b.length, 38);
    assert.deepEqual(Core.ladder("2026-12-01", TODAY), []);
  });
  it("skips a tier stub shorter than one period and starts the finer tier at `since`", () => {
    const b = Core.ladder("2026-03-10", TODAY);
    assert.deepEqual(runs(b), ["week"]);
    assert.equal(b[0].from, "2026-03-10");
    assert.equal(b[0].label, "KW 11");
    assert.equal(b.length, 29);
  });
  it("extends to scheduled events, capped at FUTURE_WEEKS_CAP weeks after today", () => {
    const some = Core.ladder(SINCE, TODAY, { horizon: "2026-10-16" });
    assert.equal(some[some.length - 1].to, "2026-10-18");
    const capped = Core.ladder(SINCE, TODAY, { horizon: "2027-06-01" });
    assert.equal(capped[capped.length - 1].to, "2026-11-22"); // Sunday of the week 8 weeks out
    const past = Core.ladder(SINCE, TODAY, { horizon: "2026-01-01" });
    assert.equal(past[past.length - 1].to, "2026-09-27");
  });
  it("stays bounded forever: at most MAX_BARS, the oldest years folded into one", () => {
    const at = (years) => Core.ladder(SINCE, `${2026 + years}-09-21`);
    assert.equal(at(0).length, 38);
    for (const y of [1, 2, 5, 10, 20]) {
      const b = at(y);
      assert.ok(b.length <= Core.MAX_BARS, `+${y} years: ${b.length} bars`);
      assert.ok(b.length > at(0).length, `+${y} years must show more history than today`);
      assert.equal(b.some((x) => x.merged), false, `+${y} years must not fold yet`);
    }
    const far = at(200);
    assert.equal(far.length, Core.MAX_BARS);
    assert.equal(far[0].merged, true);
    assert.equal(far[0].kind, "year");
    assert.equal(far[0].from, SINCE);
    assert.match(far[0].label, /^vor \d{4}$/);
    assert.equal(far[1].from, Core.addDays(far[0].to, 1));
    assert.equal(far[1].merged, false);
  });
  it("offers a months-only ladder for the pulse", () => {
    const b = Core.ladder("2025-05-01", TODAY, { finest: "month" });
    assert.deepEqual(runs(b), ["month"]);
    assert.equal(b.length, 17); // Mai 25 … Sep 26
    assert.equal(b[b.length - 1].to, "2026-09-30"); // the running month, whole
    const old = Core.ladder("2019-01-01", TODAY, { finest: "month" });
    assert.deepEqual(runs(old), ["year", "quarter", "month"]);
  });
});

describe("assign", () => {
  const events = [
    ev("2026-09-18"),
    ev("2026-09-11", { cancelled: true }),
    ev("2026-09-11", { id: "-b" }),
    ev("2026-09-25"),
    ev("2025-06-13"),
    ev("2024-01-01"), // before since → ignored
    ev("2027-06-01"), // past the horizon → ignored
  ];
  it("puts every event into exactly one bucket and derives the bucket states", () => {
    const b = Core.assign(Core.ladder(SINCE, TODAY, { horizon: "2026-09-25" }), events, TODAY);
    const placed = b.reduce((n, x) => n + x.events.length, 0);
    assert.equal(placed, 5);
    const by = (key) => b.find((x) => x.key === key);
    assert.equal(by("w:2026-09-14").state, "happened");
    assert.equal(by("w:2026-09-07").state, "partial");
    assert.deepEqual(by("w:2026-09-07").counts, { happened: 1, cancelled: 1, scheduled: 0 });
    assert.equal(by("w:2026-09-21").state, "scheduled");
    assert.equal(by("m:2025-06-01").state, "happened");
    assert.equal(by("m:2025-07-01").state, "empty");
  });
  it("resets on a second pass instead of double counting", () => {
    const buckets = Core.ladder(SINCE, TODAY);
    Core.assign(buckets, events, TODAY);
    Core.assign(buckets, events, TODAY);
    assert.equal(buckets.find((x) => x.key === "w:2026-09-14").counts.happened, 1);
  });
});

describe("headline", () => {
  it("counts the last year before today and turns degraded on one cancellation", () => {
    assert.equal(Core.HEADLINE_DAYS, 365);
    const ok = Core.headline([ev("2026-09-18"), ev("2026-08-01"), ev("2025-09-22"), ev("2025-09-20"), ev(TODAY)], TODAY);
    assert.deepEqual([ok.total, ok.cancelled, ok.state], [3, 0, "ok"]);
    assert.equal(ok.text, "alles fand statt · 3 Termine im letzten Jahr");
    const bad = Core.headline([ev("2026-09-18"), ev("2026-01-11", { cancelled: true })], TODAY);
    assert.deepEqual([bad.total, bad.cancelled, bad.state], [2, 1, "degraded"]);
    assert.equal(bad.text, "1 von 2 Terminen abgesagt · letztes Jahr");
    assert.equal(Core.headline([ev("2026-09-18", { cancelled: true })], TODAY).text, "1 von 1 Termin abgesagt · letztes Jahr");
    assert.equal(Core.headline([ev("2026-09-18")], TODAY).text, "alles fand statt · 1 Termin im letzten Jahr");
    assert.equal(Core.headline([], TODAY).text, "keine Termine im letzten Jahr");
  });
});

describe("streak", () => {
  it("counts consecutive weeks back from today that held an event", () => {
    const run = [ev("2026-09-18"), ev("2026-09-11"), ev("2026-09-04")];
    assert.deepEqual(Core.streak(run, TODAY), { weeks: 3, from: "2026-08-31" });
  });
  it("skips the running week while its own event is still ahead", () => {
    // TODAY is the Monday of KW 39; nothing has happened in it yet, and that
    // must not end a run that is otherwise intact.
    assert.equal(Core.streak([ev("2026-09-18")], TODAY).weeks, 1);
    // Saturday of the same week, with Friday behind us: the week counts.
    assert.deepEqual(Core.streak([ev("2026-09-25"), ev("2026-09-18")], "2026-09-26"), {
      weeks: 2,
      from: "2026-09-14",
    });
  });
  it("stops at the first week without one", () => {
    const gap = [ev("2026-09-18"), ev("2026-09-04"), ev("2026-08-28")];
    assert.deepEqual(Core.streak(gap, TODAY), { weeks: 1, from: "2026-09-14" });
  });
  it("counts a week only for an event that happened", () => {
    assert.equal(Core.streak([ev("2026-09-18", { cancelled: true })], TODAY).weeks, 0);
    assert.equal(Core.streak([ev("2026-09-25")], TODAY).weeks, 0);
    assert.deepEqual(Core.streak([], TODAY), { weeks: 0, from: "" });
  });
  it("counts a week once, however many events it held", () => {
    assert.equal(Core.streak([ev("2026-09-18"), ev("2026-09-17"), ev("2026-09-16")], TODAY).weeks, 1);
  });
});

describe("incidents", () => {
  it("lists only cancelled events, newest first, capped", () => {
    const list = Core.incidents([
      ev("2026-09-11", { cancelled: true }),
      ev("2026-09-18"),
      ev("2026-10-02", { cancelled: true }),
      ev("2025-06-13", { cancelled: true }),
      ev("2026-09-11", { cancelled: true, id: "-a" }),
    ]);
    assert.deepEqual(list.map((e) => e.id), ["id-2026-10-02", "id-2026-09-11", "id-2026-09-11-a", "id-2025-06-13"]);
    assert.equal(Core.incidents(list, 2).length, 2);
  });
});

describe("pulseMonths", () => {
  it("needs a start month — otherwise there is no time axis", () => {
    assert.deepEqual(Core.pulseMonths(undefined), []);
    assert.deepEqual(Core.pulseMonths({ levels: [1, 2] }), []);
    assert.deepEqual(Core.pulseMonths({ start: "2025-13", levels: [1] }), []);
    assert.deepEqual(Core.pulseMonths({ start: "2025-05-01", levels: [1] }), []);
    assert.deepEqual(Core.pulseMonths({ start: "2025-05", levels: "1" }), []);
  });
  it("dates level i at start + i months, across the year end, with a delta per month", () => {
    const m = Core.pulseMonths({ start: "2025-11", levels: [2, 3, 3] });
    assert.deepEqual(m.map((x) => x.month), ["2025-11", "2025-12", "2026-01"]);
    assert.deepEqual(m.map((x) => x.delta), [null, 1, 0]);
    assert.deepEqual(m.map((x) => x.label), ["Nov 25", "Dez 25", "Jan 26"]);
    assert.deepEqual([m[0].from, m[0].to, m[0].kind, m[0].key], ["2025-11-01", "2025-11-30", "month", "pm:2025-11"]);
  });
  it("clamps levels into 0..7", () => {
    assert.deepEqual(Core.pulseMonths({ start: "2025-05", levels: [9, -1, 3.6, "x"] }).map((x) => x.level), [7, 0, 4, 0]);
  });
});

describe("pulseBuckets", () => {
  it("carries a month onto its bucket and leaves a gap (null) where no month is", () => {
    const months = Core.pulseMonths({ start: "2025-05", levels: [1, 2, 4, 4] });
    const pb = Core.pulseBuckets(months, Core.ladder("2025-05-01", TODAY, { finest: "month" }));
    assert.deepEqual(pb.slice(0, 5).map((x) => x.level), [1, 2, 4, 4, null]);
    assert.deepEqual(pb.slice(0, 5).map((x) => x.delta), [null, 1, 1, 0, null]);
    assert.equal(pb[pb.length - 1].level, null);
    assert.equal(pb[0].months.length, 1);
    assert.equal(pb[0].label, "Mai 25");
  });
  it("averages and rounds the months inside a squashed bucket, delta against the last level", () => {
    const buckets = Core.ladder("2019-01-01", TODAY, { finest: "month" });
    const q1 = buckets.find((x) => x.key === "q:2021-01-01");
    assert.ok(q1, "2021-Q1 must be a quarter bucket at this age");
    const months = Core.pulseMonths({ start: "2021-01", levels: [2, 3, 3, 0, 0, 0] });
    const pb = Core.pulseBuckets(months, buckets);
    const at = (key) => pb.find((x) => x.key === key);
    assert.equal(at("q:2021-01-01").level, 3); // (2+3+3)/3 = 2.67
    assert.equal(at("q:2021-01-01").months.length, 3);
    assert.equal(at("q:2021-01-01").delta, null);
    assert.equal(at("q:2021-04-01").level, 0);
    assert.equal(at("q:2021-04-01").delta, -1);
    assert.equal(at("q:2021-07-01").level, null);
    assert.equal(at("q:2021-07-01").delta, null);
  });
  it("never spells a value: no euro sign, no percent anywhere in the result", () => {
    const months = Core.pulseMonths({ start: "2025-05", levels: [0, 7, 3] });
    const text = JSON.stringify(Core.pulseBuckets(months, Core.ladder("2025-05-01", TODAY, { finest: "month" })));
    assert.equal(text.includes("€"), false);
    assert.equal(text.includes("%"), false);
  });
});
