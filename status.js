/**
 * status.js — draws /status (status.html): one bar row per event series from
 * status-data.json (scripts/build-status-data.mjs, live-only), the value-free
 * funding pulse from finanz.json, and the list of cancelled events. Every
 * timeline decision lives in status-core.js; this file fetches and renders.
 *
 * Rendering rules (gated by tests/markup.spec.mjs and tests/site.spec.js):
 * markup is template strings through esc(); state is a class or the `hidden`
 * attribute, never an inline style; the pulse never renders a level as a digit —
 * the only digits inside #status-pulse sit in <span class="status-label"> (dates).
 * The bar rows carry aria-busy in the markup and lose it here, so the height
 * reservation holds from the first paint (a deferred script setting it would
 * itself be the layout shift).
 */
(function () {
  "use strict";

  var DATA_URL = "status-data.json";
  var FINANZ_URL = "finanz.json";
  var SINCE_FALLBACK = "2025-05-25";
  var INCIDENT_LIMIT = 20;
  var Core = typeof StatusCore !== "undefined" ? StatusCore : null;

  // One glyph per state, so a bar is never colour alone.
  var GLYPH = {
    happened: "▌",   // ▌
    cancelled: "✕",  // ✕
    partial: "◪",    // ◪
    scheduled: "◌",  // ◌
    empty: "·"       // ·
  };
  var PULSE_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  var TREND_GLYPH = { "-1": "▼", "0": "▬", "1": "▲" };
  var SEP = " · ";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function byId(id) { return document.getElementById(id); }
  /** The reader's local calendar date, like the events page uses. */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function labelSpan(text) { return '<span class="status-label">' + esc(text) + "</span>"; }

  // ── bars ───────────────────────────────────────────────────────────────────
  function barHtml(classes, key, text, glyph) {
    return (
      '<button type="button" class="status-bar ' + classes + '" data-key="' + esc(key) +
      '" title="' + esc(text) + '" aria-label="' + esc(text) + '" aria-pressed="false" tabindex="-1">' +
      '<span class="status-bar__glyph" aria-hidden="true">' + glyph + "</span></button>"
    );
  }
  function seriesText(b) { return Core.rangeLabel(b) + SEP + Core.countsText(b.counts); }
  function seriesBar(b) {
    return barHtml("status-bar--" + b.state, b.key, b.label + SEP + seriesText(b), GLYPH[b.state]);
  }
  function pulseText(p) {
    if (p.level === null) return "keine Angabe";
    if (p.delta === null) return "Beginn der Aufzeichnung";
    return "Tendenz " + Core.trendWord(p.delta) + " " + TREND_GLYPH[String(p.delta)];
  }
  function pulseBar(p) {
    var cls = "status-bar--pulse " + (p.level === null ? "status-bar--gap" : "status-bar--l" + p.level);
    var glyph = p.level === null ? GLYPH.empty : PULSE_GLYPHS[p.level];
    return barHtml(cls, p.key, p.label + SEP + pulseText(p), glyph);
  }

  /**
   * Mount a bar row: one button per item (each has key + label), a roving
   * tabindex with the newest bar as the entry point, hover/focus → readout,
   * click → opts.select(item), Escape → opts.close(). Arrow keys walk the row.
   */
  function mountRow(row, readout, items, opts) {
    var byKey = {};
    var html = "";
    for (var i = 0; i < items.length; i++) {
      byKey[items[i].key] = items[i];
      html += opts.bar(items[i]);
    }
    row.innerHTML = html;
    row.removeAttribute("aria-busy");
    var bars = row.querySelectorAll(".status-bar");
    if (bars.length) bars[bars.length - 1].tabIndex = 0;

    function hit(target) {
      var btn = target && target.closest ? target.closest(".status-bar") : null;
      if (!btn || !row.contains(btn)) return null;
      return { btn: btn, item: byKey[btn.getAttribute("data-key")] };
    }
    function focusBar(btn) {
      for (var k = 0; k < bars.length; k++) bars[k].tabIndex = -1;
      btn.tabIndex = 0;
      btn.focus();
    }
    function show(e) {
      var h = hit(e.target);
      if (h && h.item && readout) readout.innerHTML = labelSpan(h.item.label) + SEP + esc(opts.text(h.item));
    }
    row.addEventListener("mouseover", show);
    row.addEventListener("focusin", show);
    row.addEventListener("click", function (e) {
      var h = hit(e.target);
      if (!h || !h.item) return;
      for (var k = 0; k < bars.length; k++) bars[k].setAttribute("aria-pressed", "false");
      h.btn.setAttribute("aria-pressed", "true");
      focusBar(h.btn);
      opts.select(h.item);
    });
    row.addEventListener("keydown", function (e) {
      var h = hit(e.target);
      if (!h) return;
      if (e.key === "Escape") {
        opts.close();
        return;
      }
      var idx = Array.prototype.indexOf.call(bars, h.btn);
      var next = null;
      if (e.key === "ArrowRight") next = bars[Math.min(bars.length - 1, idx + 1)];
      else if (e.key === "ArrowLeft") next = bars[Math.max(0, idx - 1)];
      else if (e.key === "Home") next = bars[0];
      else if (e.key === "End") next = bars[bars.length - 1];
      if (next) {
        e.preventDefault();
        focusBar(next);
      }
    });
    // "heute" sits on the right: open the row scrolled to its newest bar.
    row.scrollLeft = row.scrollWidth;
  }
  function clearPressed(row) {
    var pressed = row.querySelectorAll('.status-bar[aria-pressed="true"]');
    for (var k = 0; k < pressed.length; k++) pressed[k].setAttribute("aria-pressed", "false");
  }
  function closeDetail(detail, row) {
    detail.hidden = true;
    detail.innerHTML = "";
    clearPressed(row);
  }
  function detailHead(item) {
    return (
      '<h3 class="status-detail__title">' + labelSpan(item.label) + SEP +
      labelSpan(Core.rangeLabel(item)) + "</h3>"
    );
  }
  function closeButton() {
    return '<p class="status-detail__actions"><button type="button" class="btn status-detail__close">schließen</button></p>';
  }
  function wireClose(detail, onClose) {
    var btn = detail.querySelector(".status-detail__close");
    if (btn) btn.addEventListener("click", onClose);
    detail.addEventListener("keydown", function (e) { if (e.key === "Escape") onClose(); });
  }

  // ── series (one panel per event type) ──────────────────────────────────────
  function listHtml(events, today) {
    if (!events.length) return '<li class="status-detail__empty">kein Termin in diesem Zeitraum</li>';
    var sorted = events.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var html = "";
    for (var i = 0; i < sorted.length; i++) {
      var ev = sorted[i];
      var state = Core.eventState(ev, today);
      html +=
        '<li class="status-detail__item status-detail__item--' + state + '">' +
        labelSpan(Core.formatDate(ev.date)) + SEP +
        '<span class="status-detail__name">' + esc(ev.title) + "</span>" + SEP +
        '<span class="status-detail__state">' + esc(Core.stateWord(state)) + "</span>" + SEP +
        '<a href="e/' + esc(ev.id) + '/">Details</a></li>';
    }
    return html;
  }
  /** The zoom: a squashed bucket opens with a row one step finer (quarter →
   *  months, month → weeks) whose bars filter the list below. */
  function openSeriesDetail(detail, row, bucket, today) {
    var finer = Core.finerKind(bucket.kind);
    var zoom = !!finer && bucket.events.length > 0;
    var html = detailHead(bucket);
    if (zoom) {
      html +=
        '<p class="status-detail__hint">Feinraster – ein Klick filtert die Liste, Escape schließt.</p>' +
        '<div class="status-bars status-bars--zoom" role="group" aria-label="Feinraster ' + esc(bucket.label) + '"></div>' +
        '<p class="status-readout status-readout--zoom" aria-live="polite"></p>';
    }
    html += '<ul class="status-detail__list">' + listHtml(bucket.events, today) + "</ul>" + closeButton();
    detail.innerHTML = html;
    detail.hidden = false;
    var list = detail.querySelector(".status-detail__list");
    if (zoom) {
      var sub = Core.assign(Core.bucketizeRange(bucket.from, bucket.to, finer), bucket.events, today);
      mountRow(detail.querySelector(".status-bars--zoom"), detail.querySelector(".status-readout--zoom"), sub, {
        bar: seriesBar,
        text: seriesText,
        select: function (sb) { list.innerHTML = listHtml(sb.events, today); },
        close: function () { closeDetail(detail, row); }
      });
    }
    wireClose(detail, function () { closeDetail(detail, row); });
  }
  function renderSeries(section, buckets, today) {
    var key = section.getAttribute("data-series");
    var row = byId("status-bars-" + key);
    var readout = byId("status-readout-" + key);
    var detail = byId("status-detail-" + key);
    if (!row || !detail) return;
    mountRow(row, readout, buckets, {
      bar: seriesBar,
      text: seriesText,
      select: function (b) { openSeriesDetail(detail, row, b, today); },
      close: function () { closeDetail(detail, row); }
    });
  }

  // ── headline, incidents, failure ───────────────────────────────────────────
  function renderHeadline(h) {
    var el = byId("status-headline");
    if (!el) return;
    el.classList.remove("status-headline--ok", "status-headline--degraded");
    el.classList.add(h.state === "ok" ? "status-headline--ok" : "status-headline--degraded");
    el.querySelector(".status-headline__glyph").textContent = h.state === "ok" ? "●" : "◐";
    el.querySelector(".status-headline__text").textContent = h.text;
    el.removeAttribute("aria-busy");
  }
  function renderIncidents(events, seriesLabel) {
    var ul = byId("status-incidents");
    if (!ul) return;
    var list = Core.incidents(events, INCIDENT_LIMIT);
    if (!list.length) {
      ul.innerHTML = '<li class="status-incidents__empty">keine bekannt</li>';
      return;
    }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      html +=
        '<li class="status-incident">' + labelSpan(Core.formatDate(ev.date)) + SEP +
        '<span class="status-incident__name">' + esc(ev.title) + "</span>" + SEP +
        '<span class="status-incident__series">' + esc(seriesLabel(ev.series)) + "</span>" + SEP +
        '<a href="e/' + esc(ev.id) + '/">Details</a></li>';
    }
    ul.innerHTML = html;
  }
  /** status-data.json is live-only: a plain checkout lands here. */
  function renderUnavailable() {
    var rows = document.querySelectorAll(".status-panel .status-bars");
    for (var i = 0; i < rows.length; i++) {
      rows[i].innerHTML = '<p class="status-empty">Der Verlauf ist gerade nicht verfügbar.</p>';
      rows[i].removeAttribute("aria-busy");
    }
    var el = byId("status-headline");
    if (el) {
      el.querySelector(".status-headline__text").textContent = "Verlauf gerade nicht verfügbar";
      el.removeAttribute("aria-busy");
    }
  }
  function renderAll(data, today) {
    var events = data && Array.isArray(data.events) ? data.events : [];
    var since = data && typeof data.since === "string" ? data.since : SINCE_FALLBACK;
    var series = data && Array.isArray(data.series) ? data.series : [];
    var labels = {};
    for (var s = 0; s < series.length; s++) labels[series[s].key] = series[s].label;
    // One horizon for every row, so the three x-axes line up.
    var horizon = today;
    for (var i = 0; i < events.length; i++) if (events[i].date > horizon) horizon = events[i].date;
    var sections = document.querySelectorAll(".status-panel[data-series]");
    for (var j = 0; j < sections.length; j++) {
      var key = sections[j].getAttribute("data-series");
      var mine = [];
      for (var k = 0; k < events.length; k++) if (events[k].series === key) mine.push(events[k]);
      renderSeries(sections[j], Core.assign(Core.ladder(since, today, { horizon: horizon }), mine, today), today);
    }
    renderHeadline(Core.headline(events, today));
    renderIncidents(events, function (k) { return labels[k] || k; });
  }

  // ── funding pulse (opt-in: finanz.json ships without pulse.start) ──────────
  function openPulseDetail(detail, row, p) {
    var zoom = p.months.length > 1;
    var html = detailHead(p);
    if (zoom) {
      html +=
        '<div class="status-bars status-bars--zoom status-bars--pulse" role="group" aria-label="Monate in ' + esc(p.label) + '"></div>' +
        '<p class="status-readout status-readout--zoom" aria-live="polite"></p>';
    }
    html += '<p class="status-detail__trend">' + esc(pulseText(p)) + "</p>" + closeButton();
    detail.innerHTML = html;
    detail.hidden = false;
    if (zoom) {
      mountRow(detail.querySelector(".status-bars--zoom"), detail.querySelector(".status-readout--zoom"), p.months, {
        bar: pulseBar,
        text: pulseText,
        select: function () {},
        close: function () { closeDetail(detail, row); }
      });
    }
    wireClose(detail, function () { closeDetail(detail, row); });
  }
  function renderPulse(finanz, today) {
    var mount = byId("status-pulse");
    var row = byId("status-bars-pulse");
    var detail = byId("status-detail-pulse");
    if (!mount || !row || !detail || !finanz) return;
    var months = Core.pulseMonths(finanz.pulse);
    if (!months.length) return; // no time axis → the panel stays hidden
    var buckets = Core.pulseBuckets(months, Core.ladder(months[0].from, today, { finest: "month" }));
    mountRow(row, byId("status-readout-pulse"), buckets, {
      bar: pulseBar,
      text: pulseText,
      select: function (p) { openPulseDetail(detail, row, p); },
      close: function () { closeDetail(detail, row); }
    });
    mount.hidden = false;
  }

  function init() {
    if (!Core || !byId("status-headline")) return;
    var today = todayStr();
    fetch(DATA_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) { renderAll(data, today); })
      .catch(function () { renderUnavailable(); });
    fetch(FINANZ_URL)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (finanz) { if (finanz) renderPulse(finanz, today); })
      .catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
