/**
 * finanz-core.js — shared cost/funding math for the "Projekte & Kosten" board
 * (support.html#projekte), used by the browser renderer (finanz.js) and by the
 * maintainer CLI (scripts/finanz.mjs + scripts/finanz-data.mjs), which pulls it
 * in through createRequire so both sides share one implementation.
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

  // Resolve where a project's donate button points. A project that runs its
  // OWN Ko-fi donation page (item.kofi) links straight there — external, opened
  // in a new tab. Without one, the button stays on-site and jumps to the local
  // payment methods (#dauerhaft) instead of bouncing the visitor to a bare,
  // out-of-context Ko-fi profile. Returns { href, external } so every renderer
  // shares one href policy and only picks its own arrow/target markup locally.
  function donateTarget(item) {
    var kofi = item && item.kofi;
    if (kofi) return { href: kofi, external: true };
    return { href: "#dauerhaft", external: false };
  }

  // ── Pulse: a cryptic, value-free funding "heartbeat" ─────────────────────
  // A deliberately COARSE momentum track. Each entry is an integer level
  // 0..PULSE_MAX (8 discrete heights) — NEVER a euro amount — so the public
  // file reveals only rhythm, not figures: nothing is 1:1 readable and there is
  // no personal data to leak. The editing tools bucket a real delta into a level
  // LOCALLY via pulseLevel(); only the resulting level is ever written out.
  var PULSE_MAX = 7; // highest level index → 8 discrete heights (0..7)
  var PULSE_GLYPHS = "▁▂▃▄▅▆▇█"; // charAt(level) === glyph

  // Bucket a raw value into a coarse 0..PULSE_MAX level against a scale (the
  // value that should read as "full"). A zero/negative scale yields 0 so a
  // missing scale never divides by zero; negative values floor at 0.
  function pulseLevel(value, scale) {
    var v = Math.max(0, num(value));
    var s = num(scale);
    if (s <= 0) return 0;
    return clamp(Math.round((v / s) * PULSE_MAX), 0, PULSE_MAX);
  }

  // One glyph for a level (clamped, rounded). Non-numbers fall back to the
  // baseline glyph so malformed data degrades quietly instead of throwing.
  function pulseGlyph(level) {
    return PULSE_GLYPHS.charAt(clamp(Math.round(num(level)), 0, PULSE_MAX));
  }

  // Render a levels array into a sparkline string (each level → its glyph). A
  // non-array yields ""; out-of-range levels are clamped to a flat line.
  function pulseSparkline(levels) {
    if (!levels || typeof levels.length !== "number") return "";
    var out = "";
    for (var i = 0; i < levels.length; i++) out += pulseGlyph(levels[i]);
    return out;
  }

  // Append a level and cap the track to its most recent maxLen entries
  // (default 24). Returns a NEW array — never mutates the input — and clamps
  // every stored level into range so the persisted track is always valid.
  function pushPulse(levels, level, maxLen) {
    var max = maxLen > 0 ? Math.floor(maxLen) : 24;
    var src = levels && typeof levels.length === "number" ? levels : [];
    var next = [];
    for (var i = 0; i < src.length; i++) {
      next.push(clamp(Math.round(num(src[i])), 0, PULSE_MAX));
    }
    next.push(clamp(Math.round(num(level)), 0, PULSE_MAX));
    if (next.length > max) next = next.slice(next.length - max);
    return next;
  }

  // ── Shared field predicates ──────────────────────────────────────────────
  // finanz.schema.json declares format:"date" / format:"uri", but a JSON-Schema
  // pattern can't express calendar validity or "no whitespace / has a host".
  // These live here — not in the CLI validator — so the browser side can call
  // the same rule the moment it needs to, with no second implementation to
  // drift from this one.

  // Calendar-validate a YYYY-MM-DD string: well-formed AND a date that actually
  // exists (so "2026-13-99" / "2026-02-30" are rejected). Date.UTC is a pure,
  // clock-free construction — deterministic, no wall-clock read.
  function isCalendarDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4),
      m = +s.slice(5, 7),
      d = +s.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }

  // A usable https link: "https://" prefix, an actual host after it, and no
  // embedded whitespace — the part of format:"uri" the ^https:// pattern can't
  // catch (a bare "https://" or "https://a b c" both satisfy the pattern).
  function isCleanHttpsUrl(s) {
    return (
      typeof s === "string" &&
      s.indexOf("https://") === 0 &&
      s.length > "https://".length &&
      !/\s/.test(s)
    );
  }

  return {
    BAR_WIDTH: BAR_WIDTH,
    rawPercent: rawPercent,
    asciiBar: asciiBar,
    formatAmount: formatAmount,
    computeProject: computeProject,
    donateTarget: donateTarget,
    PULSE_MAX: PULSE_MAX,
    PULSE_GLYPHS: PULSE_GLYPHS,
    pulseLevel: pulseLevel,
    pulseGlyph: pulseGlyph,
    pulseSparkline: pulseSparkline,
    pushPulse: pushPulse,
    isCalendarDate: isCalendarDate,
    isCleanHttpsUrl: isCleanHttpsUrl,
  };
});
