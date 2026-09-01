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
 * events fit depends on how long their descriptions are. `rows` caps the count
 * on top of that, `dwell` sets how long a page stands.
 *
 * Everything a wall operator might change — colour, theme, page size, dwell,
 * how much info text, which calendars — is one settings model reachable two
 * ways: the ⚙ panel in the status bar, and a URL parameter of the same name.
 * See SETTINGS below.
 */
(function () {
  "use strict";

  var DATA_URL = "../events-data.json";
  var REFRESH_MS = 300000; // 5 min — the sync cron runs every 30, this is cheap
  var CLOCK_MS = 1000;
  var RELOAD_MS = 21600000; // 6 h watchdog reload to pick up new CSS/JS
  var PANEL_IDLE_MS = 90000; // settings panel closes itself after 90 s idle
  // One step of the auto colour cycle. Long on purpose: this is burn-in
  // protection, not decoration — a wall that changes hue every minute is a
  // distraction, one that changes every 20 min is barely noticed.
  var CYCLE_MS = 1200000;
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
  var flipTimer = null;  // page rotation — restarted when `dwell` changes
  var panelTimer = null; // idle close for the settings panel

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

  /* ===========================================================================
     Settings — one model behind both the URL and the ⚙ panel.

     Reading order is URL → localStorage → default, because the URL is how a
     screen gets pinned: hand a wall `/kiosk/?palette=amber&info=off` and it
     comes up that way regardless of what someone once clicked on it. Writing
     goes to BOTH, and the address bar is kept in step with replaceState, so
     the current URL is always a copyable description of what is on screen.

     Names are English like the pre-existing `rows`; the labels in the panel are
     German like the rest of the UI.
     =========================================================================== */
  var SETTINGS = {
    // theme shares its key with the rest of the site — the ◐ toggle in the nav
    // and the one here mean the same thing.
    theme:   { key: "bc.theme",           values: ["dark", "light"] },
    palette: { key: "bc.kiosk.palette",   values: ["standard", "green", "amber", "mono", "pride"] },
    cycle:   { key: "bc.kiosk.cycle",     values: ["off", "on"] },
    info:    { key: "bc.kiosk.info",      values: ["full", "short", "off"] },
    source:  { key: "bc.kiosk.source",    values: ["all", "bitcircus101"] },
    // numeric: [default, min, max]
    rows:    { key: "bc.kiosk.rows",      num: [8, 1, 12] },
    dwell:   { key: "bc.kiosk.dwell",     num: [20, 5, 300] },
  };

  var settings = {};

  function store(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function readSettings() {
    var q = new URLSearchParams(window.location.search);
    var out = {};
    Object.keys(SETTINGS).forEach(function (name) {
      var spec = SETTINGS[name];
      var raw = q.get(name);
      if (raw === null) raw = store(spec.key);
      if (spec.num) {
        var n = parseInt(raw, 10);
        out[name] = isNaN(n) ? spec.num[0] : clamp(n, spec.num[1], spec.num[2]);
      } else {
        out[name] = spec.values.indexOf(raw) > -1 ? raw : spec.values[0];
      }
    });
    return out;
  }

  /** Mirror the live settings into the address bar — only the non-default ones,
   *  so a plain wall keeps a plain URL and a pinned one reads as its own recipe. */
  function syncUrl() {
    if (!window.history || !window.history.replaceState) return;
    var q = new URLSearchParams();
    Object.keys(SETTINGS).forEach(function (name) {
      var spec = SETTINGS[name];
      var def = spec.num ? spec.num[0] : spec.values[0];
      if (settings[name] !== def) q.set(name, settings[name]);
    });
    var qs = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
  }

  function applyChrome() {
    var root = document.documentElement;
    if (settings.theme === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;
    root.dataset.palette = settings.palette;

    var list = document.getElementById("kiosk-list");
    if (list) {
      list.classList.toggle("kiosk__list--info-short", settings.info === "short");
      list.classList.toggle("kiosk__list--info-off", settings.info === "off");
    }
    var themeBtn = document.getElementById("kiosk-theme");
    if (themeBtn) themeBtn.setAttribute("aria-pressed", String(settings.theme === "light"));
  }

  /** Change one setting and put the whole machine back in step. */
  function setSetting(name, value) {
    var spec = SETTINGS[name];
    if (!spec) return;
    if (spec.num) {
      var n = parseInt(value, 10);
      if (isNaN(n)) return;
      value = clamp(n, spec.num[1], spec.num[2]);
    } else if (spec.values.indexOf(value) < 0) {
      return;
    }
    if (settings[name] === value) return;
    settings[name] = value;
    remember(spec.key, String(value));
    syncUrl();
    applyChrome();
    if (name === "dwell") restartFlip();
    // rows/info/source change what a page holds, so the fit must be re-measured
    page = 0;
    render();
    status();
    paintPanel();
  }

  // `rows` caps how many events a page may hold. It is an upper bound, not a
  // target: render() shrinks the page until it actually fits the screen,
  // because how many events fit depends on how long their descriptions are.
  function rowCap() { return settings.rows; }

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

    // info=off drops the text entirely rather than hiding it in CSS: the page
    // fit is measured from the DOM, so an invisible paragraph would still cost
    // a page break.
    var desc = settings.info === "off" ? "" : cleanText(e.description);
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
        if (new Date(e.date + "T23:59:59") < startOfToday) return false;
        // "nur bitcircus101" hides the friendly spaces' calendars, the same
        // distinction the events page offers.
        return settings.source === "all" || e.source === "bitcircus101";
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

  function restartFlip() {
    if (flipTimer) clearInterval(flipTimer);
    flipTimer = setInterval(flipPage, settings.dwell * 1000);
  }

  /* ===========================================================================
     Colour
     =========================================================================== */

  /** Next palette in the cycle — what the ◉ button does. */
  function nextPalette() {
    var list = SETTINGS.palette.values;
    var i = list.indexOf(settings.palette);
    setSetting("palette", list[(i + 1) % list.length]);
  }

  /**
   * Auto mode: step the palette AND flip light/dark on a long interval. The
   * inversion is the part that actually helps against burn-in — a wall shows
   * near-static text for weeks, and rotating the hue leaves the same pixels
   * lit. Palette rotation on its own would look like a feature and protect
   * nothing.
   */
  function cycleStep() {
    if (settings.cycle !== "on") return;
    var list = SETTINGS.palette.values;
    var i = list.indexOf(settings.palette);
    var wrapped = (i + 1) % list.length === 0;
    setSetting("palette", list[(i + 1) % list.length]);
    // invert once per full trip through the palettes, not on every step
    if (wrapped) setSetting("theme", settings.theme === "light" ? "dark" : "light");
  }

  /* ===========================================================================
     Settings panel
     =========================================================================== */

  var PANEL_LABELS = {
    palette: { standard: "standard", green: "grün", amber: "bernstein", mono: "weiß", pride: "rainbow" },
    info: { full: "lang", short: "kurz", off: "aus" },
    source: { all: "alle kalender", bitcircus101: "nur bitcircus101" },
  };

  function choiceRow(el, name) {
    if (!el) return;
    var html = "";
    SETTINGS[name].values.forEach(function (v) {
      html += '<button type="button" class="kiosk-set__opt' +
        (settings[name] === v ? " kiosk-set__opt--on" : "") +
        '" data-set="' + name + '" data-value="' + v + '"' +
        (settings[name] === v ? ' aria-pressed="true"' : ' aria-pressed="false"') +
        ">" + esc(PANEL_LABELS[name][v]) + "</button>";
    });
    el.innerHTML = html;
  }

  /** Re-render the panel from the settings, so it never drifts from reality. */
  function paintPanel() {
    var panel = document.getElementById("kiosk-settings");
    if (!panel || panel.hidden) return;
    choiceRow(document.getElementById("kiosk-set-palette"), "palette");
    choiceRow(document.getElementById("kiosk-set-info"), "info");
    choiceRow(document.getElementById("kiosk-set-source"), "source");
    var cycle = document.getElementById("kiosk-set-cycle");
    if (cycle) cycle.checked = settings.cycle === "on";
    var light = document.getElementById("kiosk-set-light");
    if (light) light.checked = settings.theme === "light";
    var rowsIn = document.getElementById("kiosk-set-rows");
    if (rowsIn && document.activeElement !== rowsIn) rowsIn.value = settings.rows;
    var dwellIn = document.getElementById("kiosk-set-dwell");
    if (dwellIn && document.activeElement !== dwellIn) dwellIn.value = settings.dwell;
    var url = document.getElementById("kiosk-settings-url");
    if (url) url.textContent = window.location.href;
  }

  function openPanel() {
    var panel = document.getElementById("kiosk-settings");
    if (!panel) return;
    panel.hidden = false;
    document.body.classList.add("kiosk-body--settings");
    var btn = document.getElementById("kiosk-settings-open");
    if (btn) btn.setAttribute("aria-expanded", "true");
    paintPanel();
    armPanelTimeout();
  }

  function closePanel() {
    var panel = document.getElementById("kiosk-settings");
    if (!panel) return;
    panel.hidden = true;
    document.body.classList.remove("kiosk-body--settings");
    var btn = document.getElementById("kiosk-settings-open");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (panelTimer) clearTimeout(panelTimer);
  }

  /** A wall left with its settings panel open is a wall showing no events. */
  function armPanelTimeout() {
    if (panelTimer) clearTimeout(panelTimer);
    panelTimer = setTimeout(closePanel, PANEL_IDLE_MS);
  }

  function wireControls() {
    var theme = document.getElementById("kiosk-theme");
    if (theme) theme.addEventListener("click", function () {
      setSetting("theme", settings.theme === "light" ? "dark" : "light");
    });
    var pal = document.getElementById("kiosk-palette");
    if (pal) pal.addEventListener("click", nextPalette);

    var open = document.getElementById("kiosk-settings-open");
    if (open) open.addEventListener("click", function () {
      var panel = document.getElementById("kiosk-settings");
      if (panel && panel.hidden) openPanel(); else closePanel();
    });
    var close = document.getElementById("kiosk-settings-close");
    if (close) close.addEventListener("click", closePanel);

    var reset = document.getElementById("kiosk-set-reset");
    if (reset) reset.addEventListener("click", function () {
      Object.keys(SETTINGS).forEach(function (name) {
        var spec = SETTINGS[name];
        setSetting(name, spec.num ? spec.num[0] : spec.values[0]);
      });
      paintPanel();
    });

    var panel = document.getElementById("kiosk-settings");
    if (panel) {
      // one delegated listener for every choice button in the panel
      panel.addEventListener("click", function (ev) {
        armPanelTimeout();
        var btn = ev.target.closest ? ev.target.closest("[data-set]") : null;
        if (btn) setSetting(btn.getAttribute("data-set"), btn.getAttribute("data-value"));
      });
      panel.addEventListener("change", function (ev) {
        armPanelTimeout();
        var t = ev.target;
        if (t.id === "kiosk-set-cycle") setSetting("cycle", t.checked ? "on" : "off");
        if (t.id === "kiosk-set-light") setSetting("theme", t.checked ? "light" : "dark");
        if (t.id === "kiosk-set-rows") setSetting("rows", t.value);
        if (t.id === "kiosk-set-dwell") setSetting("dwell", t.value);
      });
      panel.addEventListener("input", armPanelTimeout);
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closePanel();
    });
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
    settings = readSettings();
    applyChrome();
    syncUrl();
    wireControls();
    tick();
    load();
    setInterval(tick, CLOCK_MS);
    setInterval(load, REFRESH_MS);
    restartFlip();
    setInterval(cycleStep, CYCLE_MS);
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
