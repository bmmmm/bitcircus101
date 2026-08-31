/**
 * ics-core.js — shared ICS parser used by BOTH the Node sync script
 * (scripts/sync-events.mjs) and the browser fallback (events.js).
 *
 * Single source of truth: edit the parser here and both consumers update. UMD
 * wrapper exposes `module.exports` under Node (imported by the .mjs sync script)
 * and a global `ICSCore` in the browser (loaded via <script> before events.js).
 *
 * Written in ES5 so the browser build needs no transpilation.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ICSCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HORIZON_DAYS = 120;
  var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function parseDate(v) {
    if (!v) return null;
    var y = +v.slice(0, 4), m = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
    if (v.length === 8) return new Date(y, m, d);
    var h = +v.slice(9, 11), mi = +v.slice(11, 13);
    return v.charAt(v.length - 1) === "Z"
      ? new Date(Date.UTC(y, m, d, h, mi))
      : new Date(y, m, d, h, mi);
  }

  function nthWeekday(year, month, wd, nth) {
    var d;
    if (nth < 0) {
      // Negative ordinals count back from the end of the month: -1 is the last
      // matching weekday, -2 the one before it (RFC5545 §3.3.10 BYDAY).
      d = new Date(year, month + 1, 0); // day 0 of next month = last day of this one
      while (d.getDay() !== wd) d.setDate(d.getDate() - 1);
      d.setDate(d.getDate() + (nth + 1) * 7);
    } else {
      d = new Date(year, month, 1);
      while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
      d.setDate(d.getDate() + (nth - 1) * 7);
    }
    return d.getMonth() === month ? d : null;
  }

  function expandRRule(dtstart, rule, exdates) {
    var horizon = new Date();
    horizon.setDate(horizon.getDate() + HORIZON_DAYS);
    var p = {};
    rule.split(";").forEach(function (s) {
      var i = s.indexOf("=");
      if (i > -1) p[s.slice(0, i)] = s.slice(i + 1);
    });
    var end = p.UNTIL ? parseDate(p.UNTIL) : null;
    // A date-only UNTIL (no "T") bounds the whole day per RFC5545; without pushing
    // it to end-of-day a timed occurrence on the UNTIL date (19:00 > 00:00) is lost.
    if (end && p.UNTIL.indexOf("T") === -1) end.setHours(23, 59, 59, 999);
    var limit = end && end < horizon ? end : horizon;
    var max = p.COUNT ? +p.COUNT : 200;
    var exSet = {};
    exdates.forEach(function (d) { exSet[d.toDateString()] = true; });
    var out = [];
    var interval = p.INTERVAL ? +p.INTERVAL : 1; // shared by the WEEKLY, MONTHLY-by-monthday + DAILY branches

    if (p.FREQ === "WEEKLY") {
      // BYDAY may list several weekdays ("MO,WE,FR") — expand every one, not just
      // the last. Each token may carry an ordinal (ignored for WEEKLY): "2MO" -> MO.
      var wdays = {};
      if (p.BYDAY) {
        p.BYDAY.split(",").forEach(function (tok) {
          var code = tok.replace(/[^A-Za-z]/g, "").slice(-2).toUpperCase();
          if (WD[code] != null) wdays[WD[code]] = true;
        });
      }
      if (!Object.keys(wdays).length) wdays[dtstart.getDay()] = true;
      // Walk day by day (cheap over the 120-day horizon), emitting each matching
      // weekday. INTERVAL keeps every Nth week, counted from dtstart's week.
      var weekRef = new Date(dtstart);
      weekRef.setHours(0, 0, 0, 0);
      weekRef.setDate(weekRef.getDate() - weekRef.getDay()); // Sunday of start week
      var cur = new Date(dtstart);
      var genW = 0;
      while (cur <= limit && genW < max) {
        if (cur >= dtstart && wdays[cur.getDay()]) {
          var wkStart = new Date(cur);
          wkStart.setHours(0, 0, 0, 0);
          wkStart.setDate(wkStart.getDate() - wkStart.getDay());
          var weeksApart = Math.round((wkStart - weekRef) / 604800000);
          if (weeksApart % interval === 0) {
            // A matching slot counts toward COUNT even when EXDATE-excluded (RFC5545).
            genW++;
            if (!exSet[cur.toDateString()]) out.push(new Date(cur));
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    } else if (p.FREQ === "MONTHLY" && p.BYDAY) {
      // Support "3TH" (nth in BYDAY) and "TH" + BYSETPOS=3, each with an optional
      // minus for end-of-month counting ("-1WE" = last Wednesday, BYSETPOS=-1).
      // Without the sign in this regex "-1WE" fell through to nth=null and the whole
      // series expanded to nothing — silently, since the branch below just skipped.
      var m = p.BYDAY.match(/^(-?\d+)([A-Z]{2})$/);
      var nth = m ? +m[1] : (p.BYSETPOS ? +p.BYSETPOS : null);
      var dayCode = m ? m[2] : p.BYDAY.replace(/[^A-Z]/g, "").slice(-2);
      var twd = WD[dayCode];
      if (!nth || twd == null) {
        // Reachable for multi-day BYDAY lists ("MO,WE") and unknown day codes. Warn
        // rather than drop the series without a trace.
        console.warn(
          "[rrule] unsupported MONTHLY BYDAY=" + p.BYDAY +
          (p.BYSETPOS ? ";BYSETPOS=" + p.BYSETPOS : "") + " — event not expanded"
        );
      }
      if (nth && twd != null) {
        var mo = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
        var genM = 0;
        while (mo <= limit && genM < max) {
          var d = nthWeekday(mo.getFullYear(), mo.getMonth(), twd, nth);
          if (d) {
            d.setHours(dtstart.getHours(), dtstart.getMinutes(), 0, 0);
            if (d >= dtstart && d <= limit) {
              genM++; // counts toward COUNT regardless of EXDATE (RFC5545)
              if (!exSet[d.toDateString()]) out.push(new Date(d));
            }
          }
          mo.setMonth(mo.getMonth() + 1);
        }
      }
    } else if (p.FREQ === "MONTHLY") {
      // MONTHLY without BYDAY recurs by day-of-month: the BYMONTHDAY list when
      // given (negative values count from the month's end per RFC5545 §3.3.10 —
      // -1 is the last day), else DTSTART's day. A month lacking the day
      // (BYMONTHDAY=31 in February) is skipped, not clamped, and the skipped
      // slot does not count toward COUNT — RFC5545 ignores invalid dates.
      // Before this branch existed such series fell through to the warn below
      // and silently vanished from the site ("jeden 15." never rendered).
      var mdays = [];
      if (p.BYMONTHDAY) {
        p.BYMONTHDAY.split(",").forEach(function (tok) {
          var v = parseInt(tok, 10);
          if (v >= -31 && v <= 31 && v !== 0 && mdays.indexOf(v) === -1) mdays.push(v);
        });
      }
      if (!mdays.length) mdays.push(dtstart.getDate());
      var moM = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
      var monthsFrom = 0; // INTERVAL counts months from dtstart's month
      var genMd = 0;
      while (moM <= limit && genMd < max) {
        if (monthsFrom % interval === 0) {
          var dim = new Date(moM.getFullYear(), moM.getMonth() + 1, 0).getDate();
          // Resolve the monthdays for THIS month (negatives depend on its
          // length), dedupe (-1 and 31 collide in a 31-day month), keep
          // chronological order within the month.
          var resolved = [];
          for (var mi = 0; mi < mdays.length; mi++) {
            var day = mdays[mi] > 0 ? mdays[mi] : dim + mdays[mi] + 1;
            if (day >= 1 && day <= dim && resolved.indexOf(day) === -1) resolved.push(day);
          }
          resolved.sort(function (a, b) { return a - b; });
          // BYSETPOS picks one instance out of the month's set (RFC5545): the
          // real calendar carries "BYSETPOS=-1;BYMONTHDAY=28,29,30" = the last
          // existing of those days — month-end via Apple-style rules.
          if (p.BYSETPOS) {
            var pos = +p.BYSETPOS;
            var pick = pos > 0 ? resolved[pos - 1] : resolved[resolved.length + pos];
            resolved = pick != null ? [pick] : [];
          }
          for (var ri = 0; ri < resolved.length && genMd < max; ri++) {
            var dmd = new Date(
              moM.getFullYear(), moM.getMonth(), resolved[ri],
              dtstart.getHours(), dtstart.getMinutes(), 0, 0
            );
            if (dmd >= dtstart && dmd <= limit) {
              genMd++; // counts toward COUNT regardless of EXDATE (RFC5545)
              if (!exSet[dmd.toDateString()]) out.push(new Date(dmd));
            }
          }
        }
        moM.setMonth(moM.getMonth() + 1);
        monthsFrom++;
      }
    } else if (p.FREQ === "DAILY") {
      var cd = new Date(dtstart);
      var genD = 0;
      while (cd <= limit && genD < max) {
        genD++; // counts toward COUNT regardless of EXDATE (RFC5545)
        if (!exSet[cd.toDateString()]) out.push(new Date(cd));
        cd.setDate(cd.getDate() + interval);
      }
    } else if (p.FREQ === "YEARLY") {
      var cy = new Date(dtstart);
      var genY = 0;
      while (cy <= limit && genY < max) {
        genY++; // counts toward COUNT regardless of EXDATE (RFC5545)
        if (!exSet[cy.toDateString()]) out.push(new Date(cy));
        cy.setFullYear(cy.getFullYear() + 1);
      }
    } else {
      // Hourly, minutely, etc. are not expanded — surface it instead of silently
      // dropping the event so a missing series is debuggable from CI logs.
      console.warn("[rrule] unsupported FREQ=" + (p.FREQ || "?") + " — event not expanded");
    }
    return out;
  }

  /**
   * Parse an RFC5545 DURATION ("PT2H", "P1DT1H30M", "P1W") into milliseconds.
   * Returns null for an unparseable value. Weeks and days are counted as fixed
   * 7-day / 24-hour spans (good enough for the short-lived events this site lists;
   * no DST-aware day arithmetic).
   */
  function parseDuration(v) {
    if (!v) return null;
    var m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    // Reject a value with no time components at all (bare "P"/"PT") — those carry no duration.
    if (!m || !m.slice(2).some(function (g) { return g != null; })) return null;
    var sign = m[1] === "-" ? -1 : 1;
    var secs = +(m[2] || 0) * 604800 + +(m[3] || 0) * 86400 +
               +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0);
    return sign * secs * 1000;
  }

  function clean(s) {
    // Unescape RFC5545 text escapes in a single pass. Crucially "\\" is consumed
    // atomically with its escaped char, so a literal backslash is never mistaken
    // for a "\n" newline marker (e.g. "C:\\nope" -> "C:\nope", not "C:\ ope").
    return s.replace(/\\([\\;,nN])/g, function (_, c) {
      return c === "n" || c === "N" ? " " : c;
    }).trim();
  }

  /** Pull TZID parameter out of a property like "DTSTART;TZID=Europe/Berlin" */
  function parseTzid(rawKey) {
    var m = rawKey.match(/TZID=([^;:]+)/i);
    return m ? m[1] : null;
  }

  var tzidWarned = {};

  /**
   * Parse VEVENTs into a flat list. Extracts the full field superset
   * (uid/url/categories/tzid); consumers ignore what they don't need.
   * Recurring events are expanded into one entry per occurrence.
   */
  function parseICS(text, sourceId) {
    sourceId = sourceId || "?";
    var lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    var events = [];
    var ev = null;

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line === "BEGIN:VEVENT") { ev = { exdates: [] }; continue; }
      if (line === "END:VEVENT") {
        if (!ev || !ev.dtstart) { ev = null; continue; }
        var dtstart = parseDate(ev.dtstart);
        if (!dtstart) { ev = null; continue; }
        var allDay = ev.dtstart.indexOf("T") === -1;
        // Duration between start and end, reused for every RRULE instance. Prefer an
        // explicit DTEND; fall back to DURATION; leave null when the source gives neither
        // (consumers then apply their own default). All-day DTEND is the exclusive next
        // day per RFC5545, so its span is a whole number of days.
        var durationMs = null;
        var dtend = ev.dtend ? parseDate(ev.dtend) : null;
        if (dtend) durationMs = dtend - dtstart;
        else if (ev.duration) durationMs = parseDuration(ev.duration);
        // Warn (once per source/zone) for foreign timezones — values stay floating local
        if (ev.tzid && ev.tzid !== "Europe/Berlin" && ev.dtstart.charAt(ev.dtstart.length - 1) !== "Z") {
          var wkey = sourceId + "|" + ev.tzid;
          if (!tzidWarned[wkey]) {
            tzidWarned[wkey] = true;
            console.warn("[" + sourceId + "] non-Europe/Berlin TZID seen (" + ev.tzid + "); times treated as local");
          }
        }
        var base = {
          uid: ev.uid || "",
          url: ev.url || "",
          summary: clean(ev.summary || "(kein Titel)"),
          description: clean(ev.description || ""),
          location: clean(ev.location || ""),
          categories: ev.categories || "",
          allDay: allDay,
        };
        if (ev.rrule) {
          expandRRule(dtstart, ev.rrule, ev.exdates).forEach(function (d) {
            var inst = {};
            for (var k in base) inst[k] = base[k];
            inst.dtstart = d;
            inst.dtend = durationMs != null ? new Date(d.getTime() + durationMs) : null;
            events.push(inst);
          });
        } else {
          base.dtstart = dtstart;
          base.dtend = durationMs != null ? new Date(dtstart.getTime() + durationMs) : null;
          events.push(base);
        }
        ev = null; continue;
      }
      if (!ev) continue;
      var ci = line.indexOf(":");
      if (ci === -1) continue;
      var rawKey = line.slice(0, ci);
      var key = rawKey.split(";")[0].toUpperCase();
      var val = line.slice(ci + 1);
      if (key === "DTSTART") { ev.dtstart = val; ev.tzid = parseTzid(rawKey); }
      else if (key === "DTEND") ev.dtend = val;
      else if (key === "DURATION") ev.duration = val;
      else if (key === "SUMMARY") ev.summary = val;
      else if (key === "DESCRIPTION") ev.description = val;
      else if (key === "LOCATION") ev.location = val;
      else if (key === "CATEGORIES") ev.categories = val;
      else if (key === "UID") ev.uid = val.trim();
      else if (key === "URL") {
        var u = val.trim();
        // Leave a root- or protocol-relative path ("/x", "//x") alone; only prefix a
        // bare host, so the result never becomes "https:///x". Matches httpUrl() in
        // events.js so the sync output and the browser fallback agree.
        ev.url = u && u.charAt(0) !== "/" && !/^https?:\/\//i.test(u) ? "https://" + u : u;
      }
      else if (key === "RRULE") ev.rrule = val;
      else if (key === "EXDATE") {
        val.split(",").forEach(function (v) {
          var d = parseDate(v.trim());
          if (d) ev.exdates.push(d);
        });
      }
    }
    return events;
  }

  /**
   * Stable DOM-anchor / RSS-permalink id for an event card. Shared so the feed's
   * <link> deep-links to exactly the anchor events.js renders (no slug drift).
   */
  function eventAnchor(card) {
    var slug = card.date + "-" + (card.title || "").toLowerCase()
      .replace(/[^a-z0-9äöü]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 40);
    return "ev-" + slug;
  }

  return {
    parseDate: parseDate,
    parseDuration: parseDuration,
    nthWeekday: nthWeekday,
    expandRRule: expandRRule,
    clean: clean,
    parseICS: parseICS,
    eventAnchor: eventAnchor,
  };
});
