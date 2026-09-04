/**
 * jobs.js — bitcircus101 job board renderer ("Pinnwand", pinnwand.html).
 *
 * Loads jobs.json and renders one terminal-style card per posting that is up
 * TODAY, using the shared expiry math in jobs-core.js (window.JobsCore). The
 * filtering happens in the visitor's browser on purpose: a posting therefore
 * disappears on its own last day without anybody redeploying the site.
 *
 * The last card on the wall is always the invite note ("Das könnte Euer Zettel
 * sein :)"). It is rendered here rather than sitting in the HTML because jobs.js
 * owns the list's innerHTML — and because it doubles as the empty state: a wall
 * with nothing on it still shows one note, which reads better than a paragraph
 * apologising for the emptiness.
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
      '<p class="job-panel__dates">hängt seit ' +
      esc(Core.formatDay(entry.from)) +
      '<span class="job-panel__sep" aria-hidden="true"> · </span>läuft bis ' +
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

  // The note that is always up: an empty slot on the wall, drawn like a real
  // card so the shape of the offer is visible before anyone has bought one.
  // Dashed frame, no date line, and its action goes to the how-to instead of
  // out to a vacancy.
  function inviteMarkup() {
    return (
      '<article class="job-panel job-panel--invite" id="job-invite">' +
      '<div class="job-panel__chrome" aria-hidden="true">' +
      '<span class="job-panel__path">~/pinnwand/euer-zettel</span></div>' +
      '<div class="job-panel__body">' +
      '<h3 class="job-panel__title">Das könnte Euer Zettel sein :)</h3>' +
      '<p class="job-panel__company">Noch frei</p>' +
      '<a class="btn job-panel__action" href="#aufhaengen">Zettel aufhängen ↓</a>' +
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
      "<p>Einen Zettel aufhängen geht trotzdem: " +
      '<a href="#aufhaengen">so geht das ↓</a></p></div>';
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

    // Always last: real notes first, the free slot after them.
    list.innerHTML = html + inviteMarkup();
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
