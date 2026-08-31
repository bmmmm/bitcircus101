/**
 * pulse.js — cryptic funding pulse renderer for support.html#projekte.
 *
 * Reads data.pulse.levels from finanz.json and renders a terminal-style
 * sparkline using FinanzCore.pulseSparkline (window.FinanzCore, loaded before
 * this script). Output is DELIBERATELY opaque: no digits, no "€", no
 * percentage — only 8 discrete bar glyphs (▁▂▃▄▅▆▇█) that show rhythm, not
 * amounts. Personal data is structurally impossible: pulse stores only integer
 * 0..7 levels, never a euro figure.
 *
 * Written in ES5 (IIFE, no let/const/arrow/template-literals/import/export)
 * so the browser loads it raw without a transpiler.
 */
(function () {
  "use strict";

  var JSON_URL = "finanz.json";
  var MOUNT_ID = "funding-pulse";

  // Detect prefers-reduced-motion once at module load time so every path is
  // consistent with the finanz.js convention.
  var reduceMotion = false;
  try {
    reduceMotion = !!(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch (e) {}

  function renderPulse(mount, levels) {
    var Core = window.FinanzCore;
    // Degrade silently if FinanzCore is not available or levels are absent.
    if (!Core || !levels || !levels.length) {
      mount.setAttribute("hidden", "");
      return;
    }

    var sparkline = Core.pulseSparkline(levels);
    if (!sparkline) {
      mount.setAttribute("hidden", "");
      return;
    }

    // Build the markup in pure string concatenation (ES5 — no template literals).
    // The prompt line gives it a terminal context; the sparkline itself carries
    // no digits, no currency, no percentage.
    var html =
      '<p class="pulse-prompt" aria-hidden="true">' +
      '<span class="pulse-prompt__cmd">$ funding --pulse</span>' +
      "</p>" +
      '<p class="pulse-sparkline">' +
      '<span class="pulse-sparkline__glyphs" aria-hidden="true">' +
      sparkline +
      "</span>" +
      "</p>" +
      '<p class="pulse-caption">grober Verlauf \xB7 keine Betr\xE4ge</p>';

    // Reveal before paint so CSS transition starts from the right state.
    mount.removeAttribute("hidden");

    if (reduceMotion) {
      // No animation: write final markup immediately.
      mount.innerHTML = html;
    } else {
      // One calm reveal: write with the fade-in class, CSS handles it.
      mount.innerHTML = html;
      mount.classList.add("pulse--reveal");
    }
  }

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    fetch(JSON_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var levels =
          data && data.pulse && Array.isArray(data.pulse.levels)
            ? data.pulse.levels
            : null;
        renderPulse(mount, levels);
      })
      .catch(function () {
        // Degrade silently — the pulse is cosmetic, not required.
        if (mount) mount.setAttribute("hidden", "");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
