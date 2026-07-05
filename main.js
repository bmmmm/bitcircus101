// main.js – Modular Navigation, Carousel & Map functionality
(function () {
  "use strict";

  // =============================================================================
  // Utility Functions
  // =============================================================================
  const utils = {
    // Safely get element by ID
    getElementById: (id) => document.getElementById(id),

    // Safely query selector
    querySelector: (selector) => document.querySelector(selector),

    // Safely query selector all
    querySelectorAll: (selector) => document.querySelectorAll(selector),

    // Add event listener with error handling
    addEventListenerSafe: (element, event, handler, options = {}) => {
      if (element && typeof handler === "function") {
        element.addEventListener(event, handler, options);
        return true;
      }
      return false;
    },

    // Prevent default and stop propagation
    preventDefaultAndStop: (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };

  // Single source of truth for all JS-driven motion (carousel auto-rotate).
  // The light/dark toggle is purely visual and does not affect motion.
  function prefersReducedMotion() {
    return !!(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // =============================================================================
  // Navigation Module
  // =============================================================================
  const Navigation = {
    init() {
      const menuToggle = utils.getElementById("menu-toggle");
      const mainNav = utils.getElementById("main-nav");

      if (!mainNav) return;

      Navigation.markCurrentPage(mainNav);
      Navigation.bindHashUpdates();

      if (!menuToggle) return;

      utils.addEventListenerSafe(menuToggle, "click", () => {
        const expanded = mainNav.classList.toggle("active");
        menuToggle.setAttribute("aria-expanded", String(expanded));
      });

      // Close mobile menu with Escape, return focus to toggle
      utils.addEventListenerSafe(document, "keydown", (e) => {
        if (e.key === "Escape" && mainNav.classList.contains("active")) {
          mainNav.classList.remove("active");
          menuToggle.setAttribute("aria-expanded", "false");
          menuToggle.focus();
        }
      });
    },

    /**
     * Map pathname to a logical HTML filename (root → index.html).
     */
    normalizePageFile(pathname) {
      if (!pathname || pathname === "/") return "index.html";
      const trimmed = pathname.replace(/\/+$/, "") || "/";
      if (trimmed === "/" || trimmed === "") return "index.html";
      const parts = trimmed.split("/").filter(Boolean);
      const last = parts[parts.length - 1] || "";
      if (/\.html?$/i.test(last)) return last.toLowerCase();
      return "index.html";
    },

    /**
     * Set aria-current and nav__link--current by resolving each nav href against
     * the current URL (works with / vs /index.html and subdirectory deploys).
     */
    markCurrentPage(mainNav) {
      const links = mainNav.querySelectorAll("ul li a[href]");
      if (!links.length) return;

      const here = window.location;
      const hereFile = Navigation.normalizePageFile(here.pathname);
      const hereHash = (here.hash || "").toLowerCase();

      links.forEach((a) => {
        a.removeAttribute("aria-current");
        a.classList.remove("nav__link--current");
      });

      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        const raw = a.getAttribute("href");
        if (!raw || raw === "feed.xml") continue;

        let resolved;
        try {
          resolved = new URL(raw, here.href);
        } catch (e) {
          continue;
        }

        const linkFile = Navigation.normalizePageFile(resolved.pathname);
        if (linkFile !== hereFile) continue;

        if (hereFile === "index.html") {
          const rawLower = raw.toLowerCase();
          if (hereHash === "#contact") {
            if (!rawLower.includes("#contact")) continue;
          } else {
            if (rawLower.includes("#contact")) continue;
            if (!rawLower.includes("#about")) continue;
          }
        }

        a.setAttribute("aria-current", "page");
        a.classList.add("nav__link--current");
        return;
      }
    },

    /** Re-run when only the hash changes on index.html (in-page anchors). */
    bindHashUpdates() {
      if (Navigation.normalizePageFile(window.location.pathname) !== "index.html") {
        return;
      }
      window.addEventListener("hashchange", () => {
        const mainNav = utils.getElementById("main-nav");
        if (!mainNav) return;
        Navigation.markCurrentPage(mainNav);
      });
    },
  };

  // =============================================================================
  // Carousel Module
  // =============================================================================
  const Carousel = {
    config: {
      autoRotateInterval: 5000,
      resetDelay: 8000,
      touchThreshold: 50,
    },

    state: {
      current: 0,
      autoRotateInterval: null,
      isAutoRotateEnabled: true,
      startX: 0,
    },

    elements: {
      carousel: null,
      items: null,
      dots: null,
      container: null,
      prevButton: null,
      nextButton: null,
      toggleButton: null,
    },

    init() {
      this.elements.carousel = utils.querySelector(".carousel");
      if (!this.elements.carousel) return;

      this.cacheElements();
      this.bindEvents();
      this.showSlide(this.state.current);
      this.applyMotionPreference();
    },

    // Auto-rotate only when the user hasn't asked for reduced motion.
    // Safe on pages without a carousel.
    applyMotionPreference() {
      if (!this.elements.carousel) return;
      if (prefersReducedMotion()) {
        this.state.isAutoRotateEnabled = false;
        this.stopAutoRotate();
      } else {
        this.state.isAutoRotateEnabled = true;
        this.startAutoRotate();
      }
      // Keep the toggle button in sync with the resolved state, else calm mode shows
      // a "pause" glyph while frozen and the first click starts motion instead of pausing.
      this.syncToggleUI();
    },

    cacheElements() {
      const { carousel } = this.elements;
      this.elements.items = carousel.querySelectorAll(".carousel-item");
      this.elements.dots = document.querySelectorAll(".dot");
      this.elements.container = carousel.parentElement;
      this.elements.prevButton = this.elements.container?.querySelector(
        ".carousel-button.prev",
      );
      this.elements.nextButton = this.elements.container?.querySelector(
        ".carousel-button.next",
      );
      this.elements.toggleButton =
        this.elements.container?.querySelector(".carousel-toggle");
    },

    bindEvents() {
      this.bindButtonEvents();
      this.bindDotEvents();
      this.bindTouchEvents();
      this.bindVisibilityEvents();
    },

    bindButtonEvents() {
      const { prevButton, nextButton, toggleButton } = this.elements;

      utils.addEventListenerSafe(prevButton, "click", (e) => {
        utils.preventDefaultAndStop(e);
        this.prevSlide();
        this.resetAutoRotateIfEnabled();
      });

      utils.addEventListenerSafe(nextButton, "click", (e) => {
        utils.preventDefaultAndStop(e);
        this.nextSlide();
        this.resetAutoRotateIfEnabled();
      });

      utils.addEventListenerSafe(toggleButton, "click", (e) => {
        utils.preventDefaultAndStop(e);
        this.toggleAutoRotate();
      });
    },

    bindDotEvents() {
      this.elements.dots.forEach((dot, index) => {
        utils.addEventListenerSafe(dot, "click", (e) => {
          utils.preventDefaultAndStop(e);
          this.showSlide(index);
          this.resetAutoRotateIfEnabled();
        });
      });
    },

    bindTouchEvents() {
      const { carousel } = this.elements;

      utils.addEventListenerSafe(carousel, "touchstart", (e) => {
        this.state.startX = e.touches[0].clientX;
      }, { passive: true });

      utils.addEventListenerSafe(carousel, "touchend", (e) => {
        if (!e.changedTouches.length) return;
        const endX = e.changedTouches[0].clientX;
        const deltaX = this.state.startX - endX;

        if (Math.abs(deltaX) > this.config.touchThreshold) {
          if (deltaX > 0) {
            this.nextSlide();
          } else {
            this.prevSlide();
          }
          this.resetAutoRotateIfEnabled();
        }
      }, { passive: true });
    },

    bindVisibilityEvents() {
      const { carousel } = this.elements;

      // Pause on hover
      utils.addEventListenerSafe(carousel, "mouseenter", () => {
        if (this.state.isAutoRotateEnabled) {
          this.stopAutoRotate();
        }
      });

      utils.addEventListenerSafe(carousel, "mouseleave", () => {
        if (this.state.isAutoRotateEnabled) {
          this.startAutoRotate();
        }
      });

      // Pause when tab is not visible
      utils.addEventListenerSafe(document, "visibilitychange", () => {
        if (this.state.isAutoRotateEnabled) {
          if (document.hidden) {
            this.stopAutoRotate();
          } else {
            this.startAutoRotate();
          }
        }
      });
    },

    showSlide(index) {
      const { items, dots } = this.elements;
      if (index < 0 || index >= items.length) return;

      items.forEach((item, i) => item.classList.toggle("active", i === index));
      dots.forEach((dot, i) => {
        const on = i === index;
        dot.classList.toggle("active", on);
        // Expose the active slide to assistive tech (dots are real buttons now).
        if (on) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      this.state.current = index;
    },

    nextSlide() {
      const nextIndex = (this.state.current + 1) % this.elements.items.length;
      this.showSlide(nextIndex);
    },

    prevSlide() {
      const prevIndex =
        (this.state.current - 1 + this.elements.items.length) %
        this.elements.items.length;
      this.showSlide(prevIndex);
    },

    startAutoRotate() {
      this.stopAutoRotate();
      this.state.autoRotateInterval = setInterval(() => {
        this.nextSlide();
      }, this.config.autoRotateInterval);
    },

    stopAutoRotate() {
      if (this.state.autoRotateInterval) {
        clearInterval(this.state.autoRotateInterval);
        this.state.autoRotateInterval = null;
      }
    },

    resetAutoRotateIfEnabled() {
      if (this.state.isAutoRotateEnabled) {
        this.stopAutoRotate();
        setTimeout(() => this.startAutoRotate(), this.config.resetDelay);
      }
    },

    toggleAutoRotate() {
      this.state.isAutoRotateEnabled = !this.state.isAutoRotateEnabled;
      this.syncToggleUI();
      if (this.state.isAutoRotateEnabled) this.startAutoRotate();
      else this.stopAutoRotate();
    },

    // Reflect isAutoRotateEnabled on the toggle button + container. Guarded so it is
    // safe on pages where the carousel has no toggle button.
    syncToggleUI() {
      const { toggleButton, container } = this.elements;
      const playing = this.state.isAutoRotateEnabled;
      if (toggleButton) {
        // ︎ forces text presentation — keeps the glyphs monochrome.
        toggleButton.innerHTML = playing ? "⏸︎" : "▶︎";
        const label = playing ? "Auto-Rotate pausieren" : "Auto-Rotate starten";
        toggleButton.setAttribute("aria-label", label);
        toggleButton.setAttribute("title", label);
      }
      if (container) container.classList.toggle("manual-mode", !playing);
    },
  };

  // =============================================================================
  // Map Module
  // =============================================================================
  const MapHandler = {
    init() {
      const showMapBtn = utils.getElementById("show-map-btn");
      const mapContainer = utils.getElementById("osm-map-container");
      const osmMap = utils.getElementById("osm-map");

      if (!showMapBtn || !mapContainer || !osmMap) return;

      utils.addEventListenerSafe(showMapBtn, "click", () => {
        this.toggleMap(showMapBtn, mapContainer, osmMap);
      });

      // Clicking anywhere on the card (outside the open map area) triggers the button
      const card = showMapBtn.closest(".location-card");
      if (card) {
        utils.addEventListenerSafe(card, "click", (e) => {
          if (showMapBtn.contains(e.target)) return;
          if (mapContainer.contains(e.target)) return;
          this.toggleMap(showMapBtn, mapContainer, osmMap);
        });
      }
    },

    toggleMap(button, container, iframe) {
      if (!iframe.src.includes("openstreetmap.org")) {
        iframe.src =
          "https://www.openstreetmap.org/export/embed.html?bbox=7.057943344116212%2C50.72276418262858%2C7.12090015411377%2C50.75828718705439&layer=mapnik&marker=50.74052905321277%2C7.08942174911499";
      }

      const isVisible = !container.classList.contains("hidden");
      container.classList.toggle("hidden");
      button.textContent = isVisible ? "[ karte laden ]" : "[ karte schließen ]";

      if (!isVisible) {
        setTimeout(() => {
          container.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    },
  };

  // =============================================================================
  // Accessibility Module
  // =============================================================================
  const Accessibility = {
    init() {
      this.setupSmoothScrolling();
      this.setupNavHighlight();
      this.handleImageErrors();
    },

    setupSmoothScrolling() {
      utils.addEventListenerSafe(document, "click", (e) => {
        const anchor = e.target.closest('a[href^="#"]');
        if (!anchor) return;
        e.preventDefault();
        const href = anchor.getAttribute("href");
        // A bare "#" is not a valid selector — querySelector("#") throws a SyntaxError.
        if (href.length < 2) return;
        const target = document.querySelector(href);
        if (target) {
          const isSkip = anchor.classList.contains("skip-link");
          // Skip links jump instantly and must move keyboard focus to the target —
          // smooth-scrolling without focusing leaves the next Tab in the nav, which
          // defeats the skip link for keyboard/AT users.
          target.scrollIntoView({ behavior: isSkip ? "auto" : "smooth", block: "start" });
          history.pushState(null, "", href);
          if (isSkip) {
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus();
          }
        }
        // Section anchor: share or copy URL
        if (anchor.classList.contains("section-anchor")) {
          const url = location.href;
          if (navigator.share) {
            navigator.share({ url }).catch(() => {});
          } else if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
              const orig = anchor.textContent;
              anchor.textContent = "✓";
              setTimeout(() => { anchor.textContent = orig; }, 1200);
            }).catch(() => {});
          }
        }
      });
    },

    setupNavHighlight() {
      if (!("IntersectionObserver" in window)) return;
      const mainNav = utils.getElementById("main-nav");
      // Build map of hash → nav link (handles both "#id" and "page.html#id")
      const navLinks = {};
      document.querySelectorAll("nav a[href*='#']").forEach(link => {
        const parts = link.getAttribute("href").split("#");
        if (parts[1]) navLinks["#" + parts[1]] = link;
      });
      const observed = document.querySelectorAll("section[id]");
      if (!observed.length) return;

      // Links the spy manages (those mapping to an observed section).
      const spied = [];
      observed.forEach(s => {
        const l = navLinks["#" + s.id];
        if (l && spied.indexOf(l) === -1) spied.push(l);
      });
      if (!spied.length) return;

      const visible = new Set();
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const link = navLinks["#" + entry.target.id];
          if (!link) return;
          if (entry.isIntersecting) visible.add(link);
          else visible.delete(link);
        });
        // markCurrentPage owns aria-current (the stable page marker); the spy only
        // drives the visual class. Highlight the in-view section(s); when none is in
        // view, restore the page default so the highlight never vanishes mid-scroll.
        if (visible.size) {
          spied.forEach(l => l.classList.toggle("nav__link--current", visible.has(l)));
        } else if (mainNav) {
          Navigation.markCurrentPage(mainNav);
        }
      }, { rootMargin: "-10% 0px -75% 0px" });

      observed.forEach(s => { if (navLinks["#" + s.id]) observer.observe(s); });
    },

    handleImageErrors() {
      utils.addEventListenerSafe(
        document,
        "error",
        (e) => {
          if (e.target.matches("img")) {
            e.target.classList.add("hidden");
          }
        },
        true,
      );
    },
  };

  // =============================================================================
  // Events Preview (homepage)
  // =============================================================================
  const EventsPreview = {
    init() {
      const el = utils.getElementById("next-events-list");
      if (!el) return;

      fetch("events-data.json")
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          var events = Array.isArray(data) ? data : data.events;
          if (events && events.length) this.render(events, el);
        })
        .catch(() => {});
    },

    render(events, el) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const DAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      const upcoming = events
        .filter((e) => new Date(e.date + "T23:59:59") >= now)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 3);

      if (!upcoming.length) return;

      let html = "";
      upcoming.forEach((e) => {
        const d = new Date(e.date + "T00:00:00");
        const dow = DAYS[d.getDay()];
        const date = pad(d.getDate()) + "." + pad(d.getMonth() + 1) + ".";
        const typeClass = e.type ? " event-preview--" + e.type : "";
        html += '<a class="event-preview' + typeClass + '" href="events.html">';
        html += '<span class="event-preview__dow">' + dow + "</span>";
        html += '<span class="event-preview__date">' + date + "</span>";
        html +=
          '<span class="event-preview__title">' +
          escHtml(e.title);
        if (e.source && e.source !== "bitcircus101") {
          html += ' <span class="event-preview__source">' +
            escHtml(e.source) + "</span>";
        }
        html += "</span>";
        if (e.time)
          html +=
            '<span class="event-preview__time">' + escHtml(e.time) + "</span>";
        html += "</a>";
      });

      el.innerHTML = html;
      el.removeAttribute("aria-busy");
    },
  };

  // =============================================================================
  // Funding Status
  // =============================================================================
  const FundingStatus = {
    init() {
      var elements = utils.querySelectorAll(".footer__status");
      if (!elements.length) return;

      fetch("funding.json")
        .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
        .then(function (data) {
          var pct = parseInt(data.percent, 10);
          if (isNaN(pct)) return;
          elements.forEach(function (el) {
            FundingStatus.render(el, pct);
          });
        })
        .catch(function () {
          // fallback: try data-funding attribute
          elements.forEach(function (el) {
            var pct = parseInt(el.getAttribute("data-funding"), 10);
            if (!isNaN(pct)) FundingStatus.render(el, pct);
          });
        });
    },

    render(el, pct) {
      var p = Math.max(0, Math.min(100, pct));
      var filled = Math.round(p / 10);
      var bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);

      var level = "red";
      if (p >= 80) level = "green";
      else if (p >= 33) level = "amber";

      el.classList.add("footer__status--" + level);
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "status");
      el.setAttribute(
        "aria-label",
        "Funding: " + p + "% der monatlichen Kosten gedeckt",
      );

      el.innerHTML =
        '<span class="footer__funding-bar">lights: ' +
        bar +
        " " +
        p +
        "%</span>" +
        '<div class="footer__funding-info">' +
        '<h3 class="footer__funding-info-head">[ LIGHTS ON? ]</h3>' +
        "<p>Miete, Strom, Internet &mdash; der Space kostet Geld.</p>" +
        "<p>" +
        bar +
        " " +
        p +
        "% der monatlichen Kosten sind gerade gedeckt.</p>" +
        "<p>\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 100% = Space l\u00e4uft aus eigener Kraft.</p>" +
        '<a href="support.html#dauerhaft">unterst\u00fctzen \u2192</a>' +
        "</div>";

      // Click to toggle info panel
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        var info = el.querySelector(".footer__funding-info");
        if (info) info.classList.toggle("active");
      });

      document.addEventListener("click", function () {
        var info = el.querySelector(".footer__funding-info");
        if (info) info.classList.remove("active");
      });
    },
  };

  // =============================================================================
  // Scroll to Top
  // =============================================================================
  const ScrollTop = {
    init() {
      var btn = document.createElement("button");
      btn.className = "scroll-top";
      btn.setAttribute("aria-label", "Nach oben scrollen");
      btn.innerHTML = "▲";
      btn.type = "button";
      document.body.appendChild(btn);

      // Show/hide on scroll
      var ticking = false;
      window.addEventListener("scroll", function () {
        if (!ticking) {
          requestAnimationFrame(function () {
            btn.classList.toggle("visible", window.scrollY > 400);
            ticking = false;
          });
          ticking = true;
        }
      }, { passive: true });

      btn.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    },
  };

  // =============================================================================
  // Logo slider (Freund*innen) — load partner logos when section nears viewport
  // =============================================================================
  const LogoSliderLazy = {
    init() {
      const root = utils.getElementById("freundinnen");
      if (!root) return;
      const imgs = root.querySelectorAll("img.logo-slider__img[data-src]");
      if (!imgs.length) return;

      const hydrate = () => {
        imgs.forEach((img) => {
          const ds = img.getAttribute("data-src");
          if (ds) {
            img.src = ds;
            img.removeAttribute("data-src");
          }
        });
      };

      if (typeof IntersectionObserver === "undefined") {
        hydrate();
        return;
      }

      const io = new IntersectionObserver(
        (entries) => {
          for (let i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              io.disconnect();
              hydrate();
              return;
            }
          }
        },
        { root: null, rootMargin: "160px 0px 240px 0px", threshold: 0 }
      );
      io.observe(root);
    },
  };

  // =============================================================================
  // Footer Year
  // =============================================================================
  const FooterYear = {
    init() {
      const year = new Date().getFullYear();
      utils.querySelectorAll(".footer__year").forEach((el) => {
        el.textContent = year;
      });
    },
  };

  // =============================================================================
  // Theme toggle (dark / light) — reverse video for the whole page
  // =============================================================================
  const Theme = {
    init() {
      const btn = utils.getElementById("theme-toggle");
      if (!btn) return;
      const isLight = () => document.documentElement.dataset.theme === "light";
      btn.setAttribute("aria-pressed", String(isLight()));
      utils.addEventListenerSafe(btn, "click", () => {
        const nowLight = !isLight();
        document.documentElement.dataset.theme = nowLight ? "light" : "";
        BC.storage.set(BC.storage.KEYS.THEME, nowLight ? "light" : "dark");
        btn.setAttribute("aria-pressed", String(nowLight));
      });
    },
  };

  // =============================================================================
  // Main Application
  // =============================================================================
  const App = {
    init() {
      Navigation.init();
      Carousel.init();
      MapHandler.init();
      Accessibility.init();
      EventsPreview.init();
      FundingStatus.init();
      ScrollTop.init();
      FooterYear.init();
      LogoSliderLazy.init();
      Theme.init();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }
})();
