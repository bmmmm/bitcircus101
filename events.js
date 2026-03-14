/**
 * events.js — bitcircus101 ICS calendar renderer
 * Fetches Nextcloud public calendar, parses VEVENTs, renders upcoming events.
 */
(function () {
  "use strict";

  var ICS_URL =
    "https://nc.6bm.de/remote.php/dav/public-calendars/DCaFSYECrcTJRJjC?export";
  var MONTHS = [
    "JANUAR", "FEBRUAR", "MÄRZ", "APRIL", "MAI", "JUNI",
    "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER",
  ];
  var DAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
  var HORIZON = 120;

  // ── ICS parser ──────────────────────────────────────────────────────────────

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

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
    horizon.setDate(horizon.getDate() + HORIZON);
    var p = {};
    rule.split(";").forEach(function (s) {
      var i = s.indexOf("=");
      if (i > -1) p[s.slice(0, i)] = s.slice(i + 1);
    });
    var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    var end = p.UNTIL ? parseDate(p.UNTIL) : null;
    if (!end || end > horizon) end = horizon;
    var max = p.COUNT ? +p.COUNT : 200;
    var exSet = {};
    exdates.forEach(function (d) { exSet[d.toDateString()] = true; });
    var out = [];

    if (p.FREQ === "WEEKLY") {
      var wd = p.BYDAY
        ? WD[p.BYDAY.replace(/\d/g, "").slice(-2)]
        : dtstart.getDay();
      if (wd === undefined) wd = dtstart.getDay();
      var cur = new Date(dtstart);
      while (cur.getDay() !== wd) cur.setDate(cur.getDate() + 1);
      while (cur <= end && out.length < max) {
        if (!exSet[cur.toDateString()]) out.push(new Date(cur));
        cur.setDate(cur.getDate() + 7);
      }
    } else if (p.FREQ === "MONTHLY" && p.BYDAY) {
      var m = p.BYDAY.match(/^(\d+)([A-Z]{2})$/);
      if (m) {
        var nth = +m[1], twd = WD[m[2]];
        var mo = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
        while (mo <= end && out.length < max) {
          var d = nthWeekday(mo.getFullYear(), mo.getMonth(), twd, nth);
          if (d) {
            d.setHours(dtstart.getHours(), dtstart.getMinutes(), 0, 0);
            if (d >= dtstart && d <= end && !exSet[d.toDateString()])
              out.push(new Date(d));
          }
          mo.setMonth(mo.getMonth() + 1);
        }
      }
    }
    return out;
  }

  function clean(s) {
    return s
      .replace(/\\n/gi, " ")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .trim();
  }

  function parseICS(text) {
    var lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    var events = [];
    var ev = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === "BEGIN:VEVENT") {
        ev = { exdates: [] };
        continue;
      }
      if (line === "END:VEVENT") {
        if (!ev || !ev.dtstart) { ev = null; continue; }
        var dtstart = parseDate(ev.dtstart);
        if (!dtstart) { ev = null; continue; }
        var dtend = ev.dtend ? parseDate(ev.dtend) : null;
        var allDay = !ev.dtstart.includes("T");
        var base = {
          summary: clean(ev.summary || "(kein Titel)"),
          description: clean(ev.description || ""),
          location: clean(ev.location || ""),
          allDay: allDay,
        };
        if (ev.rrule) {
          var dur = dtend ? dtend - dtstart : 7200000;
          expandRRule(dtstart, ev.rrule, ev.exdates).forEach(function (d) {
            events.push({
              summary: base.summary,
              description: base.description,
              location: base.location,
              allDay: base.allDay,
              dtstart: d,
              dtend: new Date(d.getTime() + dur),
            });
          });
        } else {
          base.dtstart = dtstart;
          base.dtend = dtend;
          events.push(base);
        }
        ev = null;
        continue;
      }
      if (!ev) continue;
      var ci = line.indexOf(":");
      if (ci === -1) continue;
      var key = line.slice(0, ci).split(";")[0].toUpperCase();
      var val = line.slice(ci + 1);
      if (key === "DTSTART") ev.dtstart = val;
      else if (key === "DTEND") ev.dtend = val;
      else if (key === "SUMMARY") ev.summary = val;
      else if (key === "DESCRIPTION") ev.description = val;
      else if (key === "LOCATION") ev.location = val;
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

  // ── Render ──────────────────────────────────────────────────────────────────

  function esc(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderEvents(events, el) {
    var now = new Date();
    var upcoming = events
      .filter(function (e) { return e.dtstart > now; })
      .sort(function (a, b) { return a.dtstart - b.dtstart; })
      .slice(0, 40);

    if (!upcoming.length) {
      el.innerHTML =
        '<p class="events-empty">Keine kommenden Termine gefunden.</p>' +
        '<p><a href="https://nc.6bm.de/apps/calendar/p/DCaFSYECrcTJRJjC" ' +
        'target="_blank" rel="noopener">Kalender direkt öffnen ↗</a></p>';
      return;
    }

    var groups = [];
    var groupMap = {};
    upcoming.forEach(function (e) {
      var k = e.dtstart.getFullYear() + "-" + pad(e.dtstart.getMonth() + 1);
      if (!groupMap[k]) { groupMap[k] = []; groups.push(k); }
      groupMap[k].push(e);
    });

    var html = '<div class="events-feed">';
    groups.forEach(function (k) {
      var parts = k.split("-");
      var monthName = MONTHS[+parts[1] - 1];
      html += '<section class="events-month">';
      html +=
        '<h2 class="events-month__label">[ ' +
        monthName + " " + parts[0] + " ]</h2>";
      groupMap[k].forEach(function (e) {
        var dow = DAYS[e.dtstart.getDay()];
        var date =
          pad(e.dtstart.getDate()) + "." +
          pad(e.dtstart.getMonth() + 1) + ".";
        var time = e.allDay
          ? ""
          : pad(e.dtstart.getHours()) + ":" + pad(e.dtstart.getMinutes());
        var iso = e.dtstart.toISOString().slice(0, 10);
        html += '<article class="event-entry">';
        html += '<div class="event-entry__when">';
        html += '<span class="event-entry__dow">' + dow + "</span>";
        html +=
          '<time class="event-entry__date" datetime="' + iso + '">' +
          date + "</time>";
        html += "</div>";
        html += '<div class="event-entry__body">';
        html +=
          '<span class="event-entry__title">' + esc(e.summary) + "</span>";
        if (time) {
          html +=
            '<span class="event-entry__meta">' + time + "</span>";
        }
        html += "</div>";
        html += "</article>";
      });
      html += "</section>";
    });
    html += "</div>";
    el.innerHTML = html;
  }

  function renderError(el) {
    el.innerHTML =
      '<div class="events-fallback">' +
      '<p class="events-fallback__cmd">' +
      "$ calendar --fetch " +
      '<span class="events-fallback__err">CORS_ERR</span></p>' +
      "<p>Termine direkt ansehen:</p>" +
      '<p><a href="https://nc.6bm.de/apps/calendar/p/DCaFSYECrcTJRJjC" ' +
      'target="_blank" rel="noopener">Kalender öffnen ↗</a></p>' +
      "</div>";
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    var el = document.getElementById("events-list");
    if (!el) return;

    el.innerHTML =
      '<p class="events-loading">' +
      '<span class="events-loading__cmd">$ calendar --fetch</span>' +
      '<span class="events-cursor">▋</span></p>';

    fetch(ICS_URL, { mode: "cors" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var events = parseICS(text);
        renderEvents(events, el);
      })
      .catch(function () {
        renderError(el);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
