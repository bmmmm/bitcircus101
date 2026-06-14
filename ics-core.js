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
    var d = new Date(year, month, 1);
    while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + (nth - 1) * 7);
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
    var limit = end && end < horizon ? end : horizon;
    var max = p.COUNT ? +p.COUNT : 200;
    var exSet = {};
    exdates.forEach(function (d) { exSet[d.toDateString()] = true; });
    var out = [];
    var interval = p.INTERVAL ? +p.INTERVAL : 1; // shared by the WEEKLY + DAILY branches

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
      while (cur <= limit && out.length < max) {
        if (cur >= dtstart && wdays[cur.getDay()]) {
          var wkStart = new Date(cur);
          wkStart.setHours(0, 0, 0, 0);
          wkStart.setDate(wkStart.getDate() - wkStart.getDay());
          var weeksApart = Math.round((wkStart - weekRef) / 604800000);
          if (weeksApart % interval === 0 && !exSet[cur.toDateString()]) {
            out.push(new Date(cur));
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    } else if (p.FREQ === "MONTHLY" && p.BYDAY) {
      // Support both "3TH" (nth in BYDAY) and "TH" + BYSETPOS=3
      var m = p.BYDAY.match(/^(\d+)([A-Z]{2})$/);
      var nth = m ? +m[1] : (p.BYSETPOS ? +p.BYSETPOS : null);
      var dayCode = m ? m[2] : p.BYDAY.replace(/\d/g, "").slice(-2);
      var twd = WD[dayCode];
      if (nth && twd != null) {
        var mo = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
        while (mo <= limit && out.length < max) {
          var d = nthWeekday(mo.getFullYear(), mo.getMonth(), twd, nth);
          if (d) {
            d.setHours(dtstart.getHours(), dtstart.getMinutes(), 0, 0);
            if (d >= dtstart && d <= limit && !exSet[d.toDateString()]) out.push(new Date(d));
          }
          mo.setMonth(mo.getMonth() + 1);
        }
      }
    } else if (p.FREQ === "DAILY") {
      var cd = new Date(dtstart);
      while (cd <= limit && out.length < max) {
        if (!exSet[cd.toDateString()]) out.push(new Date(cd));
        cd.setDate(cd.getDate() + interval);
      }
    } else if (p.FREQ === "YEARLY") {
      var cy = new Date(dtstart);
      while (cy <= limit && out.length < max) {
        if (!exSet[cy.toDateString()]) out.push(new Date(cy));
        cy.setFullYear(cy.getFullYear() + 1);
      }
    } else {
      // MONTHLY-by-monthday, hourly, etc. are not expanded — surface it instead of
      // silently dropping the event so a missing series is debuggable from CI logs.
      console.warn("[rrule] unsupported FREQ=" + (p.FREQ || "?") + " — event not expanded");
    }
    return out;
  }

  function clean(s) {
    return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
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
            events.push(inst);
          });
        } else {
          base.dtstart = dtstart;
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
      else if (key === "SUMMARY") ev.summary = val;
      else if (key === "DESCRIPTION") ev.description = val;
      else if (key === "LOCATION") ev.location = val;
      else if (key === "CATEGORIES") ev.categories = val;
      else if (key === "UID") ev.uid = val.trim();
      else if (key === "URL") {
        var u = val.trim();
        ev.url = u && !/^https?:\/\//i.test(u) ? "https://" + u : u;
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
    HORIZON_DAYS: HORIZON_DAYS,
    parseDate: parseDate,
    nthWeekday: nthWeekday,
    expandRRule: expandRRule,
    clean: clean,
    parseTzid: parseTzid,
    parseICS: parseICS,
    eventAnchor: eventAnchor,
  };
});
