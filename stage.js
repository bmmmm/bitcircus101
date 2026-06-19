/**
 * stage.js — bitcircus101 "Unterstützen" entry stage.
 *
 * Renders the animated ASCII support stage on support.html: a 9-scene picker,
 * an easter egg, and three support ways. Pure vanilla JS, no dependencies.
 * Scenes are self-contained modules registered via registerScene({id, title,
 * family, mini, create}); they talk to the shell only through `ctx`.
 *
 * Theme: the stage has no own light/dark switch — it follows the site-wide
 * `calm` theme (documentElement[data-theme="calm"], toggled in the nav). Both
 * calm and OS reduced-motion freeze the stage to a still frame; switching the
 * theme live re-renders the active scene. Stage-local colour vars are
 * namespaced --st-* and scoped to .support-stage so they never touch the site
 * palette (which uses --bg / --text).
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var stageWrap = document.querySelector(".support-stage");
  if (!stageWrap) return; // not on this page

  var reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var lsGet = BC.storage.get;
  var lsSet = BC.storage.set;

  // Stage stillness follows the site: calm theme OR OS reduced-motion. The site
  // CSS already halts every transition under [data-theme="calm"]; the stage is
  // JS-driven, so it freezes itself to a still frame to stay consistent.
  function isCalm() { return root.getAttribute("data-theme") === "calm"; }
  function isStill() { return reduce || isCalm(); }

  // ── Shared Pride palettes + glyphs ─────────────────────────────────────────
  var PRIDE_LOUD = ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"];
  var PRIDE_CALM = ["#9a4a4a", "#a07a4a", "#9a9a55", "#4a7a5a", "#4a5a8a", "#6a5580"];
  var GLYPHS = "01{}[]()<>/\\|=+-*.:;_$#@%&";
  function randGlyph() { return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)); }

  // ── ctx: the only API the scene modules see ────────────────────────────────
  var stage = document.getElementById("stage");
  var hintEl = document.getElementById("stageHint");
  var lastHint = "";
  // Teardown list of the ACTIVE scene (every/raf/on register here).
  var teardowns = [];
  function track(fn) { teardowns.push(fn); }
  function teardownActive() {
    var i; for (i = 0; i < teardowns.length; i++) { try { teardowns[i](); } catch (e) {} }
    teardowns = [];
  }
  function ctxEvery(baseMs, fn) {
    var stopped = false, h;
    function tick() { if (stopped) return; fn(); h = setTimeout(tick, Math.max(16, baseMs / speedMult)); }
    h = setTimeout(tick, Math.max(16, baseMs / speedMult));
    track(function () { stopped = true; clearTimeout(h); });
  }
  function ctxRaf(fn) {
    var stopped = false, id;
    function frame(ts) { if (stopped) return; fn(ts); id = requestAnimationFrame(frame); }
    id = requestAnimationFrame(frame);
    track(function () { stopped = true; if (id) cancelAnimationFrame(id); });
  }
  function ctxOn(target, type, handler) {
    target.addEventListener(type, handler);
    track(function () { target.removeEventListener(type, handler); });
  }
  function ctxFg() {
    var v = getComputedStyle(stage).getPropertyValue("--st-green");
    return v ? v.replace(/^\s+|\s+$/g, "") : "#4ade80";
  }
  function ctxPride() {
    return isCalm() ? PRIDE_CALM : PRIDE_LOUD;
  }
  function ctxHint(t) { if (!hintEl || t === lastHint) return; hintEl.textContent = t; lastHint = t; }

  // Grid sizing: how many monospace cells fill the current stage.
  function ctxGrid(fs, lhf, cpc, cwEm) {
    cpc = cpc || 1; cwEm = cwEm || 0.62;
    var w = stage.clientWidth, h = stage.clientHeight;
    return {
      cols: Math.max(8, Math.ceil(w / (fs * cwEm * cpc))),
      rows: Math.max(6, Math.ceil(h / (fs * lhf)) + 1)
    };
  }

  // Center a scene's actors as one block (re-runnable; resets transform first).
  function ctxCenter(host) {
    var kids = host.children, i, r,
        minL = 1e9, minT = 1e9, maxR = -1e9, maxB = -1e9, found = false;
    var hr = host.getBoundingClientRect();
    for (i = 0; i < kids.length; i++) { kids[i].style.transform = ""; }
    for (i = 0; i < kids.length; i++) {
      r = kids[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { continue; }
      found = true;
      if (r.left < minL) { minL = r.left; }
      if (r.top < minT) { minT = r.top; }
      if (r.right > maxR) { maxR = r.right; }
      if (r.bottom > maxB) { maxB = r.bottom; }
    }
    if (!found) { return; }
    var dx = Math.round((hr.width - (maxR - minL)) / 2 - (minL - hr.left));
    var dy = Math.round((hr.height - (maxB - minT)) / 2 - (minT - hr.top));
    for (i = 0; i < kids.length; i++) {
      kids[i].style.transform = "translate(" + dx + "px," + dy + "px)";
    }
  }

  var speedMult = (function () {
    var v = parseFloat(lsGet(BC.storage.KEYS.SPEED));
    return (isFinite(v) && v >= 0.5 && v <= 8) ? Math.round(v * 4) / 4 : 1;
  }());

  var stageOff = lsGet(BC.storage.KEYS.STAGE_OFF) === "1";

  function applyStageOff(off) {
    stageOff = off;
    lsSet(BC.storage.KEYS.STAGE_OFF, off ? "1" : "0");

    var sceneEl = document.getElementById("scene");
    var flashEl = document.getElementById("flash");
    var notice  = document.getElementById("stageOffNotice");
    var toggle  = document.getElementById("stageToggle");
    var fold    = document.querySelector(".support-stage .fold");

    if (sceneEl) sceneEl.hidden = off;
    if (flashEl) flashEl.hidden = off;
    if (notice)  notice.hidden  = !off;
    if (fold)    fold.hidden    = off;
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(!off));
      toggle.setAttribute("aria-label", off ? "Animation einschalten" : "Animation ausschalten");
      toggle.setAttribute("title",      off ? "Animation einschalten" : "Animation ausschalten");
    }

    if (off) {
      teardownActive();
      ctxHint("");
    } else {
      renderActive();
    }
  }

  // ctx.reduce is refreshed to isStill() before every scene create() (below), so
  // a live calm toggle makes the next render a still frame.
  var ctx = {
    reduce: isStill(),
    speed: function () { return speedMult; },
    calm: isCalm,
    colorMode: function () { return "color"; },
    contrast: function () { return 0; },
    every: ctxEvery,
    raf: ctxRaf,
    on: ctxOn,
    size: function () { return { w: stage.clientWidth, h: stage.clientHeight }; },
    fg: ctxFg,
    pride: ctxPride,
    glyph: randGlyph,
    hint: ctxHint,
    grid: ctxGrid,
    center: ctxCenter
  };

  // ── Scene registry ─────────────────────────────────────────────────────────
  var SCENES = [];
  function registerScene(def) { SCENES.push(def); }
  function sceneById(id) { var i; for (i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i]; return null; }

  var sceneHost = document.getElementById("scene");
  var sceneNameEl = document.getElementById("sceneName");
  var activeId = null, activeInst = null;
  var FAMILY_HINT = {
    regen: "Code-Regen läuft.",
    pride: "Pride-Regen — „pride“ tippen oder ❤ klicken.",
    knaeuel: "Beweg die Maus — die Katze spielt mit dem Knäuel."
  };
  function renderActive() {
    teardownActive();
    while (sceneHost.firstChild) sceneHost.removeChild(sceneHost.firstChild);
    var def = sceneById(activeId);
    if (!def) return;
    lastHint = "";
    ctxHint(FAMILY_HINT[def.family] || "");
    ctx.reduce = isStill();
    activeInst = def.create(sceneHost, ctx) || {};
    if (sceneNameEl) sceneNameEl.textContent = def.title;
    var tiles = document.querySelectorAll(".idea"), i;
    for (i = 0; i < tiles.length; i++) tiles[i].setAttribute("aria-current", String(tiles[i].getAttribute("data-id") === activeId));
  }
  function switchScene(id, persist) {
    if (id === activeId) return;
    if (!sceneById(id)) return;
    activeId = id;
    if (persist !== false) lsSet(BC.storage.KEYS.SCENE, id);
    renderActive();
  }

  // Live calm toggle (from the nav) re-renders the active scene → still frame.
  if (window.MutationObserver) {
    var themeObs = new MutationObserver(function () { if (activeId) renderActive(); });
    themeObs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  // ── Easter egg (always on) ─────────────────────────────────────────────────
  var flash = document.getElementById("flash");
  var FLASH_MESSAGES = ["love is open source", "be excellent to each other"];
  var flashTimer = null;
  function showFlash() {
    if (isStill() || !flash) return;
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    flash.textContent = FLASH_MESSAGES[Math.floor(Math.random() * FLASH_MESSAGES.length)];
    flash.style.transition = "opacity 1.2s ease";
    flash.style.opacity = "0"; void flash.offsetWidth; flash.style.opacity = "0.9";
    flashTimer = setTimeout(function () { flash.style.opacity = "0"; flashTimer = null; }, 2600);
  }
  function fireEgg() {
    if (isStill()) return;
    if (activeInst && activeInst.egg) { try { activeInst.egg(); } catch (e) {} }
    showFlash();
  }

  var eggHint = document.getElementById("eggHint");
  if (eggHint) {
    eggHint.addEventListener("click", function () { fireEgg(); });
    eggHint.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fireEgg(); }
    });
  }

  // ── Keyboard: only the hidden "pride" buffer survives the production port ───
  var WORD = "pride", buffer = "";
  document.addEventListener("keydown", function (e) {
    var k = e.key; if (!k || k.length !== 1) { return; }
    var lk = k.toLowerCase();
    if (lk >= "a" && lk <= "z") {
      buffer += lk;
      if (buffer.length > WORD.length) buffer = buffer.substr(buffer.length - WORD.length);
      if (buffer === WORD) { buffer = ""; fireEgg(); }
    } else buffer = "";
  });

  // ── Ways are plain scroll-anchors: tuwat/projekte/dauerhaft are real
  //    sections now, so the native href handles navigation (no JS toggle). ──

  // ── Gallery: render from the registry, small + clickable ───────────────────
  function renderGallery() {
    SCENES.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var gallery = document.getElementById("gallery"), i;
    if (!gallery) return;
    for (i = 0; i < SCENES.length; i++) {
      (function (def, n) {
        var card = document.createElement("div");
        card.className = "idea";
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("data-id", def.id);
        card.setAttribute("aria-label", def.title);
        var h = document.createElement("span");
        h.className = "idea__title";
        h.innerHTML = '<span class="n">' + n + ' · </span>' + def.title;
        var pre = document.createElement("pre");
        pre.setAttribute("aria-hidden", "true"); // decorative mini-animation
        card.appendChild(h); card.appendChild(pre); gallery.appendChild(card);
        // mini-loop (shell level); pauses on still (calm/reduced-motion).
        var spec = def.mini(ctx) || { frames: [""], ms: 600 };
        var frames = spec.frames || [""], fi = 0;
        pre.textContent = frames[0];
        if (!reduce && frames.length > 1) {
          (function miniTick() {
            if (!isStill()) { fi = (fi + 1) % frames.length; pre.textContent = frames[fi]; }
            setTimeout(miniTick, Math.max(80, spec.ms || 600));
          })();
        } else if (reduce) { pre.textContent = frames[frames.length - 1]; }
        card.addEventListener("click", function () { switchScene(def.id); });
        card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchScene(def.id); } });
      })(SCENES[i], i + 1);
    }
  }

  function setSpeed(v) {
    speedMult = v;
    lsSet(BC.storage.KEYS.SPEED, String(v));
    var lbl = document.getElementById("speedVal");
    if (lbl) lbl.textContent = v + "×";
    renderActive();
  }

  function initSpeedSlider() {
    var slider = document.getElementById("speedSlider");
    var lbl = document.getElementById("speedVal");
    if (!slider) return;
    slider.value = speedMult;
    if (lbl) lbl.textContent = speedMult + "×";
    slider.addEventListener("input", function () {
      setSpeed(parseFloat(slider.value));
    });
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCENE MODULES — extracted verbatim from the approved tmp/entry-stage.html ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  // ─── c2 · Katze jagt Faden (Referenz) ───────────────────────────────────────
  registerScene({
    id: "c2",
    title: "Katze jagt Faden",
    family: "knaeuel",
    mini: function (ctx) {
      function f(off, eyes, yarnLeft) {
        var p = ""; while (p.length < off) p += " ";
        return p + " /\\_/\\\n" + p + "( " + eyes + " )\n" + p + "(\")_(\")" + (yarnLeft ? "  ◍" : "    ◍");
      }
      return { frames: [f(2, "o.o", true), f(4, "o.o", true), f(6, "^.^", false), f(4, "-.-", false), f(2, "=.=", true)], ms: 640 };
    },
    create: function (host, ctx) {
      var thread = document.createElement("pre"); thread.className = "actor glow thread";
      var cat = document.createElement("pre"); cat.className = "actor glow";
      host.appendChild(thread); host.appendChild(cat);

      var YARN = "◍";
      function threadArt() { return "  ~\n   \\\n    " + YARN; }
      function catArt(eyes) { return " /\\_/\\\n( " + eyes + " )\n(\")_(\")"; }
      var EYE_NEUTRAL = "o.o", EYE_LEFT = "o.o ", EYE_RIGHT = " o.o",
          EYE_HAPPY = "^.^", EYE_DOZE = "-.-", EYE_SLEEP = "=.=";

      var sz = ctx.size(), W = sz.w, H = sz.h;
      var target = { x: W * 0.5, y: H * 0.45 }, yarn = { x: W * 0.5, y: H * 0.42 }, cm = { x: W * 0.46, y: H * 0.46 };
      var lastMoveAt = -99999, hasMoved = false, nowMs = 0, purr = "neutral";
      var YARN_EASE = 0.045, CAT_EASE = 0.022, lastCat = "";

      ctx.on(window, "resize", function () { var s = ctx.size(); W = s.w; H = s.h; });
      ctx.on(document, "mousemove", function (e) {
        if (ctx.reduce) return;
        var rect = host.getBoundingClientRect();
        target.x = Math.max(18, Math.min(W - 60, e.clientX - rect.left));
        target.y = Math.max(8, Math.min(H - 58, e.clientY - rect.top));
        lastMoveAt = nowMs; hasMoved = true;
      });

      function approach(c, t, e) { return c + (t - c) * e; }
      function distp(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
      function chooseEyes(dx, near) {
        if (purr === "sleep") return EYE_SLEEP;
        if (purr === "doze") return EYE_DOZE;
        if (near) return EYE_HAPPY;
        if (dx > 4) return EYE_LEFT;
        if (dx < -4) return EYE_RIGHT;
        return EYE_NEUTRAL;
      }
      function paint(eyesStr) {
        thread.textContent = threadArt();
        thread.style.transform = "translate(" + Math.round(yarn.x - 36) + "px," + Math.round(yarn.y - 30) + "px)";
        var ca = catArt(eyesStr);
        if (ca !== lastCat) { cat.textContent = ca; lastCat = ca; }
        cat.style.transform = "translate(" + Math.round(cm.x) + "px," + Math.round(cm.y) + "px)";
      }

      if (ctx.reduce) {
        yarn.x = W * 0.5; yarn.y = H * 0.42; cm.x = W * 0.46; cm.y = H * 0.46;
        paint(EYE_DOZE);
        ctx.hint("Standbild: die Katze ruht neben dem Knäuel ( -.- )");
        return {};
      }
      paint(EYE_NEUTRAL);

      ctx.raf(function (ts) {
        nowMs = ts || 0;
        var spd = ctx.speed(), idle = nowMs - lastMoveAt;
        if (ctx.calm() || !hasMoved || idle > 6000) purr = "sleep";
        else if (idle > 3000) purr = "doze";
        else purr = "neutral";
        if (purr !== "neutral") {
          target.x = approach(target.x, cm.x + 26, 0.01 * spd);
          target.y = approach(target.y, cm.y - 4, 0.01 * spd);
        }
        yarn.x = approach(yarn.x, target.x, YARN_EASE * spd);
        yarn.y = approach(yarn.y, target.y, YARN_EASE * spd);
        var prevX = cm.x;
        cm.x = approach(cm.x, yarn.x - 30, CAT_EASE * spd);
        cm.y = approach(cm.y, yarn.y + 12, CAT_EASE * spd);
        var dxMove = cm.x - prevX;
        var near = distp(cm.x + 24, cm.y + 8, yarn.x, yarn.y) < 34 && purr === "neutral";
        if (near) purr = "happy";
        paint(chooseEyes(dxMove, near));
        if (purr === "sleep") ctx.hint("*döst* … die Katze ruht neben dem Knäuel ( =.= )");
        else if (purr === "doze") ctx.hint("alles wird ruhig … ( -.- ) — wackel mit der Maus");
        else if (near) ctx.hint("*pat* — erwischt! ( ^.^ )");
        else ctx.hint("das Knäuel folgt dem Cursor träge, die Katze dem Knäuel ↓");
      });
      return {};
    }
  });

  // ─── a1 ───
// Scene module — a1 "Code-Regen (dicht)"
// Ported from tmp/lab/a1-regen-dicht.html.
// Inlined into the entry-stage <script> after registerScene + ctx are defined.
registerScene({
  id: "a1",
  title: "Code-Regen (dicht)",
  family: "regen",

  // Cheap gallery preview: a handful of pre-rendered ASCII frames showing a few
  // falling glyphs at different positions.
  mini: function (ctx) {
    // 4 rows x 7 cols snapshot; glyphs are static, head position shifts down each frame.
    var G = ["0", "1", "{", "}", "(", ";", "=", "$", "/"];
    function cell(glyph, kind) {
      // kind: "L"=lead, "M"=mid, "T"=tail, " "=empty
      if (kind === " ") { return "  "; }
      return glyph + " ";
    }
    // pre-baked frames as plain strings (no color — mini is monochrome ASCII only)
    return {
      frames: [
        "0     {   \n  1   }   \n  ;   (   \n            ",
        "  1   {   \n  ;   }   \n        (   \n            ",
        "    { $   \n  1   }   \n  ;   (     \n    0       ",
        "  { $ 1   \n    } ;   \n  (   0     \n            "
      ],
      ms: 580
    };
  },

  create: function (host, ctx) {
    // --- constants --- grid fills the stage (cpc 2 = glyph+space, ls 0.18em)
    var _g = ctx.grid(16, 1.25, 2, 0.80);
    var ROWS = _g.rows;
    var COLS = _g.cols;
    // drip start probability per tick (calm halves it)
    var P_START_NORMAL = 0.28;
    var P_START_CALM   = 0.14;

    // --- build DOM: one <pre> fills the host ---
    var pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.padding = "0";
    pre.style.lineHeight = "1.25";
    pre.style.fontSize = "16px";
    pre.style.letterSpacing = "0.18em";
    pre.style.overflow = "hidden";
    pre.style.width = "100%";
    pre.style.height = "100%";
    host.appendChild(pre);

    // --- column state ---
    var columns = [];
    var c, r, i;

    function randInt(min, max) {
      return min + Math.floor(Math.random() * (max - min + 1));
    }

    function pickGlyph() {
      // use shared pool when available, fallback to inline set
      if (ctx.glyph) { return ctx.glyph(); }
      var GLYPHS = ["0", "1", "{", "}", "(", ")", ";", "=", "$", "_", "/", "+", "<", ">"];
      return GLYPHS[randInt(0, GLYPHS.length - 1)];
    }

    function makeColumn() {
      var col = {
        head: -1,
        speed: randInt(3, 6),
        tick: randInt(0, 6),
        tail: randInt(2, 4),
        glyphs: []
      };
      for (r = 0; r < ROWS; r++) {
        col.glyphs.push(pickGlyph());
      }
      return col;
    }

    for (c = 0; c < COLS; c++) {
      columns.push(makeColumn());
    }

    // --- render: build innerHTML with per-span opacity via inline style ---
    // We use ctx.fg() for the color so sw/ws monochrome is automatic.
    // Brightness gradient via opacity: lead=1.0, mid=0.55, tail=0.20.
    function escapeGlyph(ch) {
      if (ch === "<") { return "&lt;"; }
      if (ch === ">") { return "&gt;"; }
      if (ch === "&") { return "&amp;"; }
      return ch;
    }

    function cellDist(col, row) {
      // returns distance from head (0=lead), or -1 if outside drip
      if (col.head < 0) { return -1; }
      var dist = col.head - row;
      if (dist < 0 || dist > col.tail) { return -1; }
      return dist;
    }

    function render() {
      var fg = ctx.fg();
      var html = "";
      var row, col, dist, ch, opacity;
      for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
          dist = cellDist(columns[col], row);
          if (dist < 0) {
            html += "  "; // empty cell + spacer
          } else {
            ch = columns[col].glyphs[row];
            if (dist === 0) {
              opacity = ctx.calm() ? "0.85" : "1.0";
            } else if (dist <= 1) {
              opacity = ctx.calm() ? "0.40" : "0.55";
            } else {
              opacity = ctx.calm() ? "0.12" : "0.20";
            }
            html += "<span style=\"color:" + fg + ";opacity:" + opacity + "\">" + escapeGlyph(ch) + "</span> ";
          }
        }
        if (row < ROWS - 1) { html += "\n"; }
      }
      pre.innerHTML = html;
    }

    // --- animation step: advance columns whose countdown elapsed ---
    function step() {
      var pStart = ctx.calm() ? P_START_CALM : P_START_NORMAL;
      for (i = 0; i < COLS; i++) {
        var col = columns[i];
        col.tick -= 1;
        if (col.tick > 0) { continue; }
        col.tick = col.speed;

        if (col.head < 0) {
          if (Math.random() < pStart) {
            col.head = 0;
            col.glyphs[0] = pickGlyph();
          }
          continue;
        }

        col.head += 1;
        if (col.head < ROWS) {
          col.glyphs[col.head] = pickGlyph();
        }

        if (col.head - col.tail > ROWS) {
          col.head = -1;
          col.speed = randInt(3, 6);
          col.tail = randInt(2, 4);
          col.tick = randInt(1, 5);
        }
      }
      render();
    }

    // --- reduced motion: one static snapshot, no timer ---
    if (ctx.reduce) {
      var seedHeads = [2, 5, 1, 4, 3, 6, 2, 5];
      for (c = 0; c < COLS; c++) {
        if (c % 2 === 0) {
          columns[c].head = seedHeads[(c / 2) % seedHeads.length];
        } else {
          columns[c].head = -1;
        }
      }
      render();
      return {};
    }

    // --- initial frame then drive via ctx.every (speed-scaled) ---
    render();
    ctx.every(360, step);

    return {};
  }
});

  // ─── a2 ───
registerScene({
  id: "a2",
  title: "Code-Regen (Morph)",
  family: "regen",

  // Cheap gallery preview: a handful of pre-rendered text frames showing a few
  // glyphs morphing through the sequence in a small 10×4 grid.
  mini: function (ctx) {
    function miniFrame(configs) {
      // configs: array of { col, row, ch } on a 10×4 grid
      var MCOLS = 10, MROWS = 4;
      var grid = [];
      var r, c, rowArr;
      for (r = 0; r < MROWS; r++) {
        rowArr = [];
        for (c = 0; c < MCOLS; c++) {
          rowArr.push(" ");
        }
        grid.push(rowArr);
      }
      for (var i = 0; i < configs.length; i++) {
        var cfg = configs[i];
        if (cfg.row >= 0 && cfg.row < MROWS && cfg.col >= 0 && cfg.col < MCOLS) {
          grid[cfg.row][cfg.col] = cfg.ch;
        }
      }
      var lines = [];
      for (r = 0; r < MROWS; r++) {
        lines.push(grid[r].join(""));
      }
      return lines.join("\n");
    }

    // Three glyphs shown at different morph phases across 5 frames
    var f1 = miniFrame([{ col: 2, row: 1, ch: "." }, { col: 7, row: 2, ch: "+" }, { col: 5, row: 0, ch: "*" }]);
    var f2 = miniFrame([{ col: 2, row: 1, ch: ":" }, { col: 7, row: 2, ch: "*" }, { col: 5, row: 0, ch: "#" }]);
    var f3 = miniFrame([{ col: 2, row: 1, ch: "+" }, { col: 7, row: 2, ch: "#" }, { col: 5, row: 1, ch: "*" }]);
    var f4 = miniFrame([{ col: 2, row: 1, ch: "*" }, { col: 7, row: 2, ch: "*" }, { col: 5, row: 1, ch: "+" }]);
    var f5 = miniFrame([{ col: 2, row: 2, ch: "#" }, { col: 7, row: 2, ch: "+" }, { col: 5, row: 1, ch: ":" }]);

    return { frames: [f1, f2, f3, f4, f5], ms: 640 };
  },

  create: function (host, ctx) {
    // One <pre> fills the stage; we render the text grid into it each tick.
    var stage = document.createElement("pre");
    stage.className = "actor";
    stage.style.margin = "0";
    stage.style.padding = "0";
    stage.style.fontSize = "15px";
    stage.style.lineHeight = "1.5";
    stage.style.whiteSpace = "pre";
    stage.style.overflow = "hidden";
    host.appendChild(stage);

    // Grid dimensions — fill the stage
    var _g = ctx.grid(15, 1.5, 1, 0.62);
    var COLS = _g.cols;
    var ROWS = _g.rows;

    // Morph character sequence: dim spark -> bright glyph -> back
    var MORPH = [".", ":", "+", "*", "#", "*", "+", ":"];

    var MAX_GLYPHS = Math.max(8, Math.round(COLS * ROWS * 0.05));
    var GLYPHS = [];

    function makeGlyph() {
      return {
        col: Math.floor(Math.random() * COLS),
        row: Math.floor(Math.random() * ROWS),
        phase: Math.floor(Math.random() * MORPH.length),
        morphEvery: 2 + Math.floor(Math.random() * 4),
        morphCount: 0,
        fallEvery: 3 + Math.floor(Math.random() * 6),
        fallCount: 0,
        stays: Math.random() < 0.45,
        life: 14 + Math.floor(Math.random() * 22)
      };
    }

    var i;
    for (i = 0; i < MAX_GLYPHS; i++) {
      GLYPHS.push(makeGlyph());
    }

    function buildGrid() {
      var grid = [];
      var r, c, rowArr;
      for (r = 0; r < ROWS; r++) {
        rowArr = [];
        for (c = 0; c < COLS; c++) {
          rowArr.push(" ");
        }
        grid.push(rowArr);
      }
      return grid;
    }

    function renderFrame() {
      var grid = buildGrid();
      var g, ch;
      for (var k = 0; k < GLYPHS.length; k++) {
        g = GLYPHS[k];
        if (g.row >= 0 && g.row < ROWS && g.col >= 0 && g.col < COLS) {
          ch = MORPH[g.phase];
          grid[g.row][g.col] = ch;
        }
      }
      var lines = [];
      for (var r = 0; r < ROWS; r++) {
        lines.push(grid[r].join(""));
      }
      return lines.join("\n");
    }

    // Route color through ctx.fg() on every render so sw/ws monochrome works.
    function paint() {
      stage.style.color = ctx.fg();
      stage.textContent = renderFrame();
    }

    function step() {
      var g;
      // In calm mode, slow morphing to every other call by skipping fall
      // and advancing morph half as often (we still call step at the same
      // base cadence; calm is expressed by more stays + slower morph advance).
      var calmSkip = ctx.calm();

      for (var k = 0; k < GLYPHS.length; k++) {
        g = GLYPHS[k];

        // morph phase — in calm mode, advance only when morphCount reaches
        // double the threshold (simulates a slower morph without a second timer)
        g.morphCount++;
        var morphThreshold = calmSkip ? g.morphEvery * 2 : g.morphEvery;
        if (g.morphCount >= morphThreshold) {
          g.morphCount = 0;
          g.phase++;
          if (g.phase >= MORPH.length) {
            g.phase = 0;
          }
        }

        // slow fall — in calm mode glyphs prefer to stay and breathe
        if (!g.stays && !calmSkip) {
          g.fallCount++;
          if (g.fallCount >= g.fallEvery) {
            g.fallCount = 0;
            g.row++;
          }
        }

        // aging
        g.life--;
        if (g.life <= 0 || g.row >= ROWS) {
          GLYPHS[k] = makeGlyph();
          if (!calmSkip) {
            GLYPHS[k].row = 0;
          }
        }
      }

      paint();
    }

    // Reduced-motion: render ONE static frame, no timer.
    if (ctx.reduce) {
      paint();
      return {};
    }

    // Initial frame so the stage isn't blank on mount.
    paint();

    // Source cadence was 520 ms; ctx.every speed-scales automatically.
    ctx.every(520, step);

    return {};
  }
});

  // ─── a3 ───
registerScene({
  id: "a3",
  title: "Code-Regen (sparse)",
  family: "regen",

  mini: function (ctx) {
    // Pre-rendered frames: a two-column narrow grid (10 cols × 6 rows).
    // Shows one drop drifting down with a fading tail, then a second appears.
    // Uses plain ASCII — no color spans in the preview tile.
    var W = 10, R = 6;
    function blankRow(w) {
      var s = ""; var i; for (i = 0; i < w; i++) s += " "; return s;
    }
    function frame(drops) {
      var grid = [], r, c;
      for (r = 0; r < R; r++) {
        grid[r] = [];
        for (c = 0; c < W; c++) grid[r][c] = null;
      }
      var d, t, headRow, row, depth, g;
      for (d = 0; d < drops.length; d++) {
        headRow = Math.floor(drops[d].head);
        for (t = 0; t < drops[d].tail.length; t++) {
          row = headRow - t;
          if (row >= 0 && row < R) {
            depth = t / (drops[d].tail.length - 1 || 1);
            g = drops[d].tail[t];
            if (grid[row][drops[d].col] === null || depth < grid[row][drops[d].col].depth) {
              grid[row][drops[d].col] = { g: g, depth: depth };
            }
          }
        }
      }
      var lines = [];
      for (r = 0; r < R; r++) {
        var line = "";
        for (c = 0; c < W; c++) {
          line += (grid[r][c] === null ? " " : grid[r][c].g);
        }
        lines.push(line);
      }
      return lines.join("\n");
    }

    var f0 = frame([
      { col: 3, head: 1, tail: ["|", ":"] }
    ]);
    var f1 = frame([
      { col: 3, head: 2, tail: ["|", ":", "."] }
    ]);
    var f2 = frame([
      { col: 3, head: 3, tail: ["|", ":", ".", "/"] }
    ]);
    var f3 = frame([
      { col: 3, head: 4, tail: [":", ".", "/", "1"] },
      { col: 7, head: 1, tail: ["|"] }
    ]);
    var f4 = frame([
      { col: 3, head: 5, tail: [".", "/", "1", "0", "."] },
      { col: 7, head: 2, tail: ["|", ":"] }
    ]);
    return { frames: [f0, f1, f2, f3, f4], ms: 520 };
  },

  create: function (host, ctx) {
    var _g = ctx.grid(15, 1.25, 1, 0.62);
    var COLS = _g.cols;
    var ROWS = _g.rows;
    var GLYPHS = ["|", ":", ".", "/", "1", "0"];

    var stage = document.createElement("pre");
    stage.style.margin = "0";
    stage.style.lineHeight = "1.25";
    stage.style.fontSize = "15px";
    stage.style.whiteSpace = "pre";
    stage.style.overflow = "hidden";
    host.appendChild(stage);

    var drops = [];
    var spawnCooldown = 0;

    function randInt(min, max) {
      return min + Math.floor(Math.random() * (max - min + 1));
    }

    function pickGlyph() {
      return GLYPHS[randInt(0, GLYPHS.length - 1)];
    }

    function makeDrop() {
      var calm = ctx.calm();
      var tailLen = randInt(4, 7);
      var glyphs = [];
      var i;
      for (i = 0; i < tailLen; i++) {
        glyphs.push(pickGlyph());
      }
      // calm: drops fall slower
      var speedMin = calm ? 14 : 18;
      var speedMax = calm ? 24 : 32;
      return {
        col: randInt(1, COLS - 2),
        head: -1,
        tail: tailLen,
        glyphs: glyphs,
        speed: randInt(speedMin, speedMax) / 100
      };
    }

    function collectCells() {
      var cells = [];
      var d, headRow, t, row, depth;
      for (d = 0; d < drops.length; d++) {
        headRow = Math.floor(drops[d].head);
        for (t = 0; t < drops[d].tail; t++) {
          row = headRow - t;
          if (row >= 0 && row < ROWS) {
            depth = t / (drops[d].tail - 1 || 1);
            cells.push({
              row: row,
              col: drops[d].col,
              glyph: drops[d].glyphs[t],
              depth: depth
            });
          }
        }
      }
      return cells;
    }

    function spanFor(glyph, depth) {
      // depth 0 -> opacity 1 (head, brightest); depth 1 -> opacity ~0.15 (tail end)
      var opacity = 1 - depth * 0.85;
      if (opacity < 0.12) opacity = 0.12;
      // Head cells use ctx.fg() for sw/ws compatibility; tail fades to --dim.
      var color = depth < 0.4 ? ctx.fg() : "var(--dim)";
      // calm: dampen brightness by reducing head opacity slightly
      if (ctx.calm() && depth < 0.4) opacity = opacity * 0.7;
      return '<span style="color:' + color + ';opacity:' + opacity.toFixed(2) + '">' + glyph + "</span>";
    }

    function render() {
      var cells = collectCells();
      var grid = [];
      var r, c;
      for (r = 0; r < ROWS; r++) {
        grid[r] = [];
        for (c = 0; c < COLS; c++) {
          grid[r][c] = null;
        }
      }
      var i, cell, existing;
      for (i = 0; i < cells.length; i++) {
        cell = cells[i];
        existing = grid[cell.row][cell.col];
        if (existing === null || cell.depth < existing.depth) {
          grid[cell.row][cell.col] = cell;
        }
      }
      var html = "";
      for (r = 0; r < ROWS; r++) {
        for (c = 0; c < COLS; c++) {
          var g = grid[r][c];
          if (g === null) {
            html += " ";
          } else {
            html += spanFor(g.glyph, g.depth);
          }
        }
        if (r < ROWS - 1) html += "\n";
      }
      stage.innerHTML = html;
    }

    function step() {
      var d;
      for (d = drops.length - 1; d >= 0; d--) {
        drops[d].head += drops[d].speed;
        if (Math.floor(drops[d].head) - drops[d].tail > ROWS) {
          drops.splice(d, 1);
        }
      }
      // density scales with width so a wide stage isn't near-empty
      var dropBase = Math.max(3, Math.round(COLS * 0.09));
      var maxDrops = ctx.calm() ? dropBase : dropBase + 1;
      // calm: longer gaps between spawns
      var coolMin = ctx.calm() ? 10 : 6;
      var coolMax = ctx.calm() ? 20 : 14;
      if (spawnCooldown > 0) {
        spawnCooldown--;
      } else if (drops.length < maxDrops) {
        drops.push(makeDrop());
        spawnCooldown = randInt(coolMin, coolMax);
      }
      render();
    }

    // Reduced-motion: one static frame, no timer.
    if (ctx.reduce) {
      drops = [
        { col: 8,  head: 5, tail: 6, glyphs: ["|", ":", ".", "/", "1", "."], speed: 0 },
        { col: 24, head: 7, tail: 5, glyphs: [":", "|", ".", "0", "."],       speed: 0 }
      ];
      render();
      return {};
    }

    // Normal path: initial tick then speed-scaled interval.
    step();
    ctx.every(520, step);

    return {};
  }
});

  // ─── b1 ───
registerScene({
  id: "b1",
  title: "Pride-Sweep",
  family: "pride",

  mini: function (ctx) {
    // A few text frames hinting at diagonal colored band moving through code rain.
    // Monochrome text; color shows only in the live scene.
    return {
      frames: [
        "01{}[]<>|=\n+-*.:;_$#@\n\\01{}[]<>/\n+-*.:;_$#@",
        "01{}[]<>|=\n+--*.:;$##\n\\01/[]<>>|=\n+-*.:;_$#@",
        "01//[]<>|=\n+--*.;;$##\n\\01//[]<<>=\n+--*.:;_$#",
        "01//[]==|=\n+--*..;$##\n\\01//<]<<>=\n+--*..:;_$",
        "01{}[]<>|=\n+-*.:;_$#@\n\\01{}[]<>/\n+-*.:;_$#@"
      ],
      ms: 500
    };
  },

  create: function (host, ctx) {
    var _g = ctx.grid(14, 1.25, 1, 0.62);
    var COLS = _g.cols;
    var ROWS = _g.rows;

    // Build grid of spans
    var cells = [];
    var pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.lineHeight = "1.25";
    pre.style.fontSize = "14px";
    pre.style.whiteSpace = "pre";
    pre.style.overflow = "hidden";
    host.appendChild(pre);

    function randGlyph() {
      return ctx.glyph();
    }

    var r, c;
    for (r = 0; r < ROWS; r++) {
      cells[r] = [];
      for (c = 0; c < COLS; c++) {
        var span = document.createElement("span");
        span.textContent = randGlyph();
        span.style.color = ctx.fg();
        pre.appendChild(span);
        cells[r][c] = span;
      }
      pre.appendChild(document.createTextNode("\n"));
    }

    var maxDiag = (ROWS - 1) + (COLS - 1);
    var sweepWidth = 4;

    // --- Reduced motion: one static frozen diagonal pride band, no timers ---
    if (ctx.reduce) {
      var pride = ctx.pride();
      var front = Math.floor(maxDiag / 2);
      var rr, cc, diag, band;
      for (rr = 0; rr < ROWS; rr++) {
        for (cc = 0; cc < COLS; cc++) {
          diag = rr + cc;
          if (diag >= front && diag < front + sweepWidth) {
            band = Math.floor((diag / (maxDiag + 1)) * pride.length);
            if (band >= pride.length) { band = pride.length - 1; }
            cells[rr][cc].style.color = pride[band];
          }
        }
      }
      return {};
    }

    // --- Live animation ---
    var sweepActive = false;
    var sweepFront = 0;

    function startSweep() {
      if (sweepActive) { return; }
      sweepActive = true;
      sweepFront = -sweepWidth;
    }

    function sweepStep() {
      if (!sweepActive) { return; }
      var pride = ctx.pride();
      var fg = ctx.fg();
      var rr, cc, diag, dist, band;
      for (rr = 0; rr < ROWS; rr++) {
        for (cc = 0; cc < COLS; cc++) {
          diag = rr + cc;
          dist = diag - sweepFront;
          if (dist >= 0 && dist < sweepWidth) {
            // lit: color by diagonal position across the full grid
            band = Math.floor((diag / (maxDiag + 1)) * pride.length);
            if (band >= pride.length) { band = pride.length - 1; }
            cells[rr][cc].style.color = pride[band];
          } else if (dist === sweepWidth) {
            // just passed: ease back to foreground
            cells[rr][cc].style.color = fg;
          }
        }
      }
      sweepFront++;
      if (sweepFront > maxDiag + sweepWidth) {
        sweepActive = false;
        for (rr = 0; rr < ROWS; rr++) {
          for (cc = 0; cc < COLS; cc++) {
            cells[rr][cc].style.color = "";
          }
        }
      }
    }

    // Rain: change a handful of glyphs each tick. Calm mode: fewer changes.
    ctx.every(520, function () {
      var changes = ctx.calm() ? 2 : 5;
      var k, rr, cc;
      for (k = 0; k < changes; k++) {
        rr = Math.floor(Math.random() * ROWS);
        cc = Math.floor(Math.random() * COLS);
        cells[rr][cc].textContent = randGlyph();
      }
    });

    // Sweep front advances one diagonal step at a time.
    // Calm: use the same interval but the sweep fires less often (trigger timer slows).
    ctx.every(340, function () {
      sweepStep();
    });

    // Trigger a new sweep rarely. Calm mode: even less often (18s vs 11s).
    ctx.every(11000, function () {
      if (!ctx.calm()) {
        startSweep();
      }
    });

    // Calm-aware slower trigger: every 18s, only fires in calm mode
    ctx.every(18000, function () {
      if (ctx.calm()) {
        startSweep();
      }
    });

    // First sweep after a calm initial pause (simulate the source's setTimeout(3200))
    // Use a one-shot wrapper: fire once, then stop re-triggering
    var firstFired = false;
    ctx.every(3200, function () {
      if (!firstFired) {
        firstFired = true;
        startSweep();
      }
    });

    return {};
  }
});

  // ─── b2 ───
registerScene({
  id: "b2",
  title: "Regenbogen-Regen",
  family: "pride",

  mini: function (ctx) {
    // Four plain-text frames: a thin column curtain rippling downward (monochrome).
    // Column chars change per frame to give a raining feel.
    var glyphs = "01</\\{}[]=+*.#$@alibtcrcus".split("");
    function rg() { return glyphs[Math.floor(Math.random() * glyphs.length)]; }
    function frame(offsets) {
      // offsets: array of head-row per column (4 cols, 6 rows for the mini)
      var COLS = 4, ROWS = 6, TAIL = 2;
      var lines = [];
      var r, c, dist, ch;
      for (r = 0; r < ROWS; r++) {
        var row = "";
        for (c = 0; c < COLS; c++) {
          dist = offsets[c] - r;
          if (dist === 0) {
            ch = "#";
          } else if (dist > 0 && dist <= TAIL) {
            ch = ":";
          } else {
            ch = " ";
          }
          row += ch + " ";
        }
        lines.push(row);
      }
      return lines.join("\n");
    }
    return {
      frames: [
        frame([1, 3, 0, 4]),
        frame([2, 4, 1, 5]),
        frame([3, 5, 2, 0]),
        frame([4, 0, 3, 1])
      ],
      ms: 520
    };
  },

  create: function (host, ctx) {
    var rain = document.createElement("pre");
    rain.style.margin = "0";
    rain.style.padding = "0";
    rain.style.lineHeight = "1.15";
    rain.style.fontSize = "14px";
    rain.style.whiteSpace = "pre";
    rain.style.overflow = "hidden";
    rain.style.letterSpacing = ".12em";
    rain.style.width = "100%";
    rain.style.height = "100%";
    host.appendChild(rain);

    var glyphs = "01</\\{}[]=+*.#$@alibtcrcus".split("");

    // Grid fills the terminal width/height (1 char per cell, ls .12em -> cwEm ~.72).
    var _g = ctx.grid(14, 1.15, 1, 0.72);
    var COLS = _g.cols;
    var ROWS = _g.rows;

    var columns = [];

    function rand(n) {
      return Math.floor(Math.random() * n);
    }

    function pickGlyph() {
      return glyphs[rand(glyphs.length)];
    }

    function buildColumns() {
      columns = [];
      var i;
      for (i = 0; i < COLS; i++) {
        columns.push({
          head: rand(ROWS) - rand(ROWS),
          tail: 4 + rand(5),
          speed: 0.18 + Math.random() * 0.22,
          chars: []
        });
        var c = columns[i];
        var r;
        for (r = 0; r < ROWS; r++) {
          c.chars.push(pickGlyph());
        }
      }
    }

    // Lighten a colour string towards white for the head glyph.
    // Handles both "#rrggbb" and "rgb(r,g,b)" formats.
    function lighten(colorStr) {
      var rr, gg, bb;
      if (colorStr.charAt(0) === "#") {
        rr = parseInt(colorStr.substr(1, 2), 16);
        gg = parseInt(colorStr.substr(3, 2), 16);
        bb = parseInt(colorStr.substr(5, 2), 16);
      } else {
        // rgb(...) — strip prefix and parse
        var inner = colorStr.replace(/^rgb\s*\(\s*/, "").replace(/\s*\)$/, "");
        var parts = inner.split(/\s*,\s*/);
        rr = parseInt(parts[0], 10);
        gg = parseInt(parts[1], 10);
        bb = parseInt(parts[2], 10);
      }
      rr = Math.min(255, Math.round(rr + (255 - rr) * 0.55));
      gg = Math.min(255, Math.round(gg + (255 - gg) * 0.55));
      bb = Math.min(255, Math.round(bb + (255 - bb) * 0.55));
      return "rgb(" + rr + "," + gg + "," + bb + ")";
    }

    function renderFrame() {
      var colors = ctx.pride();
      var clen = colors.length;
      var isCalm = ctx.calm();
      // glow only in non-calm color mode
      var glow = (ctx.colorMode() !== "color" || isCalm)
        ? ""
        : ";text-shadow:0 0 6px rgba(74,222,128,.18)";
      var lines = [];
      var r, cIdx, col, hue, headRow, dist, ch, alpha, span;

      for (r = 0; r < ROWS; r++) {
        var rowParts = [];
        for (cIdx = 0; cIdx < COLS; cIdx++) {
          col = columns[cIdx];
          hue = colors[cIdx % clen];
          headRow = Math.floor(col.head);
          dist = headRow - r;
          ch = col.chars[r];

          if (dist === 0) {
            span = "<span style=\"color:" + lighten(hue) + glow + "\">" + ch + "</span>";
          } else if (dist > 0 && dist <= col.tail) {
            alpha = 1 - (dist / (col.tail + 1));
            span = "<span style=\"color:" + hue + ";opacity:" + alpha.toFixed(2) + "\">" + ch + "</span>";
          } else {
            span = " ";
          }
          rowParts.push(span);
        }
        lines.push(rowParts.join(""));
      }
      return lines.join("\n");
    }

    function step() {
      var cIdx, col, r;
      for (cIdx = 0; cIdx < COLS; cIdx++) {
        col = columns[cIdx];
        col.head += col.speed;
        if (Math.floor(col.head) - col.tail > ROWS) {
          col.head = -rand(6);
          col.tail = 4 + rand(5);
          col.speed = 0.18 + Math.random() * 0.22;
          for (r = 0; r < ROWS; r++) {
            if (rand(3) === 0) {
              col.chars[r] = pickGlyph();
            }
          }
        }
      }
      rain.innerHTML = renderFrame();
    }

    buildColumns();

    if (ctx.reduce) {
      // One static frame with heads spread across rows.
      var k;
      for (k = 0; k < COLS; k++) {
        columns[k].head = rand(ROWS);
      }
      rain.innerHTML = renderFrame();
      return {};
    }

    // Initial render so the stage is not blank.
    rain.innerHTML = renderFrame();

    // Slow cadence matching the source (520 ms base).
    // ctx.every applies the speed multiplier automatically.
    ctx.every(520, step);

    return {};
  }
});

  // ─── b3 ───
