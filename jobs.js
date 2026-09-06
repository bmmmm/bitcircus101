/**
 * jobs.js — bitcircus101 job board renderer ("Pinnwand", pinnwand.html).
 *
 * Loads jobs.json and renders one terminal-style card per posting that is up
 * TODAY, using the shared expiry math in jobs-core.js (window.JobsCore). The
 * filtering happens in the visitor's browser on purpose: a posting therefore
 * disappears on its own last day without anybody redeploying the site.
 *
 * The last card on the wall is always the invite note ("Das könnte Euer Zettel
 * sein :)"). It sits in the HTML (pinnwand.html, #jobs-invite), not in this
 * file: it has no data to wait for, and rendered from here it arrived with
 * the postings and pushed the how-to section below it down by a whole card on
 * every visit (layout shift 0.075, Lighthouse mobile). jobs.js owns only the
 * postings container (#jobs-postings) in front of it. The note still doubles
 * as the empty state: a wall with nothing on it shows one note, which reads
 * better than a paragraph apologising for the emptiness.
 *
 * That note is also the permanent slot (Dauerplatz): jobs.json's `karussell`
 * lists companies — name and https link, no dates — and this file cycles their
 * names through the note's title, one every few seconds. Only the title text
 * is swapped, never the card's structure, so the how-to below never moves;
 * without JavaScript (or without the key) the static title stands. The cycle
 * pauses while the card is hovered or focused, while the tab is hidden, and
 * does not run at all under prefers-reduced-motion (one random name then).
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
      // The spaces live OUTSIDE the aria-hidden span. Inside it they are hidden
      // with the dot, and a screen reader reads "…2026läuft bis…" as one token.
      '<p class="job-panel__dates">hängt seit ' +
      esc(Core.formatDay(entry.from)) +
      ' <span class="job-panel__sep" aria-hidden="true">·</span> läuft bis ' +
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
  // ── States ────────────────────────────────────────────────────────────────
  // No visible "loading" line on purpose: the invite note is on the wall from
  // the first paint, and a one-line placeholder that appears and goes away
  // again moved it twice (2 × 0.029, Lighthouse mobile). aria-busy on the live
  // region carries the loading state for assistive tech instead.

  /**
   * @param {HTMLElement} list the live region (#jobs-list) that carries aria-busy
   * @param {HTMLElement} postings the container in front of the invite note
   */
  function renderError(list, postings) {
    postings.innerHTML =
      '<div class="jobs-fallback">' +
      '<p class="jobs-fallback__cmd">zettel laden: ' +
      '<span class="jobs-fallback__err">fehlgeschlagen</span></p>' +
      "<p>Einen Zettel aufhängen geht trotzdem: " +
      '<a href="#aufhaengen">so geht das ↓</a></p></div>';
    list.removeAttribute("aria-busy");
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function render(data) {
    var list = document.getElementById("jobs-list");
    var postings = document.getElementById("jobs-postings");
    if (!list || !postings) return;

    var entries = (data && data.postings) || [];
    var active = Core.activeEntries(entries, Core.todayString());
    var html = "";
    for (var i = 0; i < active.length; i++) {
      // Only ever link out over https — see the file header.
      if (String(active[i].url).indexOf("https://") !== 0) continue;
      html += cardMarkup(active[i]);
    }

    // Real notes go into their container; the invite note (static markup)
    // follows it, so it is always last — and an empty board is just it.
    postings.innerHTML = html;
    list.removeAttribute("aria-busy");
    renderSlots(list, data && data.karussell);
  }

  // ── Permanent slot (Dauerplatz) ──────────────────────────────────────────

  var SLOT_MS = 7000;

  var reduceMotion = false;
  try {
    reduceMotion = !!(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch (e) {}

  /**
   * Cycle the karussell names through the invite note's title. Only the
   * title's text changes — one line stays one line — so nothing below moves.
   * Refuses a non-https url exactly like cardMarkup does: the gate already
   * rejects one, this is the second lock.
   */
  function renderSlots(list, slots) {
    var title = list.querySelector("#jobs-invite .job-panel__title");
    var card = list.querySelector("#jobs-invite");
    if (!title || !card || !slots || !slots.length) return;

    var clean = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (s && String(s.url).indexOf("https://") === 0 && String(s.name).trim()) clean.push(s);
    }
    if (!clean.length) return;

    var at = Math.floor(Math.random() * clean.length);
    function show() {
      title.innerHTML =
        '<a class="job-panel__slot" href="' + esc(clean[at].url) +
        '" target="_blank" rel="noopener noreferrer">' + esc(clean[at].name) + " ↗</a>";
    }
    show();
    if (clean.length < 2 || reduceMotion) return;

    var timer = null;
    function start() {
      if (timer || document.hidden) return;
      timer = setInterval(function () {
        at = (at + 1) % clean.length;
        show();
      }, SLOT_MS);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
    // A name should not vanish under the pointer or the focus ring, and a
    // hidden tab has no reader to cycle for.
    card.addEventListener("mouseenter", stop);
    card.addEventListener("mouseleave", start);
    card.addEventListener("focusin", stop);
    card.addEventListener("focusout", start);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });
    start();
  }

  /**
   * The wall's primary call to action jumps to #aufhaengen, where the how-to
   * is a closed <details>. A real fragment navigation makes the browser open
   * it; this click is not one — main.js intercepts every in-page anchor and
   * scrolls with preventDefault — so without this the visitor lands on a shut
   * box. Opening it here keeps that knowledge next to the link that needs it.
   */
  function wireInviteAction(list) {
    var action = list.querySelector(".job-panel--invite .job-panel__action");
    if (!action) return;
    action.addEventListener("click", function () {
      var howto = document.querySelector("details.jobs-howto");
      if (howto) howto.open = true;
    });
  }

  function init() {
    var list = document.getElementById("jobs-list");
    var postings = document.getElementById("jobs-postings");
    if (!list || !postings) return;
    // The invite note is in the markup from the first paint; its CTA still
    // needs the how-to opened by hand (see wireInviteAction).
    wireInviteAction(list);
    if (!Core) {
      renderError(list, postings);
      return;
    }
    // aria-busy belongs to the loading state, not to the page: left in the
    // static markup it would flag the <noscript> fallback as forever loading.
    list.setAttribute("aria-busy", "true");
    fetch(JSON_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(render)
      .catch(function () {
        renderError(list, postings);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
