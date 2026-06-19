/**
 * finanz-core.js — shared cost/funding math for the "Projekte & Kosten" board
 * (donations.html#projekte), used by BOTH the browser renderer (finanz.js) and
 * the alternate view templates (projects.js).
 *
 * Scope: this module only does the math for ONE-TIME items (`einmalig`) — those
 * have a `target`/`raised` and therefore a progress bar. Recurring monthly costs
 * (`monatlich`) have no target to "reach", so they carry no bar and are rendered
 * directly by finanz.js without going through here.
 *
 * Single source of truth: edit the math here and every consumer updates. UMD
 * wrapper exposes `module.exports` under Node (imported by the tests) and a
 * global `FinanzCore` in the browser (loaded via <script> before finanz.js).
 *
 * Written in ES5 so the browser needs no transpilation. Pure functions only —
 * no DOM, no I/O — so the percentages and ASCII bars are unit-testable in ~ms.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FinanzCore = factory();
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
  // zero/negative target so a missing amount never divides by zero.
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

  // Thousands-grouped amount with currency symbol, no decimals (amounts are
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
    return sign + grouped + " " + sym;
  }

  // Normalise one ONE-TIME project (`einmalig`, target/raised) into the shape
  // the renderer consumes. Monthly items never pass through here — no target.
  function computeProject(project, opts) {
    project = project || {};
    opts = opts || {};
    var width = opts.barWidth || BAR_WIDTH;
    var currency = project.currency || opts.currency || "EUR";
    var raised = Math.max(0, num(project.raised));
    var target = num(project.target);
    var raw = rawPercent(raised, target);
    var pct = Math.round(clamp(raw, 0, 100));
    return {
      id: project.id || "",
      title: project.title || "",
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

  return {
    BAR_WIDTH: BAR_WIDTH,
    rawPercent: rawPercent,
    asciiBar: asciiBar,
    formatAmount: formatAmount,
    computeProject: computeProject,
  };
});