registerScene({
  id: "b3",
  title: "Pride Easter-Egg",
  family: "pride",

  // Cheap gallery preview: a few pre-rendered plain-text frames of calm green rain.
  mini: function (ctx) {
    var f1 = "|.:|;|.:\n:.||.;:|\n|;:.||;.";
    var f2 = ":.||;:|.:\n|.:|:.||;\n:.||;.|:;";
    var f3 = ";:.||:|.:\n|.;:|:.;|\n:.||;:.||";
    return { frames: [f1, f2, f3], ms: 700 };
  },

  create: function (host, ctx) {
    var _g = ctx.grid(13, 1.25, 1, 0.70);
    var COLS = _g.cols;
    var ROWS = _g.rows;

    var GLYPHS = "01<>/\\|-_=+*.:;{}[]()#@%$".split("");

    // ---- build DOM into host ----
    var rainPre = document.createElement("pre");
    rainPre.className = "rain";
    rainPre.style.margin = "0";
    rainPre.style.padding = "8px 10px";
    rainPre.style.fontSize = "13px";
    rainPre.style.lineHeight = "1.25";
    rainPre.style.whiteSpace = "pre";
    rainPre.style.letterSpacing = "1px";
    host.appendChild(rainPre);

    var flashDiv = document.createElement("div");
    flashDiv.className = "flash";
    flashDiv.style.position = "absolute";
    flashDiv.style.left = "0";
    flashDiv.style.right = "0";
    flashDiv.style.top = "50%";
    flashDiv.style.transform = "translateY(-50%)";
    flashDiv.style.textAlign = "center";
    flashDiv.style.fontSize = "15px";
    flashDiv.style.letterSpacing = "2px";
    flashDiv.style.opacity = "0";
    flashDiv.style.pointerEvents = "none";
    flashDiv.style.fontFamily = "inherit";
    flashDiv.style.color = "inherit";
    host.appendChild(flashDiv);

    // ---- drop state per column ----
    var drops = [];
    var c;
    for (c = 0; c < COLS; c++) {
      drops.push({
        head: Math.floor(Math.random() * ROWS),
        slow: 2 + Math.floor(Math.random() * 4),
        tick: Math.floor(Math.random() * 6),
        trail: 4 + Math.floor(Math.random() * 6)
      });
    }

    // ---- cell grid ----
    var cells = [];      // cells[row][col] = span element
    var glyphState = []; // glyphState[row][col] = current glyph string
    function buildGrid() {
      rainPre.textContent = "";
      cells = [];
      glyphState = [];
      var r, cc;
      for (r = 0; r < ROWS; r++) {
        cells.push([]);
        glyphState.push([]);
        for (cc = 0; cc < COLS; cc++) {
          var sp = document.createElement("span");
          var g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          sp.textContent = g;
          rainPre.appendChild(sp);
          cells[r].push(sp);
          glyphState[r].push(g);
        }
        rainPre.appendChild(document.createTextNode("\n"));
      }
    }
    buildGrid();

    // ---- color helpers ----
    // Parse a color string (hex #rrggbb or rgb(r,g,b)) into {r,g,b}.
    function parseColor(s) {
      s = (s || "").trim();
      if (s.charAt(0) === "#" && s.length >= 7) {
        return {
          r: parseInt(s.substr(1, 2), 16),
          g: parseInt(s.substr(3, 2), 16),
          b: parseInt(s.substr(5, 2), 16)
        };
      }
      // rgb(r,g,b) or rgba(r,g,b,a)
      var m = s.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
      }
      // fallback: --green loud default
      return { r: 74, g: 222, b: 128 };
    }

    function lerp(a, b, t) {
      return Math.round(a + (b - a) * t);
    }

    function mixColor(fgStr, prideHex, level) {
      var base = parseColor(fgStr);
      var p = parseColor(prideHex);
      return "rgb(" + lerp(base.r, p.r, level) + "," + lerp(base.g, p.g, level) + "," + lerp(base.b, p.b, level) + ")";
    }

    // ---- pride bloom state ----
    var prideLevel = 0;
    var prideTarget = 0;
    var prideHoldTicks = 0; // ticks to hold at full bloom before releasing

    // ---- flash fade state: driven by tick counter, no raw timer ----
    var FLASH_MESSAGES = ["love is open source", "be excellent to each other"];
    // ticksUntilFade: counts down from HOLD_TICKS to 0, then triggers fade
    var flashHoldTicks = 0;
    var flashFading = false;
    // We drive the fade via CSS transition + a tick counter so no setTimeout needed.
    var FLASH_HOLD = 5; // ticks (~5 * 480ms = ~2.4 s) before fade starts

    function showFlash() {
      var msg = FLASH_MESSAGES[Math.floor(Math.random() * FLASH_MESSAGES.length)];
      flashDiv.textContent = msg;
      flashDiv.style.transition = "opacity 1.2s ease";
      flashDiv.style.opacity = "0";
      // force reflow then ramp up
      void flashDiv.offsetWidth;
      flashDiv.style.opacity = "0.9";
      flashHoldTicks = FLASH_HOLD;
      flashFading = false;
    }

    // ---- one step (called every STEP ms via ctx.every) ----
    function step() {
      var palette = ctx.pride();
      var fgStr = ctx.fg();

      // --- pride bloom easing ---
      if (prideHoldTicks > 0) {
        prideHoldTicks--;
      } else if (prideTarget === 1 && prideLevel >= 0.999) {
        // reached full bloom — start releasing
        prideTarget = 0;
      }
      var ease = prideTarget > prideLevel ? 0.10 : 0.06;
      prideLevel += (prideTarget - prideLevel) * ease;
      if (prideLevel < 0.003) prideLevel = 0;
      if (prideLevel > 0.997) prideLevel = 1;

      // --- drop movement ---
      var cc, r, d;
      for (cc = 0; cc < COLS; cc++) {
        d = drops[cc];
        d.tick++;
        // calm: advance drops at half rate
        var slowThresh = ctx.calm() ? d.slow * 2 : d.slow;
        if (d.tick >= slowThresh) {
          d.tick = 0;
          d.head = (d.head + 1) % (ROWS + d.trail);
          // occasionally mutate one glyph in this column for life
          var rr = Math.floor(Math.random() * ROWS);
          var ng = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          cells[rr][cc].textContent = ng;
          glyphState[rr][cc] = ng;
        }
      }

      // --- colour pass ---
      for (r = 0; r < ROWS; r++) {
        for (cc = 0; cc < COLS; cc++) {
          d = drops[cc];
          var dist = d.head - r;
          var inTrail = dist >= 0 && dist < d.trail;
          var sp = cells[r][cc];
          if (prideLevel <= 0) {
            // pure green — reset to inherit so CSS var(--green) applies
            sp.style.color = "";
            sp.style.opacity = inTrail ? "1" : "0.32";
          } else {
            var band = Math.floor((r / ROWS) * palette.length);
            if (band >= palette.length) band = palette.length - 1;
            sp.style.color = mixColor(fgStr, palette[band], prideLevel);
            sp.style.opacity = inTrail ? "1" : String(0.32 + 0.4 * prideLevel);
          }
        }
      }

      // --- flash fade countdown ---
      if (flashHoldTicks > 0) {
        flashHoldTicks--;
        if (flashHoldTicks === 0 && !flashFading) {
          flashFading = true;
          flashDiv.style.transition = "opacity 1.4s ease";
          flashDiv.style.opacity = "0";
        }
      }
    }

    // ---- egg: the shell calls this when "pride" is typed or heart is clicked ----
    function bloom() {
      prideTarget = 1;
      prideHoldTicks = 6; // hold at full bloom for ~6 calm frames
      showFlash();
      ctx.hint("love is open source <3");
    }

    // ---- reduced-motion branch ----
    if (ctx.reduce) {
      // single still frame: alternating opacity, no animation
      var rr2, cc2;
      for (rr2 = 0; rr2 < ROWS; rr2++) {
        for (cc2 = 0; cc2 < COLS; cc2++) {
          cells[rr2][cc2].style.opacity = (rr2 % 3 === 0) ? "1" : "0.3";
        }
      }
      flashDiv.textContent = "be excellent to each other";
      flashDiv.style.opacity = "0.45";
      ctx.hint("Standbild: gruener Code-Regen (pride via egg())");
      return { egg: bloom };
    }

    // ---- live animation ----
    step();
    ctx.every(480, step);
    ctx.hint("gruener Code-Regen — egg() blooms into pride");

    return { egg: bloom };
  }
});

  // ─── c1 ───
