/**
 * projects.js — bitcircus101 "Projekte" view switcher (donations.html#projekte).
 *
 * The funding section ships a quiet default "Liste" view (rendered by finanz.js
 * into #projekte-overview / #projekte-list / #projekte-updated) plus alternate visual
 * templates the visitor can pick. The choice persists in localStorage
 * (bc-projects-tpl) and is switchable any time. Calm theme + OS reduced-motion
 * freeze animated templates to a still frame (consistent with stage.js).
 *
 * Templates are self-contained modules registered via
 * registerProjectTemplate({ id, title, mini, render }); they receive the parsed
 * finanz.json (the einmalig list) plus a small env and build into a host element.
 * The modules below
 * are inlined from tmp/projects-build/<id>.js (assembled by cat — no CI step).
 * Plain vanilla ES5 — no dependencies.
 */
(function () {
  "use strict";

  var section = document.getElementById("projekte");
  var pickerHost = document.getElementById("projects-picker");
  var altHost = document.getElementById("projects-alt");
  if (!section || !pickerHost || !altHost) return; // not on this page

  var root = document.documentElement;
  var Core = window.FinanzCore;
  var KOFI_PROFILE = "https://ko-fi.com/bmabma";
  var STORE_KEY = "bc-projects-tpl";
  var JSON_URL = "finanz.json";

  var reduce = false;
  try { reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
  function isCalm() { return root.getAttribute("data-theme") === "calm"; }
  function isStill() { return reduce || isCalm(); }
  function lsGet() { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(STORE_KEY, v); } catch (e) {} }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Default mounts owned by finanz.js (the quiet "Liste" view).
  var defaultMounts = [
    document.getElementById("projekte-overview"),
    document.getElementById("projekte-list"),
    document.getElementById("projekte-updated")
  ];
  function setHidden(el, h) { if (!el) return; if (h) el.setAttribute("hidden", ""); else el.removeAttribute("hidden"); }
  function showDefault(show) { var i; for (i = 0; i < defaultMounts.length; i++) setHidden(defaultMounts[i], !show); }

  // ── Template registry (the inlined modules call this) ───────────────────────
  var TEMPLATES = [];
  function registerProjectTemplate(def) { if (def && def.id) TEMPLATES.push(def); }
  function tplById(id) { var i; for (i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return null; }

  var DATA = null;
  var activeId = "list";
  var teardowns = []; // active template's cleanups (timers/raf); modules push via env.onTeardown

  function runTeardown() {
    var i;
    for (i = 0; i < teardowns.length; i++) { try { teardowns[i](); } catch (e) {} }
    teardowns = [];
  }
  function clearAlt() {
    while (altHost.firstChild) altHost.removeChild(altHost.firstChild);
    altHost.className = "projects-alt";
  }
  function envFor() {
    return {
      Core: Core, still: isStill(), calm: isCalm(), esc: esc,
      kofiProfile: KOFI_PROFILE,
      onTeardown: function (fn) { if (typeof fn === "function") teardowns.push(fn); }
    };
  }
  function fallbackToList() {
    runTeardown();
    clearAlt();
    setHidden(altHost, true);
    activeId = "list";
    showDefault(true);
    markPicker();
  }
  function renderAlt(def) {
    runTeardown();
    clearAlt();
    setHidden(altHost, false);
    if (!DATA || !Core) { fallbackToList(); return; }
    // Render into a CHILD .pj-<id> so the modules' scoped selectors
    // (.projects-alt .pj-<id> …) match — the host stays .projects-alt only.
    var mount = document.createElement("div");
    mount.className = "pj-" + def.id;
    altHost.appendChild(mount);
    try { def.render(mount, DATA, envFor()); }
    catch (e) { fallbackToList(); }
  }

  function activate(id, persist) {
    var def = id === "list" ? null : tplById(id);
    if (id !== "list" && !def) id = "list";
    runTeardown();
    activeId = id;
    if (persist !== false) lsSet(id);
    if (id === "list") {
      clearAlt();
      setHidden(altHost, true);
      showDefault(true);
    } else {
      showDefault(false);
      renderAlt(def);
    }
    markPicker();
  }

  // ── Picker ──────────────────────────────────────────────────────────────────
  function markPicker() {
    var tiles = pickerHost.querySelectorAll(".pj-pick__tile"), i;
    for (i = 0; i < tiles.length; i++)
      tiles[i].setAttribute("aria-current", String(tiles[i].getAttribute("data-id") === activeId));
  }
  function makeTile(id, title, mini) {
    var tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pj-pick__tile";
    tile.setAttribute("data-id", id);
    tile.setAttribute("aria-label", "Ansicht: " + title);
    var pre = document.createElement("pre");
    pre.className = "pj-pick__mini";
    pre.setAttribute("aria-hidden", "true");
    pre.textContent = mini || "";
    var label = document.createElement("span");
    label.className = "pj-pick__label";
    label.textContent = title;
    tile.appendChild(pre);
    tile.appendChild(label);
    tile.addEventListener("click", function () { activate(id, true); });
    return tile;
  }
  function renderPicker() {
    while (pickerHost.firstChild) pickerHost.removeChild(pickerHost.firstChild);
    pickerHost.appendChild(makeTile("list", "Liste", "▸ Projekt\n▸ Projekt\n▸ Projekt"));
    var i, def, mini;
    for (i = 0; i < TEMPLATES.length; i++) {
      def = TEMPLATES[i];
      mini = "";
      try { mini = def.mini ? def.mini() : ""; } catch (e) { mini = ""; }
      pickerHost.appendChild(makeTile(def.id, def.title || def.id, mini));
    }
    markPicker();
  }

  // Live calm/theme toggle re-renders the active alternate as a still frame.
  if (window.MutationObserver) {
    var themeObs = new MutationObserver(function () {
      if (activeId !== "list" && DATA) { var d = tplById(activeId); if (d) renderAlt(d); }
    });
    themeObs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function start() {
    renderPicker();
    var stored = lsGet() || "list";
    if (stored !== "list" && tplById(stored)) {
      // Hide the default mounts synchronously so there is no flash before fetch.
      showDefault(false);
      activeId = stored;
      markPicker();
    }
    if (!Core) { activate("list", false); return; }
    fetch(JSON_URL)
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .then(function (d) {
        // Normalise so every template can read data.einmalig/.monatlich as
        // arrays (some templates deref .length directly) — a missing key in
        // finanz.json then degrades to "empty", never throws.
        d = d || {};
        d.einmalig = d.einmalig || [];
        d.monatlich = d.monatlich || [];
        DATA = d;
        activate(activeId, false);
      })
      .catch(function () { activate("list", false); });
  }

  // ╔══ TEMPLATE MODULES — inlined from tmp/projects-build/<id>.js ═════════════╗
registerProjectTemplate({
  id: "ascii",
  title: "ASCII-Board",

  // Decorative mini preview for the picker tile (<=6 lines, <=16 cols).
  mini: function () {
    return (
      "╔══════════╗\n" +
      "║ P01 ███░░ ║\n" +
      "║ P02 █░░░░ ║\n" +
      "║ P03 █████ ║\n" +
      "╟──────────╢\n" +
      "╚══════════╝"
    );
  },

  render: function (host, data, env) {
    var Core = env.Core;
    var esc  = env.esc;

    // ── build the board lines as plain text ──────────────────────────────────
    // Layout constants.  The bar width comes from Core's default (20 chars);
    // every row is built to the same width so box-drawing aligns perfectly.
    var BAR_W   = 20;   // must match Core.BAR_WIDTH
    var COL_SEP = " ";  // single space between columns inside the box

    // Compute per-goal views.
    var views = [];
    var i, g, v;
    for (i = 0; i < data.einmalig.length; i++) {
      g = data.einmalig[i];
      v = Core.computeGoal(g, { currency: data.currency, barWidth: BAR_W });
      views.push({ goal: g, view: v });
    }

    // Aggregate row.
    var agg = Core.aggregate(data.einmalig, { currency: data.currency, barWidth: BAR_W });

    // Column widths (we size to the content then fix them so all rows align).
    // Name column: longest title (with icon prefix) or minimum 16 chars.
    var NAME_MIN = 16;
    var nameW = NAME_MIN;
    for (i = 0; i < views.length; i++) {
      var nameCandidate = views[i].goal.icon + " " + views[i].goal.title;
      if (nameCandidate.length > nameW) { nameW = nameCandidate.length; }
    }
    // Total row label:
    var TOTAL_LABEL = "GESAMT";
    if (TOTAL_LABEL.length > nameW) { nameW = TOTAL_LABEL.length; }

    // Amount column: raised / target, e.g. "1.450 € / 3.000 €".
    // Pre-render to find max width.
    var amtParts = [];
    var amtW = 0;
    for (i = 0; i < views.length; i++) {
      v = views[i].view;
      var amtStr = Core.formatAmount(v.raised, v.currency) + " / " + Core.formatAmount(v.target, v.currency);
      amtParts.push(amtStr);
      if (amtStr.length > amtW) { amtW = amtStr.length; }
    }
    var aggAmtStr = Core.formatAmount(agg.totalRaised, data.currency) + " / " + Core.formatAmount(agg.totalTarget, data.currency);
    if (aggAmtStr.length > amtW) { amtW = aggAmtStr.length; }

    // PCT column: "100%" — always 4 chars.
    var PCT_W = 4;

    // Status column: "✓ erreicht" or "unterstützen ↗" (for unreached goals).
    var STATUS_REACHED  = "✓ erreicht";       // ✓ erreicht
    var STATUS_DONATE   = "unterstützen ↗";   // unterstützen ↗
    var STATUS_AGG      = "";
    // Width fits the longer of the two states so neither gets truncated by pad().
    var STATUS_W = Math.max(STATUS_REACHED.length, STATUS_DONATE.length);

    // Inner content width:
    // "| " + name(nameW) + " " + bar(BAR_W) + " " + pct(PCT_W) + " " + amt(amtW) + " " + status(STATUS_W) + " |"
    var INNER_W = nameW + 1 + BAR_W + 1 + PCT_W + 1 + amtW + 1 + STATUS_W;
    // Full line width including "| " and " |": INNER_W + 4
    var BOX_W = INNER_W + 4;

    // Helper: pad a string to exactly n chars (space-pad right).
    function pad(s, n) {
      var r = s;
      while (r.length < n) { r += " "; }
      return r.slice(0, n);
    }

    // Helper: right-align a string in n chars.
    function rpad(s, n) {
      var r = s;
      while (r.length < n) { r = " " + r; }
      return r.slice(r.length - n);
    }

    // Helper: repeat a char n times.
    function rep(ch, n) {
      var s = "";
      for (var k = 0; k < n; k++) { s += ch; }
      return s;
    }

    // Box-drawing chars.
    var TL = "╔", TR = "╗", BL = "╚", BR = "╝"; // ╔╗╚╝
    var H  = "═";                                               // ═
    var V  = "║";                                               // ║
    var ML = "╠", MR = "╣";                               // ╠╣  (heavy divider)
    var DL = "╟", DR = "╢";                               // ╟╢  (light divider)
    var DH = "─";                                               // ─  (light horiz)

    // Build lines array.
    var lines = [];

    // ── Header row ──────────────────────────────────────────────────────────
    // Title centred, then updated timestamp right-aligned.
    var BOARD_TITLE = "BITCIRCUS PROJEKTE";
    var updatedStr  = data.updated ? "Stand: " + data.updated : "";
    // Header content must fit INNER_W chars.
    var headerContent;
    if (updatedStr.length + BOARD_TITLE.length + 2 <= INNER_W) {
      // title left, updated right — padded between
      headerContent = BOARD_TITLE + rep(" ", INNER_W - BOARD_TITLE.length - updatedStr.length) + updatedStr;
    } else {
      headerContent = pad(BOARD_TITLE, INNER_W);
    }

    lines.push(TL + rep(H, INNER_W + 2) + TR);
    lines.push(V + " " + headerContent + " " + V);
    lines.push(ML + rep(H, INNER_W + 2) + MR);

    // ── Column label row ────────────────────────────────────────────────────
    var colLabel = (
      pad("Projekt", nameW) + " " +
      pad("Fortschritt", BAR_W) + " " +
      rpad("", PCT_W) + " " +
      pad("Gesammelt / Gesamt", amtW) + " " +
      pad("", STATUS_W)
    );
    // Trim to INNER_W (safety).
    colLabel = pad(colLabel, INNER_W);
    lines.push(V + " " + colLabel + " " + V);
    lines.push(DL + rep(DH, INNER_W + 2) + DR);

    // ── One row per Projekt ─────────────────────────────────────────────────
    for (i = 0; i < views.length; i++) {
      g    = views[i].goal;
      v    = views[i].view;
      var icon     = g.icon || "";
      var nameStr  = pad(icon + (icon ? " " : "") + g.title, nameW);
      var barStr   = v.bar.filled + v.bar.empty;   // exactly BAR_W chars
      var pctStr   = rpad(v.pct + "%", PCT_W);
      var amtStr2  = pad(amtParts[i], amtW);
      var statusStr;
      if (v.reached) {
        statusStr = pad(STATUS_REACHED, STATUS_W);
      } else {
        statusStr = pad(STATUS_DONATE, STATUS_W);
      }
      var rowStr = nameStr + " " + barStr + " " + pctStr + " " + amtStr2 + " " + statusStr;
      rowStr = pad(rowStr, INNER_W);
      lines.push(V + " " + rowStr + " " + V);
    }

    // ── Separator + aggregate row ────────────────────────────────────────────
    lines.push(DL + rep(DH, INNER_W + 2) + DR);

    var aggName    = pad(TOTAL_LABEL, nameW);
    var aggBar     = agg.bar.filled + agg.bar.empty;
    var aggPct     = rpad(agg.pct + "%", PCT_W);
    var aggAmt     = pad(aggAmtStr, amtW);
    var aggReached = agg.reachedCount + "/" + agg.count + " erreicht";
    // Fit aggReached into STATUS_W.
    var aggStatus  = pad(aggReached, STATUS_W);
    var aggRow     = aggName + " " + aggBar + " " + aggPct + " " + aggAmt + " " + aggStatus;
    aggRow = pad(aggRow, INNER_W);
    lines.push(V + " " + aggRow + " " + V);

    lines.push(BL + rep(H, INNER_W + 2) + BR);

    // ── Build DOM ────────────────────────────────────────────────────────────
    // Outer wrapper — flex column so board + links stack.
    var wrap = document.createElement("div");
    wrap.className = "pj-ascii__wrap";

    // Accessibility: sr-only progressbar elements for each goal + total.
    var a11yDiv = document.createElement("div");
    a11yDiv.className = "pj-ascii__a11y";
    for (i = 0; i < views.length; i++) {
      v = views[i].view;
      var pb = document.createElement("div");
      pb.setAttribute("role", "progressbar");
      pb.setAttribute("aria-valuemin", "0");
      pb.setAttribute("aria-valuemax", "100");
      pb.setAttribute("aria-valuenow", String(v.pct));
      pb.setAttribute("aria-label", esc(v.title) + ": " + v.pct + "% finanziert");
      a11yDiv.appendChild(pb);
    }
    // Total progressbar.
    var totalPb = document.createElement("div");
    totalPb.setAttribute("role", "progressbar");
    totalPb.setAttribute("aria-valuemin", "0");
    totalPb.setAttribute("aria-valuemax", "100");
    totalPb.setAttribute("aria-valuenow", String(agg.pct));
    totalPb.setAttribute("aria-label", "Gesamt: " + agg.pct + "% finanziert");
    a11yDiv.appendChild(totalPb);
    wrap.appendChild(a11yDiv);

    // The visual board — a <pre> for monospace/box-drawing.
    var pre = document.createElement("pre");
    pre.className = "pj-ascii__board";
    pre.setAttribute("aria-hidden", "true");   // a11y info already in a11yDiv
    wrap.appendChild(pre);

    // Donate links row — one per unreached goal + global fallback.
    var linksRow = document.createElement("div");
    linksRow.className = "pj-ascii__links";
    for (i = 0; i < views.length; i++) {
      g = views[i].goal;
      v = views[i].view;
      if (!v.reached) {
        var a = document.createElement("a");
        a.href   = g.kofi || env.kofiProfile;
        a.target = "_blank";
        a.rel    = "noopener noreferrer";
        a.className = "pj-ascii__link";
        a.innerHTML = (g.icon ? esc(g.icon) + " " : "") + esc(g.title) + " &#x2197;";
        linksRow.appendChild(a);
      }
    }
    // If all reached, a generic link.
    if (linksRow.childNodes.length === 0) {
      var allA = document.createElement("a");
      allA.href   = env.kofiProfile;
      allA.target = "_blank";
      allA.rel    = "noopener noreferrer";
      allA.className = "pj-ascii__link";
      allA.textContent = "Ko-fi ↗";
      linksRow.appendChild(allA);
    }
    wrap.appendChild(linksRow);

    host.appendChild(wrap);

    // ── Render: still vs. typewriter ─────────────────────────────────────────
    if (env.still) {
      // Static frame: dump all lines at once.
      pre.textContent = lines.join("\n");
      return;
    }

    // Typewriter reveal: reveal one line at a time, then stop — no looping.
    var revealed = 0;
    var DELAY_MS = 60;   // ms per line

    function revealNext() {
      if (revealed > lines.length) { return; }
      pre.textContent = lines.slice(0, revealed).join("\n");
      revealed++;
      if (revealed <= lines.length) {
        var h = setTimeout(revealNext, DELAY_MS);
        env.onTeardown(function () { clearTimeout(h); });
      }
    }

    // Kick off the first reveal tick.
    var h0 = setTimeout(revealNext, DELAY_MS);
    env.onTeardown(function () { clearTimeout(h0); });
  }
});
registerProjectTemplate({
  id: "bootlog",
  title: "Boot-Log",

  mini: function () {
    return "[OK ] Projekt 1\n[INF] 62%\n[OK ] Projekt 2\n[SYS] done_";
  },

  render: function (host, data, env) {
    var Core = env.Core;
    var esc  = env.esc;

    // --- build the output line-by-line into a single <pre> inside a wrapper ---
    var wrap = document.createElement("div");
    wrap.className = "bl-wrap";
    host.appendChild(wrap);

    var pre = document.createElement("pre");
    pre.className = "bl-log";
    pre.setAttribute("aria-live", "polite");
    pre.setAttribute("aria-label", "Funding-Log");
    wrap.appendChild(pre);

    // Aggregate numbers
    var agg = Core.aggregate(data.einmalig, { currency: data.currency });

    // --- line builders ---

    // Each line is a <span> + newline text node.  We collect them in order,
    // then either reveal all at once (still) or typewriter-reveal them.

    var lines = [];  // { html: string, cls: string }
    var srBars = []; // invisible role=progressbar spans, rendered upfront for a11y

    function addLine(cls, html) {
      lines.push({ cls: cls, html: html });
    }

    // preamble
    addLine("bl-sys", "[SYS] bitcircus101 funding-daemon v1.0.0");
    addLine("bl-inf", "[INF] Lade Projekte aus /finanz.json …");
    addLine("bl-ok",
      "[OK ] " + data.einmalig.length + " Projekt" +
      (data.einmalig.length === 1 ? "" : "e") + " geladen"
    );
    addLine("bl-blank", "");

    // one block per goal
    var i;
    for (i = 0; i < data.einmalig.length; i++) {
      var g    = data.einmalig[i];
      var view = Core.computeGoal(g, { currency: data.currency });

      var iconGlyph = esc(g.icon ? g.icon : "");
      var titleStr  = esc(g.title || "");
      var tagStr    = esc(g.tagline || "");
      var raisedFmt = Core.formatAmount(view.raised, view.currency);
      var targetFmt = Core.formatAmount(view.target, view.currency);
      var remainStr = view.reached
        ? "Projekt erreicht"
        : ("noch " + Core.formatAmount(view.remaining, view.currency));
      var donateHref = esc(g.kofi || env.kofiProfile);
      var statusTag  = view.reached ? "[OK ]" : ("[" + view.pct + "%]");
      var statusCls  = view.reached ? "bl-ok" : "bl-amb";
      var barFilled  = esc(view.bar.filled);
      var barEmpty   = esc(view.bar.empty);

      // goal header line
      addLine("bl-hdr",
        "▸ PROJEKT: <span class='bl-title'>" + titleStr + "</span>" +
        (iconGlyph ? " <span class='bl-icon' aria-hidden='true'>" + iconGlyph + "</span>" : "")
      );

      if (tagStr) {
        addLine("bl-dim", "  " + tagStr);
      }

      // progressbar line — carries ARIA role
      addLine("bl-bar",
        "  <span class='bl-bar-filled' aria-hidden='true'>" + barFilled + "</span>" +
        "<span class='bl-bar-empty' aria-hidden='true'>" + barEmpty + "</span>" +
        " <span class='" + statusCls + "'>" + esc(statusTag) + "</span>"
      );

      // amounts line
      addLine("bl-amt",
        "  <span class='bl-raised'>" + esc(raisedFmt) + "</span>" +
        " / <span class='bl-target'>" + esc(targetFmt) + "</span>" +
        " — " + esc(remainStr)
      );

      // donate link line
      var linkText = view.reached ? "DANKE &lt;3" : "+ UNTERSTÜTZEN";
      var linkCls  = "bl-link" + (view.reached ? " bl-link-reached" : "");
      var ariaLbl  = view.reached
        ? "Danke – " + esc(g.title || "") + " wurde erreicht"
        : esc(g.title || "") + " via Ko-fi unterstuetzen";

      addLine("bl-link-line",
        "  <a class='" + linkCls + "'" +
        " href='" + donateHref + "'" +
        " target='_blank' rel='noopener noreferrer'" +
        " aria-label='" + ariaLbl + "'>" + linkText + "</a>"
      );

      // invisible progressbar for a11y (rendered upfront, not gated by typewriter)
      srBars.push(
        "<span role='progressbar'" +
        " aria-valuemin='0' aria-valuemax='100' aria-valuenow='" + view.pct + "'" +
        " aria-label='" + esc(g.title || "") + ": " + view.pct + "% finanziert'></span>"
      );

      addLine("bl-blank", "");
    }

    // aggregate summary
    var aggRaisedFmt = Core.formatAmount(agg.totalRaised, data.currency);
    var aggTargetFmt = Core.formatAmount(agg.totalTarget, data.currency);
    var aggBarFilled = esc(agg.bar.filled);
    var aggBarEmpty  = esc(agg.bar.empty);

    addLine("bl-sum-hdr", "▸ GESAMT-FORTSCHRITT");
    addLine("bl-bar",
      "  <span class='bl-bar-filled' aria-hidden='true'>" + aggBarFilled + "</span>" +
      "<span class='bl-bar-empty' aria-hidden='true'>" + aggBarEmpty + "</span>" +
      " <span class='bl-ok'>" + agg.pct + "%</span>"
    );
    addLine("bl-amt",
      "  <span class='bl-raised'>" + esc(aggRaisedFmt) + "</span>" +
      " / " + esc(aggTargetFmt) +
      " &mdash; <span class='bl-ok'>" + agg.reachedCount + "/" + agg.count + " Projekte</span>"
    );

    // invisible aggregate progressbar for a11y (rendered upfront)
    srBars.push(
      "<span role='progressbar'" +
      " aria-valuemin='0' aria-valuemax='100' aria-valuenow='" + agg.pct + "'" +
      " aria-label='Gesamt: " + agg.pct + "% finanziert'></span>"
    );

    // timestamp
    if (data.updated) {
      addLine("bl-blank", "");
      addLine("bl-ts", "[SYS] zuletzt aktualisiert: " + esc(data.updated));
    }

    // a11y progressbars rendered immediately (not gated behind the typewriter)
    if (srBars.length) {
      var srDiv = document.createElement("div");
      srDiv.className = "bl-sr-only";
      srDiv.innerHTML = srBars.join("");
      wrap.appendChild(srDiv);
    }

    // cursor line — appended last, always visible
    var cursorLine = document.createElement("span");
    cursorLine.className = "bl-cursor-line";
    cursorLine.setAttribute("aria-hidden", "true");
    cursorLine.innerHTML = "<span class='bl-prompt'>_</span><span class='bl-cursor'></span>";

    // --- render: still = instant, animated = typewriter ---

    if (env.still) {
      // Reveal all lines at once
      var html = "";
      for (i = 0; i < lines.length; i++) {
        if (lines[i].html === "") {
          html += "\n";
        } else {
          html += "<span class='" + lines[i].cls + "'>" + lines[i].html + "</span>\n";
        }
      }
      pre.innerHTML = html;
      pre.appendChild(cursorLine);
      return;
    }

    // Typewriter reveal: show one line every DELAY ms
    var DELAY = 60; // ms between lines
    var revealed = 0;

    function revealNext() {
      if (revealed >= lines.length) {
        // all done — append cursor
        pre.appendChild(cursorLine);
        return;
      }
      var line = lines[revealed];
      revealed++;

      var span;
      if (line.html === "") {
        pre.appendChild(document.createTextNode("\n"));
      } else {
        span = document.createElement("span");
        span.className = line.cls;
        span.innerHTML = line.html;
        pre.appendChild(span);
        pre.appendChild(document.createTextNode("\n"));
      }

      // keep last line visible (scroll into view in long lists)
      pre.scrollTop = pre.scrollHeight;

      var tid = setTimeout(revealNext, DELAY);
      env.onTeardown(function () { clearTimeout(tid); });
    }

    var startTid = setTimeout(revealNext, DELAY);
    env.onTeardown(function () { clearTimeout(startTid); });
  }
});
registerProjectTemplate({
  id: "gauges",
  title: "Cockpit",

  mini: function () {
    return (
      " .--.  .--.\n" +
      "( 73%) (42%)\n" +
      " '--'  '--'\n" +
      "  COCKPIT\n" +
      " GESAMT:61%"
    );
  },

  render: function (host, data, env) {
    var Core = env.Core;
    var esc  = env.esc;

    // Compute individual goal views and the aggregate
    var goals    = data.einmalig || [];
    var currency = data.currency || "EUR";
    var views    = [];
    var i;
    for (i = 0; i < goals.length; i++) {
      views.push(Core.computeGoal(goals[i], { currency: currency }));
    }
    var agg = Core.aggregate(goals, { currency: currency });

    // --- helpers ---

    // Map pct 0..100 to degrees 0..360 (capped)
    function pctToDeg(pct) {
      var deg = (pct / 100) * 360;
      return deg < 0 ? 0 : deg > 360 ? 360 : deg;
    }

    // Build the dial face background string using the per-slot @property variable.
    // This inline background is required because conic-gradient cannot animate
    // without a typed @property, and each slot needs its own named property.
    function dialBackground(angleVar) {
      return (
        "radial-gradient(circle at center, var(--bg-panel) 60%, transparent 61%)," +
        " conic-gradient(var(--accent) var(" + angleVar + "), var(--border) 0)"
      );
    }

    // Build one bezel+dial element.
    // Returns { bezel, dial, angleVar, finalDeg } for the animation queue.
    function buildDial(title, icon, pct, reached, isMaster, slotKey) {
      var angleVar  = "--pj-gauges-angle-" + slotKey;
      var finalDeg  = pctToDeg(pct);
      var pctRound  = Math.round(pct);

      // Bezel
      var bezel = document.createElement("div");
      bezel.className = "pjg-bezel" +
        (isMaster  ? " pjg-bezel--master"  : "") +
        (reached   ? " pjg-bezel--reached" : "");

      // Reached badge (decorative)
      if (reached) {
        var badge = document.createElement("div");
        badge.className = "pjg-reached-badge";
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = "✓"; // ✓
        bezel.appendChild(badge);
      }

      // Dial face
      var dial = document.createElement("div");
      dial.className = "pjg-dial" + (reached ? " pjg-dial--reached" : "");
      dial.setAttribute("role",          "progressbar");
      dial.setAttribute("aria-valuemin", "0");
      dial.setAttribute("aria-valuemax", "100");
      dial.setAttribute("aria-valuenow", String(pctRound));
      dial.setAttribute("aria-label",    esc(title) + ": " + pctRound + "% finanziert");
      dial.setAttribute("data-slot",     slotKey);

      // Set the conic-gradient background (inline because it references the
      // per-slot @property — this is the data-driven inline style exception).
      // Start at 0 deg; animation triggers below after DOM insertion.
      dial.style.setProperty(angleVar, env.still ? (finalDeg + "deg") : "0deg");
      dial.style.background = dialBackground(angleVar);

      // Inner content: icon + percentage
      var inner = document.createElement("div");
      inner.className = "pjg-dial-inner";
      inner.setAttribute("aria-hidden", "true");

      var iconEl = document.createElement("span");
      iconEl.className = "pjg-dial-icon";
      iconEl.textContent = icon || "◉"; // ◉ fallback

      var pctEl = document.createElement("div");
      pctEl.className = "pjg-dial-pct" + (isMaster ? " pjg-dial-pct--master" : "");
      pctEl.textContent = pctRound + "%";

      inner.appendChild(iconEl);
      inner.appendChild(pctEl);
      dial.appendChild(inner);
      bezel.appendChild(dial);

      return { bezel: bezel, dial: dial, angleVar: angleVar, finalDeg: finalDeg };
    }

    // --- build panel ---

    var panel = document.createElement("div");
    panel.className = "pjg-panel";

    // Header label (decorative, aria-hidden)
    var label = document.createElement("div");
    label.className = "pjg-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = "◈ FUNDING STATUS PANEL ◈"; // ◈ … ◈
    panel.appendChild(label);

    // -- Master dial section --
    var masterSection = document.createElement("div");
    masterSection.className = "pjg-master-section";

    var masterLbl = document.createElement("div");
    masterLbl.className = "pjg-master-lbl";
    masterLbl.setAttribute("aria-hidden", "true");
    masterLbl.textContent = "── GESAMT ──"; // ── GESAMT ──
    masterSection.appendChild(masterLbl);

    var allReached = agg.count > 0 && agg.reachedCount === agg.count;
    var masterResult = buildDial(
      "Gesamt",
      "▣ GESAMT",  // ▣ GESAMT
      agg.pct,
      allReached,
      true,
      "master"
    );
    masterSection.appendChild(masterResult.bezel);

    // Aggregate stats strip
    var aggStrip = document.createElement("div");
    aggStrip.className = "pjg-agg-strip";

    var aggTotal = document.createElement("span");
    aggTotal.innerHTML =
      "Gesamt: <b>" + esc(Core.formatAmount(agg.totalRaised, currency)) + "</b>" +
      " / " + esc(Core.formatAmount(agg.totalTarget, currency));
    aggStrip.appendChild(aggTotal);

    var aggProj = document.createElement("span");
    aggProj.innerHTML =
      "Projekte: <b>" + agg.reachedCount + " / " + agg.count + "</b> erreicht";
    aggStrip.appendChild(aggProj);

    masterSection.appendChild(aggStrip);
    panel.appendChild(masterSection);

    // -- Individual goals row --
    var row = document.createElement("div");
    row.className = "pjg-dials-row";

    // Collect dials for the post-insert animation queue
    var animQueue = [masterResult];

    for (i = 0; i < goals.length; i++) {
      var g    = goals[i];
      var view = views[i];

      // Wrap: bezel + meta
      var wrap = document.createElement("div");
      wrap.className = "pjg-dial-wrap";

      var result = buildDial(
        view.title,
        g.icon || "◉",
        view.pct,
        view.reached,
        false,
        // Animation @property slots are declared for master + 0..4 (gauges.css);
        // a 6th+ goal still renders its correct final angle but won't animate the sweep.
        String(i)
      );
      wrap.appendChild(result.bezel);
      animQueue.push(result);

      // Meta below the bezel
      var meta = document.createElement("div");
      meta.className = "pjg-dial-meta";

      var titleEl = document.createElement("div");
      titleEl.className = "pjg-dial-title";
      titleEl.textContent = g.title || "";

      var taglineEl = document.createElement("div");
      taglineEl.className = "pjg-dial-tagline";
      taglineEl.textContent = g.tagline || "";

      var amountEl = document.createElement("div");
      amountEl.className = "pjg-dial-amount";
      amountEl.setAttribute("aria-label",
        Core.formatAmount(view.raised, currency) + " von " +
        Core.formatAmount(view.target, currency));
      amountEl.textContent =
        Core.formatAmount(view.raised, currency) +
        " / " +
        Core.formatAmount(view.target, currency);

      meta.appendChild(titleEl);
      meta.appendChild(taglineEl);
      meta.appendChild(amountEl);

      // Donate link
      var href = g.kofi || env.kofiProfile;
      if (href) {
        var btn = document.createElement("a");
        btn.className = "pjg-donate-btn";
        btn.href = href;
        btn.target = "_blank";
        btn.rel = "noopener noreferrer";
        btn.textContent = view.reached ? "Danke ♥" : "+ Unterstützen";
        meta.appendChild(btn);
      }

      wrap.appendChild(meta);
      row.appendChild(wrap);
    }

    panel.appendChild(row);

    // Updated timestamp
    if (data.updated) {
      var updated = document.createElement("div");
      updated.className = "pjg-updated";
      updated.textContent = "zuletzt aktualisiert: " + data.updated;
      panel.appendChild(updated);
    }

    host.appendChild(panel);

    // --- Trigger needle sweep animations ---
    // If env.still, angles are already set to final values; skip animation.
    if (!env.still) {
      // Double-rAF ensures the DOM is laid out and initial 0deg is registered
      // before we set the final angle (required for CSS transition to fire).
      var raf1 = requestAnimationFrame(function () {
        var raf2 = requestAnimationFrame(function () {
          var j;
          for (j = 0; j < animQueue.length; j++) {
            var item = animQueue[j];
            item.dial.style.setProperty(
              item.angleVar,
              item.finalDeg + "deg"
            );
          }
        });
        env.onTeardown(function () { cancelAnimationFrame(raf2); });
      });
      env.onTeardown(function () { cancelAnimationFrame(raf1); });
    }
  }
});
registerProjectTemplate({
  id: "wells",
  title: "Pixel-Wells",

  // Tiny ASCII tile for the picker gallery (<=6 lines, <=16 cols)
  mini: function () {
    return (
      " [==] [  ] [= ]\n" +
      " |##| |  | |# |\n" +
      " |##| |  | |# |\n" +
      " |##| |  | |# |\n" +
      " |##| |  | |# |\n" +
      " +--+ +--+ +--+"
    );
  },

  render: function (host, data, env) {
    // ── Config ────────────────────────────────────────────────────────────
    var WELL_ROWS  = 16;
    var WELL_COLS  = 4;
    var TOTAL_CELLS = WELL_ROWS * WELL_COLS;

    var Core  = env.Core;
    var esc   = env.esc;
    var still = env.still;

    // ── Helper: per-cell brightness offset (bottom=warm/dim, top=cool/bright) ──
    function cellBrightness(rowFromBottom, totalRows) {
      // returns a % offset for the lit gradient: -10% at bottom, +20% at top
      var ratio = rowFromBottom / (totalRows - 1 || 1);
      return Math.round(-10 + ratio * 30);
    }

    // ── Build a single well element for one goal ──────────────────────────
    function buildWell(g, view) {
      var wrapper = document.createElement("article");
      wrapper.className = "pj-wells-well" + (view.reached ? " pj-wells-complete" : "");
      wrapper.setAttribute("data-id", g.id);

      // -- Header --
      var header = document.createElement("div");
      header.className = "pj-wells-header";

      var iconEl = document.createElement("span");
      iconEl.className = "pj-wells-icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.textContent = g.icon || "◆"; // ◆ fallback
      header.appendChild(iconEl);

      var titleEl = document.createElement("div");
      titleEl.className = "pj-wells-title";
      titleEl.innerHTML = esc(g.title);
      header.appendChild(titleEl);

      if (g.tagline) {
        var tagEl = document.createElement("div");
        tagEl.className = "pj-wells-tagline";
        tagEl.innerHTML = esc(g.tagline);
        header.appendChild(tagEl);
      }

      wrapper.appendChild(header);

      // -- Silo (cell grid) --
      var silo = document.createElement("div");
      silo.className = "pj-wells-silo";

      var grid = document.createElement("div");
      grid.className = "pj-wells-grid";
      grid.setAttribute("aria-hidden", "true");

      // Number of lit cells, filling from the bottom upward
      var litN = Math.round(view.pct / 100 * TOTAL_CELLS);
      // In still mode, cap animation per-cell; otherwise stagger with delay
      var r, c, cell, bottomIdx, isLit, rowFromBottom, brightness, delay;

      for (r = 0; r < WELL_ROWS; r++) {
        for (c = 0; c < WELL_COLS; c++) {
          cell = document.createElement("div");
          cell.className = "pj-wells-cell";

          // bottomIdx: linear index from the BOTTOM of the grid
          // last row in DOM (r = WELL_ROWS-1) = bottom visual row
          bottomIdx = (WELL_ROWS - 1 - r) * WELL_COLS + c;
          isLit = bottomIdx < litN;

          if (isLit) {
            cell.className += " pj-wells-lit";
            rowFromBottom = WELL_ROWS - 1 - r;
            brightness = cellBrightness(rowFromBottom, WELL_ROWS);
            // Inline custom prop drives the CSS gradient (matches site idiom)
            cell.style.cssText = "--pj-wells-cb:" + brightness + "%";

            if (!still) {
              cell.className += " pj-wells-animate";
              // Stagger: bottom cells appear first; small per-col jitter
              delay = bottomIdx * 18 + c * 4;
              cell.style.cssText += ";animation-delay:" + delay + "ms";
            }
          }

          grid.appendChild(cell);
        }
      }

      silo.appendChild(grid);

      // Complete badge (CSS toggles via .pj-wells-complete parent)
      var badge = document.createElement("div");
      badge.className = "pj-wells-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = "✓ ERREICHT";
      silo.appendChild(badge);

      wrapper.appendChild(silo);

      // -- HUD (labels + a11y progressbar) --
      var hud = document.createElement("div");
      hud.className = "pj-wells-hud";

      // a11y progressbar (visible thin bar + ARIA)
      var pbWrap = document.createElement("div");
      pbWrap.className = "pj-wells-pbwrap";
      var pb = document.createElement("div");
      pb.className = "pj-wells-pb";
      pb.setAttribute("role", "progressbar");
      pb.setAttribute("aria-valuemin", "0");
      pb.setAttribute("aria-valuemax", "100");
      pb.setAttribute("aria-valuenow", String(view.pct));
      pb.setAttribute("aria-label", esc(g.title) + ": " + view.pct + "% finanziert");
      pb.style.width = view.pct + "%";
      pbWrap.appendChild(pb);
      hud.appendChild(pbWrap);

      // Percent readout
      var pctEl = document.createElement("div");
      pctEl.className = "pj-wells-pct";
      pctEl.textContent = view.pct + "%";
      hud.appendChild(pctEl);

      // Raised row
      var row1 = document.createElement("div");
      row1.className = "pj-wells-row";
      row1.innerHTML =
        "<span class=\"pj-wells-lbl\">GESAMMELT</span>" +
        "<span class=\"pj-wells-val\">" + esc(Core.formatAmount(view.raised, data.currency)) + "</span>";
      hud.appendChild(row1);

      // Target row
      var row2 = document.createElement("div");
      row2.className = "pj-wells-row";
      row2.innerHTML =
        "<span class=\"pj-wells-lbl\">BETRAG</span>" +
        "<span class=\"pj-wells-val\">" + esc(Core.formatAmount(view.target, data.currency)) + "</span>";
      hud.appendChild(row2);

      // Remaining / reached row
      var row3 = document.createElement("div");
      row3.className = "pj-wells-row";
      if (view.reached) {
        row3.innerHTML =
          "<span class=\"pj-wells-lbl\">STATUS</span>" +
          "<span class=\"pj-wells-rem pj-wells-done\">ERREICHT ✓</span>";
      } else {
        row3.innerHTML =
          "<span class=\"pj-wells-lbl\">NOCH</span>" +
          "<span class=\"pj-wells-rem\">" + esc(Core.formatAmount(view.remaining, data.currency)) + "</span>";
      }
      hud.appendChild(row3);

      wrapper.appendChild(hud);

      // -- Donate button --
      var btn = document.createElement("a");
      btn.className = "pj-wells-btn";
      btn.href = g.kofi || env.kofiProfile;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.textContent = view.reached ? "+ DANKE" : "+ UNTERSTÜTZEN";
      wrapper.appendChild(btn);

      return wrapper;
    }

    // ── Compute aggregate ─────────────────────────────────────────────────
    var agg = Core.aggregate(data.einmalig, { currency: data.currency });

    // ── Aggregate bar at the top ──────────────────────────────────────────
    var aggSection = document.createElement("div");
    aggSection.className = "pj-wells-agg";

    var aggLabel = document.createElement("div");
    aggLabel.className = "pj-wells-agg-label";
    aggLabel.innerHTML =
      "<span>ALLE PROJEKTE</span>" +
      "<span>" +
        esc(Core.formatAmount(agg.totalRaised, data.currency)) +
        " / " +
        esc(Core.formatAmount(agg.totalTarget, data.currency)) +
        " (" + agg.pct + "%)" +
      "</span>";
    aggSection.appendChild(aggLabel);

    var aggTrack = document.createElement("div");
    aggTrack.className = "pj-wells-agg-track";
    aggTrack.setAttribute("role", "progressbar");
    aggTrack.setAttribute("aria-valuemin", "0");
    aggTrack.setAttribute("aria-valuemax", "100");
    aggTrack.setAttribute("aria-valuenow", String(agg.pct));
    aggTrack.setAttribute("aria-label", "Gesamtfortschritt aller Projekte: " + agg.pct + "% finanziert");

    var aggFill = document.createElement("div");
    aggFill.className = "pj-wells-agg-fill";
    aggFill.style.width = agg.pct + "%";
    aggTrack.appendChild(aggFill);
    aggSection.appendChild(aggTrack);

    host.appendChild(aggSection);

    // ── Wells grid ────────────────────────────────────────────────────────
    var wellsGrid = document.createElement("div");
    wellsGrid.className = "pj-wells-grid-outer";

    var i, g, view, well;
    for (i = 0; i < data.einmalig.length; i++) {
      g = data.einmalig[i];
      view = Core.computeGoal(g, { currency: data.currency });
      well = buildWell(g, view);
      wellsGrid.appendChild(well);
    }

    host.appendChild(wellsGrid);

    // ── Updated timestamp ─────────────────────────────────────────────────
    if (data.updated) {
      var ts = document.createElement("div");
      ts.className = "pj-wells-updated";
      ts.textContent = "aktualisiert: " + data.updated;
      host.appendChild(ts);
    }

    // ── Animate: trigger CSS animations after a microtask so the DOM is painted ─
    // (Only runs when !still — cells already have animate class set above)
    // No persistent timers needed; CSS handles the one-shot animation.
    // Register a no-op teardown (nothing to clean up for CSS animations).
    if (!still) {
      env.onTeardown(function () {
        // CSS animations auto-finish; no timers to clear.
      });
    }
  }
});
  // ╚═══════════════════════════════════════════════════════════════════════════╝

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
