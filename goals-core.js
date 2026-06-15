/**
 * goals-core.js — shared funding-goal math used by BOTH the browser renderer
 * (goals.js) and the future Ko-fi sync/endpoint.
 *
 * Single source of truth: edit the math here and every consumer updates. UMD
 * wrapper exposes `module.exports` under Node (imported by the tests / sync)
 * and a global `GoalsCore` in the browser (loaded via <script> before goals.js).
 *
 * Written in ES5 so the browser needs no transpilation. Pure functions only —
 * no DOM, no I/O — so the percentages and ASCII bars are unit-testable in ~ms.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GoalsCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BAR_WIDTH = 20;
  var FILLED = "█"; // full block
  var EMPTY = "░"; // light shade
  var SYMBOLS = { EUR: "€", USD: "$", GBP: "£" };

  function num(v) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  function repeat(ch, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  // Raw funding ratio in percent (can exceed 100 when over-funded). Guards a
  // zero/negative target so a missing goal amount never divides by zero.
  function rawPercent(raised, target) {
    var r = Math.max(0, num(raised));
    var t = num(target);
    if (t <= 0) return 0;
    return (r / t) * 100;
  }

  // ASCII progress bar split into filled/empty runs so the renderer can colour
  // each independently — no inline styles needed, the character count IS the
  // data. `pct` is clamped to 0..100; width defaults to BAR_WIDTH.
  function asciiBar(pct, width) {
    var w = width > 0 ? Math.floor(width) : BAR_WIDTH;
    var p = clamp(num(pct), 0, 100);
    var filledCount = clamp(Math.round((p / 100) * w), 0, w);
    return {
      filledCount: filledCount,
      width: w,
      filled: repeat(FILLED, filledCount),
      empty: repeat(EMPTY, w - filledCount),
    };
  }

  // Thousands-grouped amount with currency symbol, no decimals (donations are
  // tracked in whole units). 1450 + EUR -> "1.450 €" (non-breaking space).
  function formatAmount(value, currency) {
    var n = Math.round(num(value));
    var sign = n < 0 ? "-" : "";
    var digits = String(Math.abs(n));
    var grouped = "";
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 === 0) grouped += ".";
      grouped += digits.charAt(i);
    }
    var sym = SYMBOLS[currency] || SYMBOLS.EUR;
    return sign + grouped + " " + sym;
  }

  // Normalise one goal into the shape the renderer consumes.
  function computeGoal(goal, opts) {
    goal = goal || {};
    opts = opts || {};
    var width = opts.barWidth || BAR_WIDTH;
    var currency = goal.currency || opts.currency || "EUR";
    var raised = Math.max(0, num(goal.raised));
    var target = num(goal.target);
    var raw = rawPercent(raised, target);
    var pct = Math.round(clamp(raw, 0, 100));
    return {
      id: goal.id || "",
      title: goal.title || "",
      currency: currency,
      raised: raised,
      target: target,
      pct: pct,
      rawPct: Math.round(raw),
      reached: target > 0 && raised >= target,
      remaining: Math.max(0, target - raised),
      bar: asciiBar(pct, width),
    };
  }

  // Roll several goals into one overview (total bar + reached count).
  function aggregate(goals, opts) {
    opts = opts || {};
    var width = opts.barWidth || BAR_WIDTH;
    var list = goals && goals.length ? goals : [];
    var totalRaised = 0;
    var totalTarget = 0;
    var reachedCount = 0;
    for (var i = 0; i < list.length; i++) {
      var g = computeGoal(list[i], opts);
      totalRaised += g.raised;
      totalTarget += g.target;
      if (g.reached) reachedCount++;
    }
    var raw = rawPercent(totalRaised, totalTarget);
    var pct = Math.round(clamp(raw, 0, 100));
    return {
      count: list.length,
      reachedCount: reachedCount,
      totalRaised: totalRaised,
      totalTarget: totalTarget,
      pct: pct,
      rawPct: Math.round(raw),
      bar: asciiBar(pct, width),
    };
  }

  return {
    BAR_WIDTH: BAR_WIDTH,
    rawPercent: rawPercent,
    asciiBar: asciiBar,
    formatAmount: formatAmount,
    computeGoal: computeGoal,
    aggregate: aggregate,
  };
});
