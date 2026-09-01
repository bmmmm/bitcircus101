/**
 * kiosk.js — wall-display view of the bitcircus101 events (kiosk/index.html).
 *
 * JSON only, deliberately: the kiosk lives on the same origin as
 * events-data.json — if that is gone the site is broken anyway, and the right
 * wall-display behavior is to hold the last good data and say so, not to grow
 * an ICS fallback. Loads neither ics-core.js nor events.js; the few shared
 * lines (pad, esc, day/month names) are re-declared locally, the same way
 * main.js does for the homepage preview.
 *
 * The wall shows what the events actually carry — description, location, the
 * full time window, all tags — not just a title line. Two shapes follow from
 * the real data:
 *
 *   - Parallel events are the NORM. Of the days carrying more than one event,
 *     every single one has a real time overlap (measured 2026-09-01: 11 of 11),
 *     eight of them the same recurring pair. So overlapping neighbours are
 *     bracketed and labelled "gleichzeitig" instead of being stacked as if they
 *     followed each other.
 *   - Descriptions and locations carry raw URLs (a matrix.to link with query
 *     args, an OSM permalink used AS the location). Nobody reads a URL off a
 *     wall, so cleanText() strips them from the running text.
 *
 * An expanded list fits fewer events per screen, so it pages — and the page
 * breaks are MEASURED against the screen rather than counted, because how many
 * events fit depends on how long their descriptions are. ?rows=N caps the
 * count on top of that, PAGE_MS flips through the pages.
 */
