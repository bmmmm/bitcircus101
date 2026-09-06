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
 * is swapped, never the card's structure — and the title is one line by CSS
 * (nowrap, ellipsis; names are capped at 24 characters by the gate), so the
 * how-to below never moves. Without JavaScript, without the key, or when the
 * fetch fails, the static title stands. The cycle pauses while the card is
 * hovered, focused or touched and while the tab is hidden, and does not run
 * at all under prefers-reduced-motion (one random name for the visit then).
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
        '<a href="' + esc(clean[at].url) +
        '" target="_blank" rel="noopener noreferrer">' + esc(clean[at].name) + " ↗</a>";
    }
    show();
    if (clean.length < 2 || reduceMotion) return;

    // Three reasons to hold still, each its own flag: a name must not vanish
    // under the pointer, under the focus ring (show() replaces the <a>, and
    // focus would fall back to <body>), or between a finger touching down and
    // the click it becomes. Only when none of them holds — and the tab is
    // visible — does the cycle run; a resume from one reason never overrides
    // another. Every start() is a fresh interval, so the first swap after a
    // resume is a full SLOT_MS away — a tap can never land on a moving link.
    var timer = null;
    var held = { hover: false, focus: false, touch: false };
    function sync() {
      var hold = held.hover || held.focus || held.touch || document.hidden;
      if (hold && timer) {
        clearInterval(timer);
        timer = null;
      } else if (!hold && !timer) {
        timer = setInterval(function () {
          at = (at + 1) % clean.length;
          show();
        }, SLOT_MS);
      }
    }
    function holder(key, on) {
      return function () {
        held[key] = on;
        sync();
      };
    }
    card.addEventListener("mouseenter", holder("hover", true));
    card.addEventListener("mouseleave", holder("hover", false));
    card.addEventListener("focusin", holder("focus", true));
    card.addEventListener("focusout", holder("focus", false));
    card.addEventListener("touchstart", holder("touch", true), { passive: true });
    card.addEventListener("touchend", holder("touch", false));
    card.addEventListener("touchcancel", holder("touch", false));
    document.addEventListener("visibilitychange", sync);
    sync();
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
