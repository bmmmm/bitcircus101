/**
 * jobs.js — bitcircus101 job board renderer ("Pinnwand", pinnwand.html).
 *
 * Loads jobs.json and renders one terminal-style card per posting that is up
 * TODAY, using the shared expiry math in jobs-core.js (window.JobsCore). The
 * filtering happens in the visitor's browser on purpose: a posting therefore
 * disappears on its own last day without anybody redeploying the site.
 *
 * We host no vacancy — every card is a link out. Defense in depth: the CI gate
 * (scripts/check-jobs.mjs) already refuses a non-https url, and this file
 * independently refuses to render one, so a card can never carry a javascript:
 * or data: href even if the gate were bypassed.
 */
(function () {
  "use strict";

  var JSON_URL = "jobs.json";
  var Core = window.JobsCore;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cardMarkup(entry) {
    var until = Core.formatDay(Core.lastDay(entry.from, entry.months));
    return (
      '<article class="job-panel" id="job-' +
      esc(entry.id) +
      '">' +
      '<div class="job-panel__chrome" aria-hidden="true">' +
      '<span class="job-panel__path">~/pinnwand/' +
      esc(entry.id) +
      "</span></div>" +
      '<div class="job-panel__body">' +
      '<h3 class="job-panel__title">' +
      esc(entry.title) +
      "</h3>" +
      '<p class="job-panel__company">' +
      esc(entry.company) +
      "</p>" +
      '<p class="job-panel__until">läuft bis ' +
      esc(until) +
      "</p>" +
      '<a class="btn job-panel__action" href="' +
      esc(entry.url) +
      '" target="_blank" rel="noopener noreferrer" aria-label="Stellenanzeige öffnen: ' +
      esc(entry.title) +
      ' bei ' +
      esc(entry.company) +
      '">Stellenanzeige öffnen ↗</a>' +
      "</div></article>"
    );
  }

  // ── States ────────────────────────────────────────────────────────────────

  function loadingMarkup() {
    return (
      '<p class="jobs-loading"><span class="jobs-loading__cmd">' +
      "lade zettel …</span></p>"
    );
  }

  function renderError(el) {
    el.innerHTML =
      '<div class="jobs-fallback">' +
      '<p class="jobs-fallback__cmd">zettel laden: ' +
      '<span class="jobs-fallback__err">fehlgeschlagen</span></p>' +
      "<p>Du kannst trotzdem einen Zettel aufhängen: " +
      '<a href="#aufhaengen">so geht das ↓</a></p></div>';
    el.removeAttribute("aria-busy");
  }

  function renderEmpty(el) {
    el.innerHTML =
      '<p class="jobs-empty">Noch kein Zettel an der Wand — deiner könnte der ' +
      'erste sein. <a href="#aufhaengen">Zettel aufhängen ↓</a></p>';
    el.removeAttribute("aria-busy");
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function render(data) {
    var list = document.getElementById("jobs-list");
    if (!list) return;

    var postings = (data && data.postings) || [];
    var active = Core.activeEntries(postings, Core.todayString());
    var html = "";
    for (var i = 0; i < active.length; i++) {
      // Only ever link out over https — see the file header.
      if (String(active[i].url).indexOf("https://") !== 0) continue;
      html += cardMarkup(active[i]);
    }

    if (!html) {
      renderEmpty(list);
      return;
    }
    list.innerHTML = html;
    list.removeAttribute("aria-busy");
  }

  function init() {
    var list = document.getElementById("jobs-list");
    if (!list) return;
    if (!Core) {
      renderError(list);
      return;
    }
    // aria-busy belongs to the loading state, not to the page: left in the
    // static markup it would flag the <noscript> fallback as forever loading.
    list.setAttribute("aria-busy", "true");
    list.innerHTML = loadingMarkup();
    fetch(JSON_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(render)
      .catch(function () {
        renderError(list);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
