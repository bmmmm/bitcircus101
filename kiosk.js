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
 *
 * After the event pages the rotation shows the job board (pinnwand, jobs.json)
 * as its own page: one note per active posting, each with a QR code to its ad,
 * so the wall in the space and the one on the web meet. See "Pinnwand" below.
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

  var JOBS_URL = "../jobs.json";
  // Canonical clean URL: this is what a phone opens, not a local file path.
  var PINNWAND_URL = "https://bitcircus101.de/pinnwand";
  var PINNWAND_SHORT = "bitcircus101.de/pinnwand";
  // Upper bound on notes per pinnwand page — like `rows`, a cap, not a target:
  // the page break itself is MEASURED (a portrait wall fits two, a small
  // screen may fit one). Three QR codes of scannable size fill a 16:9 wall.
  var NOTES_PER_PAGE = 3;

  var lastGood = null;   // { events, lastSync, at } — kept across failed fetches
  var lastJobs = null;   // jobs.json as last fetched; null → no pinnwand page
  var onPinnwand = false; // is a pinnwand page up right now (for the status line)
  var qrCache = {};      // url + label → SVG markup; emptied on every jobs load
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
    pinnwand: { key: "bc.kiosk.pinnwand", values: ["on", "off"] },
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
    // jobs.json is not fetched while the pinnwand is off — fetch it on switch-on
    if (name === "pinnwand" && value === "on" && !lastJobs) loadJobs();
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

  /**
   * The whole rotation: the event pages first, then the pinnwand pages. Both
   * are measured against the screen; `page` indexes the combined list.
   */
  function render() {
    var el = document.getElementById("kiosk-list");
    if (!el) return;
    var pins = pinnwandPages(el);
    var eventPages = renderEvents(el);
    pageCount = eventPages + pins.length;
    onPinnwand = false;
    if (page >= pageCount) {
      page = 0;
      renderEvents(el);
    } else if (page >= eventPages) {
      el.innerHTML = pinnwandHtml(pins[page - eventPages]);
      onPinnwand = true;
    }
  }

  /**
   * Paint event page `page` and return how many event pages there are. When
   * `page` points past them (a pinnwand page is up), the list is left holding
   * the last measured page — render() paints over it.
   */
  function renderEvents(el) {
    if (!lastGood) {
      el.innerHTML = '<p class="kiosk-offline">keine daten — bitcircus101.de/termine</p>';
      el.removeAttribute("aria-busy");
      return 1;
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
      return 1;
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
    if (page < starts.length) paintFrom(starts[page]);
    el.removeAttribute("aria-busy");
    return starts.length;
  }

  /* ===========================================================================
     Pinnwand — the job board's notes, each with a QR code to scan off the wall.

     Expiry comes from jobs-core.js (JobsCore.activeEntries), the same math the
     web board and the CI gate use; nothing here decides whether a posting is
     up. The QR matrix comes from the vendored qrcode-generator; this file only
     draws it as SVG.

     A note is { kind, title, sub, facts, short, url, label } — `kind` is only
     a class modifier, so postings and Chiffre notes are two mappings into one
     shape, not two renderers. Any failure on this path —
     jobs.json missing, a library that did not load, a URL too long for a QR
     code — drops the note or the page silently: the wall never shows an error
     for a side feature.
     =========================================================================== */

  /** https only, the same second lock as jobs.js — then normalised through
   *  URL, which percent-encodes anything non-ASCII so the QR bytes are plain
   *  ASCII whatever the posting's URL looks like. */
  function safeUrl(raw) {
    if (String(raw).indexOf("https://") !== 0) return null;
    try { return new URL(raw).href; } catch (e) { return null; }
  }

  /**
   * QR code as inline SVG: one path of 1×1 module squares on a light square
   * that includes the 4-module quiet zone. The colours are fixed in style.css
   * (.kiosk-qr__bg / __fg), never taken from the palette: dark modules on a
   * light ground is what every phone scanner reads, an inverted code is not.
   * Error correction M: survives some glare and a smudge on the screen.
   */
  function qrSvg(text, label) {
    var qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var size = n + 2 * quiet;
    var d = "";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
      }
    }
    return '<svg class="kiosk-qr" viewBox="0 0 ' + size + " " + size +
      '" role="img" aria-label="' + esc(label) + '" shape-rendering="crispEdges">' +
      '<rect class="kiosk-qr__bg" width="' + size + '" height="' + size + '"/>' +
      '<path class="kiosk-qr__fg" d="' + d + '"/></svg>';
  }

  /** The note with its QR code drawn, or null when no code can be made. The
   *  SVG is cached: render() runs on every flip and resize, the codes only
   *  change when jobs.json does. */
  function withQr(note) {
    var key = note.url + "\n" + note.label;
    if (!qrCache[key]) {
      try { qrCache[key] = qrSvg(note.url, note.label); } catch (e) { return null; }
    }
    note.qr = qrCache[key];
    return note;
  }

  function noteHtml(note) {
    return '<article class="kiosk-note kiosk-note--' + note.kind + '">' + note.qr +
      '<div class="kiosk-note__text">' +
      '<h2 class="kiosk-note__title">' + esc(note.title) + "</h2>" +
      (note.sub ? '<p class="kiosk-note__sub">' + esc(note.sub) + "</p>" : "") +
      (note.facts ? '<p class="kiosk-note__facts">' + esc(note.facts) + "</p>" : "") +
      '<p class="kiosk-note__url">' + esc(note.short) + "</p>" +
      "</div></article>";
  }

  /** "a · b" from the parts that are present. */
  function joinDot(parts) {
    return parts.filter(function (p) { return p; }).join(" · ");
  }

  // Same id rule as jobs.js: the id lands in a URL fragment and a label.
  var CHIFFRE_ID_RE = /^0x[0-9a-f]{2,4}$/;

  /** Active postings and Chiffre notes as wall notes, postings first. */
  function pinnwandNotes() {
    var Core = window.JobsCore;
    var today = Core.todayString();
    var notes = [];
    Core.activeEntries(lastJobs.postings || [], today).forEach(function (p) {
      var url = safeUrl(p.url);
      if (!url) return;
      var host = new URL(url).host.replace(/^www\./, "");
      var note = withQr({
        kind: "job",
        title: p.title,
        sub: joinDot([p.company, p.location]),
        facts: Core.employmentLabels(p.employment).join(" · "),
        short: host,
        url: url,
        label: "QR-Code zur Stellenanzeige: " + p.title + " bei " + p.company + " (" + host + ")",
      });
      if (note) notes.push(note);
    });
    Core.activeEntries(lastJobs.chiffre || [], today).forEach(function (c) {
      var id = String(c.id);
      if (!CHIFFRE_ID_RE.test(id)) return;
      var note = withQr({
        kind: "chiffre",
        title: c.headline,
        sub: joinDot([Core.levelLabel(c.level), c.location]),
        facts: "zuschrift unter chiffre " + id,
        short: PINNWAND_SHORT,
        url: PINNWAND_URL + "#chiffre-" + id,
        label: "QR-Code zur Chiffre " + id + " auf der Pinnwand: " + PINNWAND_SHORT,
      });
      if (note) notes.push(note);
    });
    return notes;
  }

  /**
   * The pinnwand pages for the rotation: [] (no page at all) when the setting
   * is off or the data or a library is missing; one invite note when nothing
   * is up; otherwise the active notes, split where the screen is full.
   *
   * The split is MEASURED in `el` the way the event pages are: fill until the
   * next note would overflow, roll it back, start the next page. A portrait
   * wall stacks the notes, a landscape one lines them up — a counted split
   * clipped notes on the one or wasted the other. A note taller than the
   * screen on its own still gets its page, so every note comes up.
   */
  function pinnwandPages(el) {
    if (settings.pinnwand !== "on" || !lastJobs) return [];
    if (!window.JobsCore || typeof window.qrcode !== "function") return [];
    var notes = pinnwandNotes();
    if (!notes.length) {
      var invite = withQr({
        kind: "invite",
        title: "frei für euren zettel :)",
        sub: "stellenanzeigen aus der community — so hängt ihr einen auf",
        short: PINNWAND_SHORT,
        url: PINNWAND_URL,
        label: "QR-Code zur Pinnwand: " + PINNWAND_SHORT,
      });
      return invite ? [{ more: false, notes: [invite] }] : [];
    }
    var pages = [];
    var i = 0;
    while (i < notes.length) {
      var n = 1;
      // clientHeight 0 = no layout yet: fall back to the cap, like the events
      while (n < NOTES_PER_PAGE && i + n < notes.length) {
        el.innerHTML = pinnwandHtml({ more: true, notes: notes.slice(i, i + n + 1) });
        if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight) break;
        n++;
      }
      pages.push({ more: true, notes: notes.slice(i, i + n) });
      i += n;
    }
    return pages;
  }

  function pinnwandHtml(pg) {
    var html = '<section class="kiosk-pin">' +
      '<h1 class="kiosk-day__label"><span>pinnwand</span></h1>' +
      '<div class="kiosk-pin__notes">';
    pg.notes.forEach(function (note) { html += noteHtml(note); });
    html += "</div>";
    if (pg.more) html += '<p class="kiosk-pin__more">alle zettel: ' + PINNWAND_SHORT + "</p>";
    return html + "</section>";
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
    parts.push("quelle: bitcircus101.de/" + (onPinnwand ? "pinnwand" : "termine"));
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
    var pin = document.getElementById("kiosk-set-pinnwand");
    if (pin) pin.checked = settings.pinnwand === "on";
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
        if (t.id === "kiosk-set-pinnwand") setSetting("pinnwand", t.checked ? "on" : "off");
        if (t.id === "kiosk-set-rows") setSetting("rows", t.value);
        if (t.id === "kiosk-set-dwell") setSetting("dwell", t.value);
      });
      panel.addEventListener("input", armPanelTimeout);
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closePanel();
    });
  }

  /**
   * jobs.json, on the same schedule as the events. A failed fetch keeps the
   * last good copy (like the events) and before the first success there is
   * simply no pinnwand page — no error, no status line: the events are the
   * wall's job, the pinnwand is a guest on it.
   */
  function loadJobs() {
    if (settings.pinnwand !== "on") return;
    fetch(JOBS_URL + "?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.postings)) throw new Error("no postings");
        lastJobs = data;
        qrCache = {};
        // Before the events have answered, rendering would flash "keine daten"
        // over the loading state — their own render picks the pinnwand up.
        if (!lastGood && !failCount) return;
        render();
        status();
      })
      .catch(function () { /* keep lastJobs as it is */ });
  }

  function load() {
    loadJobs();
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
        // `page` is kept: resetting it here restarted the rotation on every
        // 5-min refresh, so with enough pages the last ones — the pinnwand —
        // never came up. render() clamps a page that no longer exists to 0.
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
