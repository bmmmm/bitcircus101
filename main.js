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

  // =============================================================================
  // Navigation Module
  // =============================================================================
  const Navigation = {
    init() {
      const menuToggle = utils.getElementById("menu-toggle");
      const mainNav = utils.getElementById("main-nav");

      if (!menuToggle || !mainNav) return;

      utils.addEventListenerSafe(menuToggle, "click", () => {
        const expanded = mainNav.classList.toggle("active");
        menuToggle.setAttribute("aria-expanded", expanded);
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
      this.startAutoRotate();
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
          this.goToSlide(index);
          this.resetAutoRotateIfEnabled();
        });
      });
    },

    bindTouchEvents() {
      const { carousel } = this.elements;

      utils.addEventListenerSafe(carousel, "touchstart", (e) => {
        this.state.startX = e.touches[0].clientX;
      });

      utils.addEventListenerSafe(carousel, "touchend", (e) => {
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
      });
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
      dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
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

    goToSlide(index) {
      this.showSlide(index);
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
      const { toggleButton, container } = this.elements;
      this.state.isAutoRotateEnabled = !this.state.isAutoRotateEnabled;

      if (this.state.isAutoRotateEnabled) {
        toggleButton.innerHTML = "⏸️";
        toggleButton.setAttribute("aria-label", "Auto-Rotate pausieren");
        toggleButton.setAttribute("title", "Auto-Rotate pausieren");
        container.classList.remove("manual-mode");
        this.startAutoRotate();
      } else {
        toggleButton.innerHTML = "▶️";
        toggleButton.setAttribute("aria-label", "Auto-Rotate starten");
        toggleButton.setAttribute("title", "Auto-Rotate starten");
        container.classList.add("manual-mode");
        this.stopAutoRotate();
      }
    },
  };

  // =============================================================================
  // Map Module
  // =============================================================================
  const MapHandler = {
    init() {
      console.log("MapHandler: Starting initialization");
      const showMapBtn = utils.getElementById("show-map-btn");
      const mapContainer = utils.getElementById("osm-map-container");
      const osmMap = utils.getElementById("osm-map");

      console.log("MapHandler: Elements found:", {
        showMapBtn: !!showMapBtn,
        mapContainer: !!mapContainer,
        osmMap: !!osmMap,
        showMapBtnId: showMapBtn?.id,
        mapContainerId: mapContainer?.id,
        osmMapId: osmMap?.id,
      });

      if (!showMapBtn || !mapContainer || !osmMap) {
        console.warn("MapHandler: Missing required elements, aborting");
        return;
      }

      console.log("MapHandler: Adding click event listener");
      const success = utils.addEventListenerSafe(showMapBtn, "click", () => {
        console.log("MapHandler: Button clicked!");
        this.toggleMap(showMapBtn, mapContainer, osmMap);
      });

      console.log("MapHandler: Event listener added successfully:", success);
    },

    toggleMap(button, container, iframe) {
      console.log("MapHandler: toggleMap called");
      console.log("MapHandler: Current iframe src:", iframe.src);
      console.log(
        "MapHandler: Current container display:",
        container.style.display,
      );

      // Load map only on first click
      if (!iframe.src) {
        console.log("MapHandler: Loading iframe src");
        iframe.src =
          "https://www.openstreetmap.org/export/embed.html?bbox=7.057943344116212%2C50.72276418262858%2C7.12090015411377%2C50.75828718705439&layer=mapnik&marker=50.74052905321277%2C7.08942174911499";
      }

      // Toggle visibility
      const isVisible = container.style.display === "block";
      const newDisplay = isVisible ? "none" : "block";
      const newButtonText = isVisible
        ? "Auf Karte anzeigen"
        : "Karte verstecken";

      console.log(
        "MapHandler: Changing display from",
        container.style.display,
        "to",
        newDisplay,
      );
      console.log("MapHandler: Changing button text to", newButtonText);

      container.style.display = newDisplay;
      button.textContent = newButtonText;

      // Scroll to map when showing
      if (!isVisible) {
        console.log("MapHandler: Scrolling to map");
        setTimeout(() => {
          container.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
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
      this.handleImageErrors();
    },

    setupSmoothScrolling() {
      utils.addEventListenerSafe(document, "click", (e) => {
        if (e.target.matches('a[href^="#"]')) {
          e.preventDefault();
          const target = document.querySelector(e.target.getAttribute("href"));
          if (target) {
            target.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
        }
      });
    },

    handleImageErrors() {
      utils.addEventListenerSafe(
        document,
        "error",
        (e) => {
          if (e.target.matches("img")) {
            e.target.style.display = "none";
            console.warn("Failed to load image:", e.target.src);
          }
        },
        true,
      );
    },
  };

  // =============================================================================
  // Main Application
  // =============================================================================
  const App = {
    init() {
      console.log("App: Starting initialization");
      // Initialize all modules
      Navigation.init();
      Carousel.init();
      MapHandler.init();
      Accessibility.init();
      console.log("App: Initialization complete");
    },
  };

  // Multiple initialization strategies for robustness
  let initialized = false;

  function safeInit() {
    if (initialized) return;
    initialized = true;
    App.init();
  }

  // Strategy 1: DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeInit);
  } else {
    safeInit();
  }

  // Strategy 2: Window loaded (fallback)
  window.addEventListener("load", safeInit);

  // Strategy 3: Immediate retry (fallback for dynamic content)
  setTimeout(safeInit, 100);

  // =============================================================================
  // Debug/Test Functions (can be called from browser console)
  // =============================================================================
  window.testMapFunction = function () {
    console.log("=== MAP TEST FUNCTION ===");
    const showMapBtn = document.getElementById("show-map-btn");
    const mapContainer = document.getElementById("osm-map-container");
    const osmMap = document.getElementById("osm-map");

    console.log("Elements found:", {
      showMapBtn: !!showMapBtn,
      mapContainer: !!mapContainer,
      osmMap: !!osmMap,
    });

    if (showMapBtn) {
      console.log("Button element:", showMapBtn);
      console.log("Button text:", showMapBtn.textContent);
      console.log("Button classes:", showMapBtn.className);

      // Try to trigger the map manually
      if (mapContainer && osmMap) {
        console.log("Manually triggering map...");
        if (!osmMap.src) {
          osmMap.src =
            "https://www.openstreetmap.org/export/embed.html?bbox=7.057943344116212%2C50.72276418262858%2C7.12090015411377%2C50.75828718705439&layer=mapnik&marker=50.74052905321277%2C7.08942174911499";
          console.log("Map src set:", osmMap.src);
        }

        mapContainer.style.display = "block";
        showMapBtn.textContent = "Karte verstecken";
        console.log("Map should now be visible!");
      }
    } else {
      console.error("Button with id 'show-map-btn' not found!");
    }

    return "Test completed - check console output above";
  };
})();