(function () {
  "use strict";

  var DATA_URL = "../events-data.json";
  var REFRESH_MS = 300000; // 5 min — the sync cron runs every 30, this is cheap
  var CLOCK_MS = 1000;
  var PAGE_MS = 20000; // page flip — long enough to read a description
  var RELOAD_MS = 21600000; // 6 h watchdog reload to pick up new CSS/JS
  // lastSync older than this → "daten alt". Not 3 h: the sync cron asks for
  // every 30 min but GitHub really fires it every 2-3 h and never catches up
  // (measured 2026-08-06, largest observed gap ~3 h 10 min), so a 3 h threshold
  // cries wolf on a healthy feed. 5 h clears that jitter and still warns an
  // hour before the external Uptime Kuma monitor (6 h) escalates.
  var STALE_AFTER_MS = 5 * 3600000;
  // Fallback window for the "läuft" marker when a source gave no end at all.
  // Only that case — endTime is present on 39 of 40 events in the real feed
  // (measured 2026-09-01), so the marker gates on the real end and no longer
  // drops off a 18:00–22:00 event at 21:00 or clings to one that ended an hour
  // ago.
  var NO_END_WINDOW_MS = 3 * 3600000;
  var MONTHS = [
    "JAN", "FEB", "MÄR", "APR", "MAI", "JUN",
    "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ",
  ];
  var DAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];

  var lastGood = null;   // { events, lastSync, at } — kept across failed fetches
  var failCount = 0;
  var lastClockText = "";
  var page = 0;
  var pageCount = 1;

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Wall-safe running text: drop URLs, collapse whitespace, and lose the
   * punctuation the removed URL left dangling. A field that was nothing but a
   * link (two descriptions in the real feed) comes back empty and is skipped.
   */
  function cleanText(s) {
    if (!s) return "";
    return String(s)
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      // A link in mid-sentence leaves its punctuation orphaned next to the
      // next one ("Kommt vorbei: — wir haben Mate"): drop a separator that now
      // runs straight into another.
      .replace(/\s*[-–—:;,·|]\s+(?=[-–—:;,·|]\s)/g, " ")
      .replace(/\s*[-–—:;,·|]+\s*$/, "")
      .replace(/^\s*[-–—:;,·|]+\s*/, "")
      .trim();
  }

  // ?rows=N caps how many events a page may hold (1–12, default 8). It is an
  // upper bound, not a target: render() shrinks the page until it actually fits
  // the screen, because how many events fit depends on how long their
  // descriptions are, and nobody is going to re-tune a query parameter on a
  // wall when a calendar entry grows.
  function rowCap() {
    var m = /[?&]rows=(\d+)/.exec(window.location.search);
    var n = m ? parseInt(m[1], 10) : 8;
    return Math.max(1, Math.min(12, isNaN(n) ? 8 : n));
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function dayLabel(d, today, tomorrow) {
    var key = dateKey(d);
    if (key === today) return "HEUTE";
    if (key === tomorrow) return "MORGEN";
    return DAYS[d.getDay()] + " " + pad(d.getDate()) + "." + MONTHS[d.getMonth()] + ".";
  }

  function startMs(e) {
    if (!e.time) return new Date(e.date + "T00:00:00").getTime();
    return new Date(e.date + "T" + e.time + ":00").getTime();
  }

  /** End of the event, or NaN when the source gave neither an end nor a time. */
  function endMs(e) {
    if (!e.time) return new Date(e.date + "T23:59:59").getTime(); // all-day
    if (!e.endTime) return NaN;
    return new Date((e.endDate || e.date) + "T" + e.endTime + ":00").getTime();
  }

  function isRunning(e, now) {
    var s = startMs(e);
    if (isNaN(s) || now < s) return false;
    var end = endMs(e);
    if (isNaN(end)) return now - s < NO_END_WINDOW_MS;
    return now < end;
  }

  function timeLabel(e) {
    if (!e.time) return "ganztägig";
    if (!e.endTime || e.endTime === e.time) return e.time;
    return e.time + "–" + e.endTime;
  }

  /**
   * Upcoming events → [{ date, label, groups: [[event, …], …] }].
   * A group holds consecutive same-day events whose [start, end) windows
   * overlap; a group of one is the ordinary case.
   */
  function groupDays(rows, today, tomorrow) {
    var days = [];
    var byDate = {};
    rows.forEach(function (e) {
      if (!byDate[e.date]) {
        byDate[e.date] = { date: e.date, label: dayLabel(new Date(e.date + "T00:00:00"), today, tomorrow), groups: [] };
        days.push(byDate[e.date]);
      }
      var day = byDate[e.date];
      var last = day.groups[day.groups.length - 1];
      if (last) {
        // Against the group's LATEST end, not its last member's: a long event
        // (18:00–22:00) keeps collecting the short ones that start inside it,
        // even after one of them has already ended.
        var groupEnd = -Infinity;
        var sameStart = false;
        last.forEach(function (p) {
          var pe = endMs(p);
          if (!isNaN(pe) && pe > groupEnd) groupEnd = pe;
          if (startMs(p) === startMs(e)) sameStart = true;
        });
        // No end known anywhere in the group → treat as sequential rather than
        // invent an overlap; a shared start always counts as parallel.
        if (sameStart || startMs(e) < groupEnd) {
          last.push(e);
          return;
        }
      }
      day.groups.push([e]);
    });
    return days;
  }

  /**
   * Flatten the day groups into one ordered list of page-able units, each
   * carrying the day it belongs to. Pagination works on these, so a parallel
   * bundle is one indivisible unit.
   */
  function flatten(days) {
    var flat = [];
    days.forEach(function (day) {
      day.groups.forEach(function (group) {
        flat.push({ date: day.date, label: day.label, group: group });
      });
    });
    return flat;
  }

  function eventHtml(e, now) {
    var running = isRunning(e, now);
    var html = '<article class="kiosk-ev' + (running ? " kiosk-ev--now" : "") + '">';
    html += '<span class="kiosk-ev__time">' + esc(timeLabel(e)) + "</span>";
    html += '<h2 class="kiosk-ev__title">' + esc(e.title) + "</h2>";

    var side = "";
    if (e.source && e.source !== "bitcircus101") {
      side = esc(e.source);
    } else if (e.tags && e.tags.length) {
      side = esc(e.tags.join(" "));
    }
    html += '<span class="kiosk-ev__side">' + side + "</span>";

    var desc = cleanText(e.description);
    if (desc) html += '<p class="kiosk-ev__desc">' + esc(desc) + "</p>";

    var loc = cleanText(e.location);
    if (loc) html += '<p class="kiosk-ev__loc">' + esc(loc) + "</p>";

    html += "</article>";
    return html;
  }

  function groupHtml(group, nowMs) {
    var parallel = group.length > 1;
    var html = '<div class="kiosk-group' + (parallel ? " kiosk-par" : "") + '">';
    group.forEach(function (e, i) {
      if (parallel && i > 0) {
        html += '<p class="kiosk-par__label">+ gleichzeitig</p>';
      }
      html += eventHtml(e, nowMs);
    });
    return html + "</div>";
  }

  function render() {
    var el = document.getElementById("kiosk-list");
    if (!el) return;

    if (!lastGood) {
      el.innerHTML = '<p class="kiosk-offline">keine daten — bitcircus101.de/termine</p>';
      el.removeAttribute("aria-busy");
      pageCount = 1;
      return;
    }

    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var today = dateKey(now);
    var tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    var rows = lastGood.events
      .filter(function (e) {
        return new Date(e.date + "T23:59:59") >= startOfToday;
      })
      .sort(function (a, b) {
        return (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));
      });

    if (!rows.length) {
      el.innerHTML = '<p class="kiosk-empty">keine termine im blick</p>';
      el.removeAttribute("aria-busy");
      pageCount = 1;
      return;
    }

    var flat = flatten(groupDays(rows, today, tomorrow));
    var nowMs = now.getTime();
    var cap = rowCap();

    /**
     * Fill the list from `start` until the next unit would not fit on screen,
     * and report how many units landed. The fit is MEASURED, not derived from a
     * row count: how many events fit depends on how long their descriptions
     * are. A unit that is taller than the screen all by itself still takes its
     * page and is clipped by the CSS, so this always advances.
     */
    function paintFrom(start) {
      el.innerHTML = "";
      var section = null;
      var curDate = null;
      var events = 0;
      var i = start;
      for (; i < flat.length; i++) {
        var item = flat[i];
        if (i > start && events + item.group.length > cap) break;
        var before = el.innerHTML;
        if (item.date !== curDate) {
          el.insertAdjacentHTML("beforeend",
            '<section class="kiosk-day' + (item.date === today ? " kiosk-day--today" : "") +
            '"><h1 class="kiosk-day__label"><span>' + esc(item.label) + "</span></h1></section>");
          section = el.lastElementChild;
          curDate = item.date;
        }
        section.insertAdjacentHTML("beforeend", groupHtml(item.group, nowMs));
        // clientHeight 0 means the list has no layout yet — measuring against it
        // would call every single unit an overflow and put one event per page.
        // Fall back to the cap until a real height exists (a resize or the next
        // refresh re-renders).
        if (i > start && el.clientHeight > 0 && el.scrollHeight > el.clientHeight) {
          el.innerHTML = before; // roll back the unit that broke the fit
          break;
        }
        events += item.group.length;
      }
      return i - start;
    }

    // Page boundaries come from the same measurement, walked once — so they do
    // not depend on which page is currently up. Deriving them per page is what
    // made the count wobble between renders and stranded the rotation on page 1.
    var starts = [0];
    var idx = 0;
    while (idx < flat.length) {
      idx += Math.max(1, paintFrom(idx));
      if (idx < flat.length) starts.push(idx);
    }
    pageCount = starts.length;
    if (page >= pageCount) page = 0;
    paintFrom(starts[page]);
    el.removeAttribute("aria-busy");
  }

  function status() {
    var el = document.getElementById("kiosk-status");
    if (!el) return;
    var parts = [];
    if (lastGood) {
      var d = new Date(lastGood.at);
      parts.push("stand: " + pad(d.getHours()) + ":" + pad(d.getMinutes()));
      if (lastGood.lastSync &&
          Date.now() - new Date(lastGood.lastSync).getTime() > STALE_AFTER_MS) {
        parts.push("⚠ daten alt");
      }
    }
    if (pageCount > 1) {
      parts.push("seite " + (page + 1) + "/" + pageCount);
    }
    if (failCount >= 3) {
      parts.push("⚠ offline seit " + failCount * (REFRESH_MS / 60000) + " min");
    }
    parts.push("quelle: bitcircus101.de/termine");
    el.textContent = parts.join(" · ");
  }

  function flipPage() {
    if (pageCount < 2) return;
    page = (page + 1) % pageCount;
    render();
    status();
  }

  function load() {
    // Minute-grained buster + no-store so a wall browser never serves a
    // week-old cached JSON.
    fetch(DATA_URL + "?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var events = Array.isArray(data) ? data : data.events;
        if (!events) throw new Error("no events");
        lastGood = {
          events: events,
          lastSync: Array.isArray(data) ? null : data.lastSync,
          at: Date.now(),
        };
        failCount = 0;
        // Fresh data can change the page count under us — start over at the top
        // rather than land the wall on a page that no longer means anything.
        page = 0;
        render();
        status();
      })
      .catch(function () {
        // Keep the last good data on screen; only the status line changes.
        failCount++;
        render();
        status();
      });
  }

  function tick() {
    var el = document.getElementById("kiosk-clock");
    if (!el) return;
    // Recompute from Date.now() every tick (never count intervals — a laptop
    // sleep would drift), but write the DOM only when the string changes.
    var d = new Date();
    var text = pad(d.getHours()) + ":" + pad(d.getMinutes()) +
      " · " + DAYS[d.getDay()] + " " + pad(d.getDate()) + "." +
      pad(d.getMonth() + 1) + ".";
    if (text === lastClockText) return;
    lastClockText = text;
    el.textContent = text;
  }

  function init() {
    tick();
    load();
    setInterval(tick, CLOCK_MS);
    setInterval(load, REFRESH_MS);
    setInterval(flipPage, PAGE_MS);
    // Watchdog: a browser that has been open for weeks picks up new CSS/JS —
    // but only reload while online, never loop through an outage.
    setInterval(function () {
      if (failCount === 0 && lastGood) window.location.reload();
    }, RELOAD_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        tick();
        load();
      }
    });
    // A rotated or swapped wall screen changes how much fits — re-measure.
    window.addEventListener("resize", function () {
      render();
      status();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
