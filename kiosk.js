/**
 * kiosk.js — wall-display view of the bitcircus101 events (kiosk/index.html).
 *
 * JSON only, deliberately: the kiosk lives on the same origin as
 * events-data.json — if that is gone the site is broken anyway, and the right
 * wall-display behavior is to hold the last good data and say so, not to grow
 * an ICS fallback. Loads neither ics-core.js nor events.js; the few shared
 * lines (pad, esc, day/month names) are re-declared locally, the same way
 * main.js does for the homepage preview.
 */
(function () {
  "use strict";

  var DATA_URL = "../events-data.json";
  var REFRESH_MS = 300000; // 5 min — the sync cron runs every 30, this is cheap
  var CLOCK_MS = 1000;
  var RELOAD_MS = 21600000; // 6 h watchdog reload to pick up new CSS/JS
  // lastSync older than this → "daten alt". Not 3 h: the sync cron asks for
  // every 30 min but GitHub really fires it every 2-3 h and never catches up
  // (measured 2026-08-06, largest observed gap ~3 h 10 min), so a 3 h threshold
  // cries wolf on a healthy feed. 5 h clears that jitter and still warns an
  // hour before the external Uptime Kuma monitor (6 h) escalates.
  var STALE_AFTER_MS = 5 * 3600000;
  var NOW_WINDOW_MS = 3 * 3600000; // started less than this ago → "läuft" marker
  var MONTHS = [
    "JAN", "FEB", "MÄR", "APR", "MAI", "JUN",
    "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ",
  ];
  var DAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];

  var lastGood = null;   // { events, lastSync, at } — kept across failed fetches
  var failCount = 0;
  var lastClockText = "";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ?rows=N clamps how many rows fit the screen (3–12, default 6).
  function rowCount() {
    var m = /[?&]rows=(\d+)/.exec(window.location.search);
    var n = m ? parseInt(m[1], 10) : 6;
    return Math.max(3, Math.min(12, isNaN(n) ? 6 : n));
  }

  function whenLabel(d, today, tomorrow) {
    var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    if (key === today) return "HEUTE";
    if (key === tomorrow) return "MORGEN";
    return DAYS[d.getDay()] + " " + pad(d.getDate()) + "." + MONTHS[d.getMonth()] + ".";
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function render() {
    var el = document.getElementById("kiosk-list");
    if (!el) return;

    if (!lastGood) {
      el.innerHTML = '<p class="kiosk-offline">keine daten — bitcircus101.de/termine</p>';
      el.removeAttribute("aria-busy");
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
      })
      .slice(0, rowCount());

    if (!rows.length) {
      el.innerHTML = '<p class="kiosk-empty">keine termine im blick</p>';
      el.removeAttribute("aria-busy");
      return;
    }

    var html = "";
    rows.forEach(function (e) {
      var d = new Date(e.date + "T00:00:00");
      var isToday = e.date === today;
      // "running now": started within the last NOW_WINDOW_MS (endTime is not
      // reliable enough across sources to gate on).
      var startMs = e.time ? new Date(e.date + "T" + e.time + ":00").getTime() : NaN;
      var isNow = isToday && !isNaN(startMs) &&
        now.getTime() >= startMs && now.getTime() - startMs < NOW_WINDOW_MS;
      var cls = "kiosk-row" + (isToday ? " kiosk-row--today" : "") +
        (isNow ? " kiosk-row--now" : "");

      html += '<div class="' + cls + '">';
      html += '<span class="kiosk-row__when">' + whenLabel(d, today, tomorrow) + "</span>";
      html += '<span class="kiosk-row__time">' + (e.time ? esc(e.time) : "ganztägig") + "</span>";
      html += '<span class="kiosk-row__title">' + esc(e.title) + "</span>";
      var side = "";
      if (e.source && e.source !== "bitcircus101") {
        side = esc(e.source);
      } else if (e.tags && e.tags.length) {
        side = esc(e.tags[0]);
      }
      html += '<span class="kiosk-row__side">' + side + "</span>";
      html += "</div>";
    });
    el.innerHTML = html;
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
    if (failCount >= 3) {
      parts.push("⚠ offline seit " + failCount * (REFRESH_MS / 60000) + " min");
    }
    parts.push("quelle: bitcircus101.de/termine");
    el.textContent = parts.join(" · ");
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
