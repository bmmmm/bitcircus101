/**
 * finanz.js — bitcircus101 "Projekte & Kosten" renderer (donations.html#projekte).
 *
 * Loads finanz.json and renders terminal-style panels using the shared math in
 * finanz-core.js (window.FinanzCore). Two kinds of cost are kept apart on
 * purpose:
 *   • einmalig  — one-time goals with target/raised → animated ASCII bar per
 *                 project. No grand total is printed: the symbolic overall
 *                 progress lives in the footer "[ LIGHTS ON? ]" bar, never a
 *                 summed € figure (recurring + one-time money are never added).
 *   • monatlich — recurring monthly costs → NO bar, NO total; each shows its
 *                 per-month need and a "Pat*in werden" link.
 * The bars are pure ASCII — no third-party resource is needed to display
 * progress; only the "unterstützen" links leave the site (to Ko-fi).
 */
(function () {
  "use strict";

  var JSON_URL = "finanz.json";
  var KOFI_PROFILE = "https://ko-fi.com/bmabma";
  var Core = window.FinanzCore;
  var ANIM_MS = 750;

  var ICONS = {
    solar: "☀", // ☀
    iron: "⚙", // ⚙
    books: "≡", // ≡
    tool: "⚒", // ⚒
    chip: "▣", // ▣
  };

  var reduceMotion = false;
  try {
    reduceMotion = !!(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function iconFor(key) {
    // key may be a named glyph ("solar") or already a literal symbol ("☀").
    // Fall back to the key itself so finanz.json can carry symbols directly —
    // projects.js renders the icon verbatim, this keeps both views in sync.
    return ICONS[key] || key || "❖"; // ❖ default
  }

  function barMarkup(bar) {
    return (
      '<span class="projekt-bar__filled" aria-hidden="true">' +
      bar.filled +
      "</span>" +
      '<span class="projekt-bar__empty" aria-hidden="true">' +
      bar.empty +
      "</span>"
    );
  }

  // ── Markup: one-time items (einmalig) ─────────────────────────────────────

  function panelMarkup(g) {
    var reachedCls = g.reached ? " projekt-panel--reached" : "";
    var html =
      '<article class="projekt-panel' +
      reachedCls +
      '" id="goal-' +
      esc(g.id) +
      '" data-raised="' +
      g.raised +
      '" data-target="' +
      g.target +
      '">';

    html +=
      '<div class="projekt-panel__chrome" aria-hidden="true">' +
      '<span class="projekt-panel__dot"></span>' +
      '<span class="projekt-panel__path">~/projekte/' +
      esc(g.id) +
      "</span></div>";

    html += '<div class="projekt-panel__body">';
    html +=
      '<h2 class="projekt-panel__title">' +
      '<span class="projekt-panel__icon" aria-hidden="true">' +
      iconFor(g.icon) +
      "</span> " +
      esc(g.title) +
      "</h2>";
    if (g.tagline) {
      html += '<p class="projekt-panel__tagline">' + esc(g.tagline) + "</p>";
    }
    if (g.description) {
      html += '<p class="projekt-panel__desc">' + esc(g.description) + "</p>";
    }

    html +=
      '<div class="projekt-bar" role="progressbar" aria-valuemin="0"' +
      ' aria-valuemax="100" aria-valuenow="' +
      g.pct +
      '" aria-label="' +
      esc(g.title) +
      ": " +
      g.pct +
      '% finanziert">';
    html += barMarkup(g.bar);
    html += '<span class="projekt-bar__pct">' + g.pct + "%</span>";
    html += "</div>";

    html += '<p class="projekt-panel__amounts">';
    html +=
      '<span class="projekt-panel__raised">' +
      Core.formatAmount(g.raised, g.currency) +
      "</span>";
    html += ' <span class="projekt-panel__slash">/</span> ';
    html +=
      '<span class="projekt-panel__targetv">' +
      Core.formatAmount(g.target, g.currency) +
      "</span>";
    if (g.reached) {
      html += ' <span class="projekt-panel__reached">*** PROJEKT ERREICHT ***</span>';
    } else {
      html +=
        ' <span class="projekt-panel__remaining">· noch ' +
        Core.formatAmount(g.remaining, g.currency) +
        "</span>";
    }
    html += "</p>";

    html += '<div class="projekt-panel__actions">';
    html +=
      '<a class="projekt-action projekt-action--donate" href="' +
      esc(g.kofi || KOFI_PROFILE) +
      '" target="_blank" rel="noopener noreferrer">&gt;&nbsp;unterstützen' +
      '<span class="projekt-cursor" aria-hidden="true">▏</span></a>';
    if (g.kofiShop) {
      html +=
        '<a class="projekt-action projekt-action--shop" href="' +
        esc(g.kofiShop) +
        '" target="_blank" rel="noopener noreferrer">[ Ko-fi-Shop ]</a>';
    }
    html += "</div>";

    html += "</div></article>"; // body + article
    return html;
  }

  // ── Markup: recurring monthly costs (monatlich) ───────────────────────────
  // No bar and no total — recurring need is shown per item, "werde Pat*in".

  function monatlichMarkup(items, currency) {
    var html = '<div class="kosten-monatlich__panel">';
    html +=
      '<p class="kosten-monatlich__cmd" aria-hidden="true">$ funding --monatlich</p>';
    html +=
      '<p class="kosten-monatlich__lead">Laufende Kosten — Monat für Monat. ' +
      "Werde Pat*in und trag einen Teil davon.</p>";
    html += '<ul class="kosten-monatlich__list">';
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var icon = iconFor(m.icon);
      html += '<li class="kosten-monatlich__item">';
      html +=
        '<p class="kosten-monatlich__title">' +
        '<span class="kosten-monatlich__icon" aria-hidden="true">' +
        icon +
        "</span> " +
        esc(m.title) +
        ' <span class="kosten-monatlich__rate">' +
        Core.formatAmount(m.monthly, currency) +
        " / Monat</span></p>";
      if (m.tagline) {
        html +=
          '<p class="kosten-monatlich__tagline">' + esc(m.tagline) + "</p>";
      }
      if (m.description) {
        html +=
          '<p class="kosten-monatlich__desc">' + esc(m.description) + "</p>";
      }
      html +=
        '<a class="projekt-action projekt-action--donate" href="' +
        esc(m.kofi || KOFI_PROFILE) +
        '" target="_blank" rel="noopener noreferrer">&gt;&nbsp;Pat*in werden' +
        '<span class="projekt-cursor" aria-hidden="true">▏</span></a>';
      html += "</li>";
    }
    html += "</ul></div>";
    return html;
  }

  // ── Count-up animation (einmalig bars only) ───────────────────────────────

  function setText(el, sel, text) {
    var n = el.querySelector(sel);
    if (n) n.textContent = text;
  }

  function paintPanel(el, raised, target, currency) {
    var pct = Math.round(
      Math.min(100, Math.max(0, Core.rawPercent(raised, target)))
    );
    var bar = Core.asciiBar(pct, Core.BAR_WIDTH);
    setText(el, ".projekt-bar__filled", bar.filled);
    setText(el, ".projekt-bar__empty", bar.empty);
    setText(el, ".projekt-bar__pct", pct + "%");
    setText(el, ".projekt-panel__raised", Core.formatAmount(raised, currency));
  }

  function animatePanel(el, currency) {
    var target = parseFloat(el.getAttribute("data-target")) || 0;
    var finalRaised = parseFloat(el.getAttribute("data-raised")) || 0;
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / ANIM_MS, 1);
      var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      paintPanel(el, finalRaised * eased, target, currency);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function setupAnimations(container, currency) {
    var panels = container.querySelectorAll(".projekt-panel");
    if (!panels.length) return;
    if (
      reduceMotion ||
      !("IntersectionObserver" in window) ||
      !window.requestAnimationFrame
    ) {
      return; // final values already rendered in the markup
    }
    // Reset to zero before first paint so each panel visibly fills from empty.
    for (var i = 0; i < panels.length; i++) {
      paintPanel(
        panels[i],
        0,
        parseFloat(panels[i].getAttribute("data-target")) || 0,
        currency
      );
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animatePanel(entry.target, currency);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.35 }
    );
    for (var j = 0; j < panels.length; j++) io.observe(panels[j]);
  }

  // ── States ────────────────────────────────────────────────────────────────

  function loadingMarkup() {
    return (
      '<p class="projekte-loading"><span class="projekte-loading__cmd">' +
      "$ funding --load</span>" +
      '<span class="projekte-cursor" aria-hidden="true">▋</span></p>'
    );
  }

  function renderError(el) {
    el.innerHTML =
      '<div class="projekte-fallback">' +
      '<p class="projekte-fallback__cmd">$ funding --load ' +
      '<span class="projekte-fallback__err">ERR</span></p>' +
      "<p>Du kannst uns trotzdem direkt unterstützen: " +
      '<a href="' +
      KOFI_PROFILE +
      '" target="_blank" rel="noopener noreferrer">Ko-fi öffnen ↗</a></p></div>';
    el.removeAttribute("aria-busy");
  }

  function renderEmpty(el) {
    el.innerHTML =
      '<p class="projekte-empty">Aktuell stehen keine einmaligen Projekte aus. ' +
      '<a href="' +
      KOFI_PROFILE +
      '" target="_blank" rel="noopener noreferrer">Trotzdem unterstützen ↗</a></p>';
    el.removeAttribute("aria-busy");
  }

  function setHidden(el, hide) {
    if (!el) return;
    if (hide) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function render(data) {
    var list = document.getElementById("projekte-list");
    var updatedEl = document.getElementById("projekte-updated");
    var monatlichEl = document.getElementById("kosten-monatlich");
    if (!list) return;

    var currency = (data && data.currency) || "EUR";
    var einmalig = (data && data.einmalig) || [];
    var monatlich = (data && data.monatlich) || [];

    // ── One-time items → project list (no grand total) ──
    if (!einmalig.length) {
      renderEmpty(list);
    } else {
      var html = "";
      for (var i = 0; i < einmalig.length; i++) {
        var src = einmalig[i];
        var view = Core.computeGoal(src, { currency: currency });
        view.icon = src.icon;
        view.tagline = src.tagline;
        view.description = src.description;
        view.kofi = src.kofi;
        view.kofiShop = src.kofiShop;
        html += panelMarkup(view);
      }
      list.innerHTML = html;
      list.removeAttribute("aria-busy");
      setupAnimations(list, currency);
    }

    // ── Recurring monthly costs → own always-visible block ──
    if (monatlichEl) {
      if (monatlich.length) {
        monatlichEl.innerHTML = monatlichMarkup(monatlich, currency);
        setHidden(monatlichEl, false);
        monatlichEl.removeAttribute("aria-busy");
      } else {
        monatlichEl.innerHTML = "";
        setHidden(monatlichEl, true);
      }
    }

    if (updatedEl && data.updated) {
      updatedEl.textContent = "zuletzt aktualisiert: " + data.updated;
    }
  }

  function init() {
    var list = document.getElementById("projekte-list");
    if (!list) return;
    if (!Core) {
      renderError(list);
      return;
    }
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
