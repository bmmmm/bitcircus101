/**
 * finanz.js — bitcircus101 "Projekte & Kosten" renderer (donations.html#projekte).
 *
 * Loads finanz.json and renders terminal-style panels using the shared math in
 * finanz-core.js (window.FinanzCore). Two kinds of cost are kept apart on
 * purpose:
 *   • einmalig  — one-time projects with target/raised → animated ASCII bar per
 *                 project. No grand total is printed: the symbolic overall
 *                 progress lives in the footer "[ LIGHTS ON? ]" bar, never a
 *                 summed € figure (recurring + one-time money are never added).
 *   • monatlich — recurring monthly costs → NO bar, NO total; each shows its
 *                 per-month need and an "Unterstützer:in werden" link.
 * The bars are pure ASCII — no third-party resource is needed to display
 * progress. Donate buttons stay on-site (jump to #dauerhaft) unless a project
 * ships its own Ko-fi page; the shared href policy lives in
 * FinanzCore.donateTarget so every view links consistently.
 */
(function () {
  "use strict";

  var JSON_URL = "finanz.json";
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

  function panelMarkup(p) {
    var reachedCls = p.reached ? " projekt-panel--reached" : "";
    var html =
      '<article class="projekt-panel' +
      reachedCls +
      '" id="projekt-' +
      esc(p.id) +
      '" data-raised="' +
      p.raised +
      '" data-target="' +
      p.target +
      '">';

    html +=
      '<div class="projekt-panel__chrome" aria-hidden="true">' +
      '<span class="projekt-panel__dot"></span>' +
      '<span class="projekt-panel__path">~/projekte/' +
      esc(p.id) +
      "</span></div>";

    html += '<div class="projekt-panel__body">';
    html +=
      '<h3 class="projekt-panel__title">' +
      '<span class="projekt-panel__icon" aria-hidden="true">' +
      iconFor(p.icon) +
      "</span> " +
      esc(p.title) +
      "</h3>";
    if (p.tagline) {
      html += '<p class="projekt-panel__tagline">' + esc(p.tagline) + "</p>";
    }
    if (p.description) {
      html += '<p class="projekt-panel__desc">' + esc(p.description) + "</p>";
    }

    html +=
      '<div class="projekt-bar" role="progressbar" aria-valuemin="0"' +
      ' aria-valuemax="100" aria-valuenow="' +
      p.pct +
      '" aria-label="' +
      esc(p.title) +
      ": " +
      p.pct +
      '% finanziert">';
    html += barMarkup(p.bar);
    html += '<span class="projekt-bar__pct">' + p.pct + "%</span>";
    html += "</div>";

    html += '<p class="projekt-panel__amounts">';
    html +=
      '<span class="projekt-panel__raised">' +
      Core.formatAmount(p.raised, p.currency) +
      "</span>";
    html += ' <span class="projekt-panel__slash">/</span> ';
    html +=
      '<span class="projekt-panel__targetv">' +
      Core.formatAmount(p.target, p.currency) +
      "</span>";
    if (p.reached) {
      html += ' <span class="projekt-panel__reached">*** PROJEKT ERREICHT ***</span>';
    } else {
      html +=
        ' <span class="projekt-panel__remaining">· noch ' +
        Core.formatAmount(p.remaining, p.currency) +
        "</span>";
    }
    html += "</p>";

    var dt = Core.donateTarget(p);
    html += '<div class="projekt-panel__actions">';
    html +=
      '<a class="projekt-action projekt-action--donate" href="' +
      esc(dt.href) +
      '"' +
      (dt.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
      ">&gt;&nbsp;unterstützen" +
      '<span class="projekt-cursor" aria-hidden="true">▏</span></a>';
    if (p.kofiShop) {
      html +=
        '<a class="projekt-action projekt-action--shop" href="' +
        esc(p.kofiShop) +
        '" target="_blank" rel="noopener noreferrer">[ Ko-fi-Shop ]</a>';
    }
    html += "</div>";

    html += "</div></article>"; // body + article
    return html;
  }

  // ── Markup: recurring monthly costs (monatlich) ───────────────────────────
  // Same card language as the one-time panels (projekt-panel) so both kinds
  // of cost read as one board; only the chrome path (~/kosten/ vs ~/projekte/),
  // the "/ Monat" rate (no bar, no total) and the "Unterstützer:in werden" link
  // mark them recurring.

  function monatlichCard(m, currency) {
    var html =
      '<article class="projekt-panel projekt-panel--monatlich" id="kosten-' +
      esc(m.id) +
      '">';

    html +=
      '<div class="projekt-panel__chrome" aria-hidden="true">' +
      '<span class="projekt-panel__dot"></span>' +
      '<span class="projekt-panel__path">~/kosten/' +
      esc(m.id) +
      "</span></div>";

    html += '<div class="projekt-panel__body">';
    html +=
      '<h3 class="projekt-panel__title">' +
      '<span class="projekt-panel__icon" aria-hidden="true">' +
      iconFor(m.icon) +
      "</span> " +
      esc(m.title) +
      "</h3>";
    if (m.tagline) {
      html += '<p class="projekt-panel__tagline">' + esc(m.tagline) + "</p>";
    }
    if (m.description) {
      html += '<p class="projekt-panel__desc">' + esc(m.description) + "</p>";
    }

    html +=
      '<p class="projekt-panel__amounts">' +
      '<span class="projekt-panel__raised">' +
      Core.formatAmount(m.monthly, currency) +
      "</span>" +
      ' <span class="projekt-panel__permonth">/ Monat</span></p>';

    var dt = Core.donateTarget(m);
    html += '<div class="projekt-panel__actions">';
    html +=
      '<a class="projekt-action projekt-action--donate" href="' +
      esc(dt.href) +
      '"' +
      (dt.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
      ">&gt;&nbsp;Unterstützer:in werden" +
      '<span class="projekt-cursor" aria-hidden="true">▏</span></a>';
    html += "</div>";

    html += "</div></article>"; // body + article
    return html;
  }

  function monatlichMarkup(items, currency) {
    var html = "";
    for (var i = 0; i < items.length; i++) {
      html += monatlichCard(items[i], currency);
    }
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
      '<a href="#dauerhaft">zu den Spendenwegen ↓</a></p></div>';
    el.removeAttribute("aria-busy");
  }

  function renderEmpty(el) {
    el.innerHTML =
      '<p class="projekte-empty">Aktuell stehen keine einmaligen Projekte aus. ' +
      '<a href="#dauerhaft">Trotzdem unterstützen ↓</a></p>';
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
        var view = Core.computeProject(src, { currency: currency });
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

    // ── Recurring monthly costs → rendered here, shown in the "Liste" view ──
    // Visibility is owned by the view switch (projects.js): it hides this mount
    // for the alternate templates, which fold the monthly costs in themselves.
    // So only fill it here; never force it visible (that would fight the switch).
    if (monatlichEl) {
      if (monatlich.length) {
        monatlichEl.innerHTML = monatlichMarkup(monatlich, currency);
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
