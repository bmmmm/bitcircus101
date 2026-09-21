/**
 * status-core.js — the timeline math behind /status (status.html).
 *
 * Three questions, answered here and nowhere else: did an event happen
 * (eventState), how is the history cut into bars that get coarser with age
 * (ladder / bucketizeRange / assign), and how does the value-free funding
 * pulse map onto the same ladder (pulseMonths / pulseBuckets). status.js only
 * draws what comes out; tests/status-core.spec.mjs pins the behaviour from
 * Node.
 *
 * UMD/ES5 like the other *-core.js modules: loaded by a <script> tag in the
 * browser AND require()d by node --test, so no ESM and no modern syntax here.
 *
 * Dates are "YYYY-MM-DD" strings throughout (they compare as strings) and the
 * helpers compute in UTC, so a DST switch can never move a bucket boundary.
 * Weeks are ISO weeks, Monday to Sunday — a Friday event never straddles one.
 *
 * The squash ladder keeps the bar count bounded forever:
 *   weeks    for the last WEEK_TIER_WEEKS weeks (+ up to FUTURE_WEEKS_CAP ahead)
 *   months   back to MONTH_TIER_MONTHS months
 *   quarters back to QUARTER_TIER_MONTHS months
 *   years    back to `since`
 * A tier whose clamped span is shorter than one of its periods is skipped and
 * the finer tier starts at `since` instead (no lone "2025" stub next to
 * quarters). Above MAX_BARS the oldest year buckets fold into one "vor <year>"
 * bucket, so the row grows by one bar per year and then stops growing at all.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.StatusCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_BARS = 80;
  var WEEK_TIER_WEEKS = 26;
  var MONTH_TIER_MONTHS = 24;
  var QUARTER_TIER_MONTHS = 72;
  var FUTURE_WEEKS_CAP = 8;
  var HEADLINE_DAYS = 90;
  var DAY_MS = 86400000;
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  var WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  var STATE_WORDS = {
    happened: "stattgefunden",
    cancelled: "abgesagt",
    scheduled: "geplant",
    partial: "teilweise abgesagt",
    empty: "kein Termin"
  };
  var TREND_WORDS = { "-1": "fallend", "0": "gleich", "1": "steigend" };
  var FINER = { year: "quarter", quarter: "month", month: "week", week: null };

  // ── date helpers (UTC; ISO strings in and out) ─────────────────────────────
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function parse(iso) {
    var p = iso.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function fmt(d) {
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addDays(iso, n) {
    var d = parse(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return fmt(d);
  }
  /** First day of the month `n` months after the month holding `iso`. */
  function addMonths(iso, n) {
    var d = parse(iso);
    return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
  }
  function startOfMonth(iso) { return iso.slice(0, 8) + "01"; }
  function endOfMonth(iso) { return addDays(addMonths(iso, 1), -1); }
  function startOfQuarter(iso) {
    var d = parse(iso);
    return fmt(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
  }
  function startOfYear(iso) { return iso.slice(0, 4) + "-01-01"; }
  /** Monday of the ISO week holding `iso`. */
  function isoWeekStart(iso) {
    var d = parse(iso);
    return addDays(iso, -((d.getUTCDay() + 6) % 7));
  }
  /** ISO-8601 week number of `iso` — the week's Thursday decides the year. */
  function isoWeek(iso) {
    var d = parse(iso);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
    var yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  }
  function fmtDE(iso) { return iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4); }
  function fmtDEShort(iso) { return iso.slice(8, 10) + "." + iso.slice(5, 7) + "."; }
  /** "Fr, 13.06.2025" — the date as the detail list spells it. */
  function formatDate(iso) { return WEEKDAYS[parse(iso).getUTCDay()] + ", " + fmtDE(iso); }
  /** "Jun 25" for a "YYYY-MM" month key. */
  function monthLabel(ym) { return MONTHS_SHORT[+ym.slice(5, 7) - 1] + " " + ym.slice(2, 4); }

  // ── events ─────────────────────────────────────────────────────────────────
  /** `cancelled` beats the date: a cancelled future event is still cancelled.
   *  An event dated today has not happened yet — it is scheduled until tomorrow. */
  function eventState(ev, today) {
    if (ev.cancelled) return "cancelled";
    return ev.date < today ? "happened" : "scheduled";
  }
  function stateWord(state) { return STATE_WORDS[state] || state; }
  function trendWord(delta) {
    return delta === null || delta === undefined ? "" : TREND_WORDS[String(delta)] || "";
  }

  // ── buckets ────────────────────────────────────────────────────────────────
  /** empty → partial (both kinds) → cancelled → happened → scheduled. */
  function bucketState(c) {
    if (!(c.happened + c.cancelled + c.scheduled)) return "empty";
    if (c.cancelled && c.happened) return "partial";
    if (c.cancelled) return "cancelled";
    if (c.happened) return "happened";
    return "scheduled";
  }
  function bucketLabel(b) {
    if (b.merged) return "vor " + addDays(b.to, 1).slice(0, 4);
    var m = +b.from.slice(5, 7) - 1;
    var yy = b.from.slice(2, 4);
    if (b.kind === "week") return "KW " + isoWeek(b.from);
    if (b.kind === "month") return MONTHS_SHORT[m] + " " + yy;
    if (b.kind === "quarter") return "Q" + (Math.floor(m / 3) + 1) + " " + yy;
    return b.from.slice(0, 4);
  }
  function rangeLabel(b) {
    if (b.from === b.to) return fmtDE(b.from);
    if (b.from.slice(0, 4) === b.to.slice(0, 4)) return fmtDEShort(b.from) + "–" + fmtDE(b.to);
    return fmtDE(b.from) + "–" + fmtDE(b.to);
  }
  function countsText(c) {
    var parts = [];
    if (c.happened) parts.push(c.happened + " stattgefunden");
    if (c.cancelled) parts.push(c.cancelled + " abgesagt");
    if (c.scheduled) parts.push(c.scheduled + " geplant");
    return parts.length ? parts.join(", ") : STATE_WORDS.empty;
  }
  function finerKind(kind) { return FINER[kind] || null; }

  function makeBucket(kind, from, to) {
    var b = {
      key: kind.charAt(0) + ":" + from,
      kind: kind,
      from: from,
      to: to,
      merged: false,
      label: "",
      events: [],
      counts: { happened: 0, cancelled: 0, scheduled: 0 },
      state: "empty"
    };
    b.label = bucketLabel(b);
    return b;
  }
  function periodStart(iso, kind) {
    if (kind === "week") return isoWeekStart(iso);
    if (kind === "month") return startOfMonth(iso);
    if (kind === "quarter") return startOfQuarter(iso);
    return startOfYear(iso);
  }
  function periodNext(start, kind) {
    if (kind === "week") return addDays(start, 7);
    if (kind === "month") return addMonths(start, 1);
    if (kind === "quarter") return addMonths(start, 3);
    return addMonths(start, 12);
  }
  /** Buckets of one `kind` covering [from, to]; the first and last are clipped. */
  function bucketizeRange(from, to, kind) {
    var out = [];
    if (!from || !to || from > to) return out;
    var start = periodStart(from, kind);
    while (start <= to) {
      var next = periodNext(start, kind);
      var end = addDays(next, -1);
      out.push(makeBucket(kind, start < from ? from : start, end > to ? to : end));
      start = next;
    }
    return out;
  }
  /**
   * The whole timeline from `since` to the horizon, coarsening with age.
   * opts.finest: "week" (default) or "month" (the pulse has no finer data).
   * opts.horizon: last date to cover (for scheduled events), capped at
   * FUTURE_WEEKS_CAP weeks after `today`; the newest bucket always spans its
   * whole period, so a Friday later this week already shows as "geplant".
   * Contiguous, oldest first.
   */
  function ladder(since, today, opts) {
    opts = opts || {};
    var finest = opts.finest === "month" ? "month" : "week";
    var cap = addDays(today, FUTURE_WEEKS_CAP * 7);
    var horizon = opts.horizon && opts.horizon > today ? opts.horizon : today;
    if (horizon > cap) horizon = cap;
    horizon = addDays(periodNext(periodStart(horizon, finest), finest), -1);
    if (!since || since > horizon) return [];
    var monthAnchor = startOfMonth(today);
    var weekFrom = isoWeekStart(addDays(today, -WEEK_TIER_WEEKS * 7));
    var monthFrom = addMonths(monthAnchor, -MONTH_TIER_MONTHS);
    var quarterFrom = startOfQuarter(addMonths(monthAnchor, -QUARTER_TIER_MONTHS));
    var segs = [
      { kind: "year", from: since, to: addDays(quarterFrom, -1) },
      { kind: "quarter", from: quarterFrom, to: addDays(monthFrom, -1) }
    ];
    if (finest === "week") {
      segs.push({ kind: "month", from: monthFrom, to: addDays(weekFrom, -1) });
      segs.push({ kind: "week", from: weekFrom, to: horizon });
    } else {
      segs.push({ kind: "month", from: monthFrom, to: horizon });
    }
    var out = [];
    var carry = null; // start of a skipped stub tier, taken over by the finer one
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var from = carry !== null ? carry : (s.from < since ? since : s.from);
      carry = null;
      if (from > s.to) continue;
      var last = i === segs.length - 1;
      if (!last && periodNext(periodStart(from, s.kind), s.kind) > addDays(s.to, 1)) {
        carry = from;
        continue;
      }
      out = out.concat(bucketizeRange(from, s.to, s.kind));
    }
    if (out.length > MAX_BARS) {
      var extra = out.length - MAX_BARS + 1;
      var merged = makeBucket("year", out[0].from, out[extra - 1].to);
      merged.merged = true;
      merged.label = bucketLabel(merged);
      out = [merged].concat(out.slice(extra));
    }
    return out;
  }
  function findBucket(buckets, date) {
    var lo = 0, hi = buckets.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (date < buckets[mid].from) hi = mid - 1;
      else if (date > buckets[mid].to) lo = mid + 1;
      else return buckets[mid];
    }
    return null;
  }
  /** Put every event into the one bucket holding its date; events outside the
   *  ladder (before `since`, past the horizon) are ignored. Returns `buckets`. */
  function assign(buckets, events, today) {
    var i;
    for (i = 0; i < buckets.length; i++) {
      buckets[i].events = [];
      buckets[i].counts = { happened: 0, cancelled: 0, scheduled: 0 };
    }
    for (i = 0; i < events.length; i++) {
      var b = findBucket(buckets, events[i].date);
      if (!b) continue;
      b.events.push(events[i]);
      b.counts[eventState(events[i], today)] += 1;
    }
    for (i = 0; i < buckets.length; i++) buckets[i].state = bucketState(buckets[i].counts);
    return buckets;
  }

  // ── headline & incidents ───────────────────────────────────────────────────
  /** The HEADLINE_DAYS days before today: how many events, how many cancelled. */
  function headline(events, today) {
    var from = addDays(today, -HEADLINE_DAYS);
    var total = 0, cancelled = 0;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.date < from || ev.date >= today) continue;
      total += 1;
      if (ev.cancelled) cancelled += 1;
    }
    var text;
    if (!total) {
      text = "keine Termine in den letzten " + HEADLINE_DAYS + " Tagen";
    } else if (cancelled) {
      text = cancelled + " von " + total + (total === 1 ? " Termin" : " Terminen") +
        " abgesagt · letzte " + HEADLINE_DAYS + " Tage";
    } else {
      text = "alles fand statt · " + total + (total === 1 ? " Termin" : " Termine") +
        " in den letzten " + HEADLINE_DAYS + " Tagen";
    }
    return { total: total, cancelled: cancelled, state: cancelled ? "degraded" : "ok", text: text };
  }
  /** Cancelled events, newest first (date desc, then id asc), optionally capped. */
  function incidents(events, limit) {
    var out = [];
    for (var i = 0; i < events.length; i++) if (events[i].cancelled) out.push(events[i]);
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return typeof limit === "number" ? out.slice(0, limit) : out;
  }

  // ── funding pulse ──────────────────────────────────────────────────────────
  /**
   * The pulse as dated months: levels[i] is the month pulse.start + i. Without
   * a valid `start` there is no time axis and nothing to show → []. Each entry
   * is bucket-shaped ({ key, kind, from, to, label }) plus month, level and the
   * delta against the previous month (null for the first).
   */
  function pulseMonths(pulse) {
    if (!pulse || typeof pulse.start !== "string" || !MONTH_RE.test(pulse.start) || !Array.isArray(pulse.levels)) {
      return [];
    }
    var out = [], prev = null;
    for (var i = 0; i < pulse.levels.length; i++) {
      var raw = Number(pulse.levels[i]);
      var level = isFinite(raw) ? Math.max(0, Math.min(7, Math.round(raw))) : 0;
      var from = addMonths(pulse.start + "-01", i);
      out.push({
        key: "pm:" + from.slice(0, 7),
        kind: "month",
        month: from.slice(0, 7),
        from: from,
        to: endOfMonth(from),
        label: monthLabel(from.slice(0, 7)),
        level: level,
        delta: prev === null ? null : (level > prev ? 1 : level < prev ? -1 : 0)
      });
      prev = level;
    }
    return out;
  }
  /**
   * The months folded onto ladder buckets: level = rounded mean of the months
   * inside, null where no month lies in the bucket (a gap, never a zero);
   * delta = sign against the previous bucket that had a level.
   */
  function pulseBuckets(months, buckets) {
    var out = [], prev = null;
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      var fromM = b.from.slice(0, 7), toM = b.to.slice(0, 7);
      var inside = [], sum = 0;
      for (var j = 0; j < months.length; j++) {
        if (months[j].month >= fromM && months[j].month <= toM) {
          inside.push(months[j]);
          sum += months[j].level;
        }
      }
      var level = inside.length ? Math.round(sum / inside.length) : null;
      var delta = level === null || prev === null ? null : (level > prev ? 1 : level < prev ? -1 : 0);
      if (level !== null) prev = level;
      out.push({
        key: b.key,
        kind: b.kind,
        from: b.from,
        to: b.to,
        merged: b.merged,
        label: b.label,
        level: level,
        delta: delta,
        months: inside
      });
    }
    return out;
  }

  return {
    MAX_BARS: MAX_BARS,
    WEEK_TIER_WEEKS: WEEK_TIER_WEEKS,
    MONTH_TIER_MONTHS: MONTH_TIER_MONTHS,
    QUARTER_TIER_MONTHS: QUARTER_TIER_MONTHS,
    FUTURE_WEEKS_CAP: FUTURE_WEEKS_CAP,
    HEADLINE_DAYS: HEADLINE_DAYS,
    addDays: addDays,
    addMonths: addMonths,
    endOfMonth: endOfMonth,
    isoWeek: isoWeek,
    isoWeekStart: isoWeekStart,
    formatDate: formatDate,
    monthLabel: monthLabel,
    eventState: eventState,
    stateWord: stateWord,
    trendWord: trendWord,
    bucketState: bucketState,
    bucketLabel: bucketLabel,
    rangeLabel: rangeLabel,
    countsText: countsText,
    finerKind: finerKind,
    bucketizeRange: bucketizeRange,
    ladder: ladder,
    assign: assign,
    headline: headline,
    incidents: incidents,
    pulseMonths: pulseMonths,
    pulseBuckets: pulseBuckets
  };
});