registerScene({
  id: "c1",
  title: "Knäuel rollt",
  family: "knaeuel",

  mini: function (ctx) {
    // A few frames of the ball rolling across a short track and back.
    var MG = ["◐", "◓", "◑", "◒"];
    function miniFrame(pos, gi) {
      var i, slots = [];
      for (i = 0; i < 8; i++) slots.push(":");
      for (i = 0; i < pos; i++) slots[i] = (i % 2 === 0) ? "~" : "-";
      if (pos < 8) slots[pos] = MG[gi % 4];
      return "o\n|\n[ " + slots.join("") + " ]";
    }
    return {
      frames: [
        miniFrame(0, 0),
        miniFrame(2, 1),
        miniFrame(4, 2),
        miniFrame(6, 3),
        miniFrame(4, 2),
        miniFrame(2, 1)
      ],
      ms: 600
    };
  },

  create: function (host, ctx) {
    // --- DOM structure ---
    // Three <pre> layers: spool (thread-colored), track (thread + ball), cat.
    var spoolEl = document.createElement("pre");
    spoolEl.className = "actor thread";

    var trackEl = document.createElement("pre");
    trackEl.className = "actor";   // will hold a mix; we color inline via spans? No --
    // CONTRACT: no inline style on static markup. We build textContent each tick.
    // Thread slots will be in a child <span class="thread">, ball in a plain span.
    // But textContent replaces child nodes. Use two separate <pre>s overlaid instead:
    // one for thread layer (class thread), one for ball+cat (class actor).
    // Simpler: build the whole frame as a single <pre> and accept that thread chars
    // share the actor color. Re-read CONTRACT: "use class 'thread' for thread/yarn
    // parts (CSS colors .scene .thread as --text)". So we NEED the class.
    // Solution: rebuild innerHTML with a <span class="thread">...</span> around thread
    // chars and a plain text node for the ball char. This is still one <pre>.
    // Actually the simplest faithful port: TWO <pre> elements, absolutely positioned
    // and z-stacked so they share the same coordinate space (both positioned via
    // style.transform = "translate(0,0)") — one renders only the thread trail, the
    // other the spool anchor, ball, brackets, and cat. They share the same line
    // structure so they appear to overlap cleanly.

    // ---- approach: single <pre> with innerHTML ----
    // We'll rebuild innerHTML each tick. Static markup rules only apply to what
    // we CREATE in JS before animation starts; innerHTML-rebuilt content is
    // animation output, which is fine.

    var TRACK = 15;
    var BALL_GLYPHS = ["◐", "◓", "◑", "◒"]; // ◐ ◓ ◑ ◒
    var rotIndex = 0;
    var pos = 0;
    var dir = 1;
    var pauseTicks = 0;

    // Spool element (always same, thread-colored)
    spoolEl.textContent = "  o\n  |";

    // The main animation pre: track row + cat
    var mainEl = document.createElement("pre");
    mainEl.className = "actor";

    host.appendChild(spoolEl);
    host.appendChild(mainEl);

    function buildTrackHTML(p, d) {
      var i, slots = [];
      for (i = 0; i < TRACK; i++) slots.push(":");

      // Thread trail to the left of ball position
      for (i = 0; i < p; i++) {
        slots[i] = (i % 2 === 0) ? "~" : "-";
      }

      // Build HTML: thread slots as <span class="thread">, ball and punctuation plain
      var rowHTML = "   [ ";
      for (i = 0; i < TRACK; i++) {
        if (i === p) {
          // ball — actor (green) color, no extra class
          rowHTML += BALL_GLYPHS[rotIndex];
        } else if (i < p) {
          // thread — wrap in span
          rowHTML += "<span class=\"thread\">" + slots[i] + "</span>";
        } else {
          // unoccupied slot
          rowHTML += ":";
        }
      }
      rowHTML += " ]";

      var eyes = (d > 0) ? "o.o" : (d < 0 ? "-.-" : "o.o");
      var cat =
        "                      /\\_/\\\n" +
        "                     ( " + eyes + " )\n" +
        "                     (\")_(\")";

      return "\n" + rowHTML + "\n\n" + cat;
    }

    // --- Reduced-motion: one static frame, no timers ---
    if (ctx.reduce) {
      spoolEl.textContent = "  o\n  |";
      mainEl.innerHTML = buildTrackHTML(0, 0);
      ctx.center(host);
      ctx.hint("Ruhebild: das Knäuel liegt am Anfang der Tastatur.");
      return {};
    }

    // Initial render
    mainEl.innerHTML = buildTrackHTML(pos, dir);
    ctx.center(host);

    // --- Calm mode: use a slower base tick ---
    function tickMs() {
      return ctx.calm() ? 900 : 520;
    }

    // ctx.every uses speed-scaling, so we set a base and let the shell multiply.
    // Because the base needs to change with calm, we check ctx.calm() inside the fn.
    // ctx.every(baseMs, fn) — we pick the normal base (520ms) and rely on the shell's
    // speed scaling; calm just uses a longer base exposed via a fresh ctx.every call.
    // However ctx.every returns nothing and is set-and-forget. We re-register on calm
    // change? No — ctx.every already handles speed; calm is a visual/pace decision.
    // Simplest: register ONE ctx.every at 520ms; inside, skip-frame when calm by
    // only updating every other call using an internal counter.

    var skipCounter = 0;

    ctx.every(520, function () {
      // calm mode: skip every other tick to halve effective speed
      if (ctx.calm()) {
        skipCounter++;
        if (skipCounter % 2 !== 0) return;
      }

      if (pauseTicks > 0) {
        pauseTicks--;
        // ball sits still; just refresh in case eyes/thread need re-draw
        mainEl.innerHTML = buildTrackHTML(pos, 0);
        ctx.hint("*pausiert* … das Knäuel ruht kurz ( o.o )");
        return;
      }

      pos += dir;
      rotIndex = (rotIndex + (dir > 0 ? 1 : BALL_GLYPHS.length - 1)) % BALL_GLYPHS.length;

      if (pos >= TRACK - 1) {
        pos = TRACK - 1;
        dir = -1;
        pauseTicks = 4;
        ctx.hint("*zurück* — der Faden wird wieder aufgerollt …");
      } else if (pos <= 0) {
        pos = 0;
        dir = 1;
        pauseTicks = 4;
        ctx.hint("*rollt los* — der Faden wickelt sich ab …");
      } else {
        if (dir > 0) {
          ctx.hint("das Knäuel rollt nach rechts und wickelt den Faden ab →");
        } else {
          ctx.hint("das Knäuel rollt zurück und zieht den Faden ein ←");
        }
      }

      mainEl.innerHTML = buildTrackHTML(pos, dir);
    });

    return {};
  }
});

  // ─── c3 ───
