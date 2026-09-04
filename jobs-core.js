/**
 * jobs-core.js — shared expiry math for the job board ("Pinnwand", pinnwand.html),
 * used by the browser renderer (jobs.js) and by the CI gate
 * (scripts/check-jobs.mjs), which pulls it in through createRequire so both
 * sides compute the same last day for a posting.
 *
 * Why the math lives here and not in a Date subtraction: a posting is bought for
 * 1, 3 or 12 MONTHS, and the visitor's browser decides whether it is still up.
 * Doing that with Date objects would make the answer depend on the reader's
 * timezone; instead every value is a {y,m,d} integer triple compared as an ISO
 * string ("2026-09-30" < "2026-10-01"), so the only clock read in the whole
 * module is todayString().
 *
 * Half-open runtime: a posting is visible from `from` through `lastDay`, where
 * lastDay is the day BEFORE the same day-of-month `months` later. "1 month from
 * 01.09." therefore means 01.09.–30.09. inclusive — the reading a buyer expects.
 *
 * Names are deliberately generic (`activeEntries`, not `activePostings`): the
 * second half of the pinnwand (the "biete" notes) reuses this module unchanged.
 *
 * UMD wrapper exposes `module.exports` under Node (tests + CI gate) and a global
 * `JobsCore` in the browser (loaded via <script> before jobs.js). ES5, so the
 * browser needs no transpilation. Pure functions only — no DOM, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.JobsCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The price list, machine-enforced: jobs.schema.json and check-jobs.mjs name
  // the same three durations, and a unit test asserts all three stay in step.
  var MONTHS = [1, 3, 12];

  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function daysInMonth(y, m) {
    if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function iso(y, m, d) {
    return y + "-" + pad2(m) + "-" + pad2(d);
  }

  /** "2026-09-01" → {y,m,d}, or null if it is not a real calendar day. */
  function parseIso(s) {
    var m = ISO_RE.exec(typeof s === "string" ? s : "");
    if (!m) return null;
    var y = +m[1],
      mo = +m[2],
      d = +m[3];
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  /** The calendar day before {y,m,d} — pure integer math, no Date. */
  function minusOneDay(y, m, d) {
    if (d > 1) return iso(y, m, d - 1);
    if (m > 1) return iso(y, m - 1, daysInMonth(y, m - 1));
    return iso(y - 1, 12, 31);
  }

  /**
   * Last day a posting is visible, as an ISO string — null for a bad date or an
   * unsold duration.
   *
   * The one visible asymmetry: if the anniversary day does not exist in the
   * target month (31.01. + 1 month → there is no 31.02.), the run ends on that
   * month's LAST day — 28.02., or 29.02. in a leap year. Every other case is
   * "the day before the same day-of-month".
   */
  function lastDay(from, months) {
    var p = parseIso(from);
    if (!p) return null;
    if (MONTHS.indexOf(months) === -1) return null;
    var total = p.m - 1 + months;
    var y2 = p.y + Math.floor(total / 12);
    var m2 = (total % 12) + 1;
    var dim = daysInMonth(y2, m2);
    if (p.d > dim) return iso(y2, m2, dim);
    return minusOneDay(y2, m2, p.d);
  }

  /**
   * Today as an ISO string, from LOCAL date components — Berlin at 00:30 on
   * 1 October has to see the 1 October board, which getUTC* would not give it.
   * `now` is injectable so tests never touch the wall clock.
   */
  function todayString(now) {
    now = now || new Date();
    return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  /** Is this entry up on the wall on `today` (both ends inclusive)? */
  function isActive(entry, today) {
    if (!entry || typeof today !== "string") return false;
    var end = lastDay(entry.from, entry.months);
    if (!end) return false;
    return entry.from <= today && today <= end;
  }

  /**
   * The entries visible on `today`: newest first (`from` DESC), ties broken by
   * `id` ASC so the order is stable across reloads. Returns a NEW array — the
   * caller's list is never sorted in place.
   */
  function activeEntries(list, today) {
    var out = [];
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length; i++) {
      if (isActive(list[i], today)) out.push(list[i]);
    }
    return out.sort(function (a, b) {
      if (a.from !== b.from) return a.from < b.from ? 1 : -1;
      var ai = String(a.id == null ? "" : a.id),
        bi = String(b.id == null ? "" : b.id);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }

  /** "2026-09-30" → "30.09.2026". Anything else passes through untouched. */
  function formatDay(isoDay) {
    var m = ISO_RE.exec(typeof isoDay === "string" ? isoDay : "");
    return m ? m[3] + "." + m[2] + "." + m[1] : String(isoDay == null ? "" : isoDay);
  }

  return {
    MONTHS: MONTHS,
    lastDay: lastDay,
    todayString: todayString,
    isActive: isActive,
    activeEntries: activeEntries,
    formatDay: formatDay,
  };
});