registerScene({
  id: "c3",
  title: "Knäuel zerlegt sich",
  family: "knaeuel",

  mini: function (ctx) {
    // A few frames of the ball shrinking, cat watching.
    // Each frame is a plain string (no DOM in mini).
    return {
      frames: [
        "  /\\_/\\\n( o.o )  ◍\n(\")_(\")",
        "  /\\_/\\\n( ^.^ )  ◎\n(\")(\")",
        "  /\\_/\\\n( o.o )  ○\n(\")_(\")",
        "  /\\_/\\\n( ^.^ )  ∘\n(\")(\")",
        "  /\\_/\\\n( -.- )  .\n(\")_(\")"
      ],
      ms: 640
    };
  },

  create: function (host, ctx) {
    // One <pre> as the stage surface; we rebuild its children each tick.
    var stage = document.createElement("pre");
    stage.className = "actor glow";
    host.appendChild(stage);

    var BALL    = ["◍", "◎", "○", "∘", "."];
    var EYES    = ["( o.o )", "(  o.o)", "( ^.^ )", "(o.o  )", "( -.- )"];
    var PAWS    = ['(")_(")', '(") (")', '( )_( )', '(")_(")', '( )_( )'];
    var LOOPS   = ["~", "∿", "~", "﹀", "~"];
    var WIDTH   = 34;
    var STEPS   = 22;
    var INTERVAL = 620;   // base ms per frame — calm/calm gets longer via ctx.every scaling
    var PAUSE_FRAMES = 4;

    var tick = 0;
    var step = 0;
    var pause = 0;

    // Helper: text node shorthand.
    function tn(s) { return document.createTextNode(s); }

    // Helper: a span with class "thread" (reads as --text colour via CSS).
    function threadSpan(s) {
      var sp = document.createElement("span");
      sp.className = "thread";
      sp.textContent = s;
      return sp;
    }

    // Build the scene DOM for given progress (0..1) and tick counter.
    function render(progress, t) {
      var ballIdx = Math.floor(progress * BALL.length);
      if (ballIdx > BALL.length - 1) { ballIdx = BALL.length - 1; }
      var ball = BALL[ballIdx];

      var phase = Math.floor(t / 2) % EYES.length;
      var eyes  = EYES[phase];
      var paw   = PAWS[phase];

      // Upper thread (grows as ball shrinks).
      var threadLen = Math.floor(progress * (WIDTH - 14));
      if (threadLen < 0) { threadLen = 0; }
      var threadStr = "";
      var i;
      for (i = 0; i < threadLen; i++) {
        threadStr += LOOPS[(i + t) % LOOPS.length];
      }

      // Lower wisp.
      var lowLen = Math.floor(threadLen * 0.7);
      var lowStr = "";
      for (i = 0; i < lowLen; i++) {
        lowStr += (i % 4 === 0) ? "⁀" : "~";
      }

      // Compose rows into stage, wiping previous children.
      // Each row ends with \n; yarn-coloured parts get a threadSpan.
      // Cat lines are plain text (stays --green via .actor).
      stage.textContent = "";

      // blank leading row
      stage.appendChild(tn("\n"));

      // Row: "        " + <thread glyphs>
      stage.appendChild(tn("        "));
      if (threadStr) { stage.appendChild(threadSpan(threadStr)); }
      stage.appendChild(tn("\n"));

      // Row: cat head line + ball
      stage.appendChild(tn("   /\\_/\\  "));
      stage.appendChild(threadSpan(ball));
      stage.appendChild(tn("\n"));

      // Row: eyes line
      stage.appendChild(tn("  " + eyes + "\n"));

      // Row: paws + low wisp
      stage.appendChild(tn("  " + paw + "   "));
      if (lowStr) { stage.appendChild(threadSpan(lowStr)); }
      stage.appendChild(tn("\n"));

      // trailing blank
      stage.appendChild(tn("\n"));

      ctx.center(host);
    }

    // reduce: one static frame at ~45 % progress, no timers.
    if (ctx.reduce) {
      render(0.45, 0);
      ctx.hint("Standbild: Katze mit halb abgewickeltem Knäuel (Bewegung reduziert).");
      return {};
    }

    // Initial paint.
    render(0, 0);

    // calm() does not require a separate branch in the source — the feel is already
    // slow at 620 ms base. We honour it in the hint only; ctx.every scales speed.
    function frame() {
      if (pause > 0) {
        pause--;
        render(1, tick);
        tick++;
        return;
      }

      var progress = step / STEPS;
      render(progress, tick);

      tick++;
      step++;

      if (step > STEPS) {
        pause = PAUSE_FRAMES;
        step = 0;
      }

      if (ctx.calm()) {
        ctx.hint("*entschleunigt* — das Knäuel wickelt sich langsam ab ...");
      } else if (step === 0 && pause > 0) {
        ctx.hint("Knäuel leer — kurze Pause, dann von vorn ...");
      } else {
        ctx.hint("die Katze spielt — das Knäuel wird kleiner, der Faden legt sich in Schlaufen");
      }
    }

    ctx.every(INTERVAL, frame);

    return {};
  }
});


  // ── Boot ───────────────────────────────────────────────────────────────────
  renderGallery();
  initSpeedSlider();

  var toggleBtn  = document.getElementById("stageToggle");
  var resumeBtn  = document.getElementById("stageResumeBtn");
  if (toggleBtn) toggleBtn.addEventListener("click", function () { applyStageOff(!stageOff); });
  if (resumeBtn) resumeBtn.addEventListener("click", function () { applyStageOff(false); });

  // Scene on load: a saved pick (explicit gallery click) always wins. With no
  // saved pick, the Pride month (June) opens on the Pride-Sweep; other months
  // pick a random scene each visit. Boot passes persist=false so a random
  // default stays random — only a gallery click writes bc-scene.
  var startId = lsGet(BC.storage.KEYS.SCENE);
  if (!sceneById(startId)) {
    startId = (new Date().getMonth() === 5 && sceneById("b1"))
      ? "b1"
      : SCENES[Math.floor(Math.random() * SCENES.length)].id;
  }
  activeId = startId;

  if (stageOff) {
    applyStageOff(true);
  } else {
    renderActive();
  }
})();
