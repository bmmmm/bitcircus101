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
      const showMapBtn = utils.getElementById("show-map-btn");
      const mapContainer = utils.getElementById("osm-map-container");
      const osmMap = utils.getElementById("osm-map");

      if (!showMapBtn || !mapContainer || !osmMap) return;

      utils.addEventListenerSafe(showMapBtn, "click", () => {
        this.toggleMap(showMapBtn, mapContainer, osmMap);
      });
    },

    toggleMap(button, container, iframe) {
      // Load map only on first click
      if (!iframe.src) {
        iframe.src =
          "https://www.openstreetmap.org/export/embed.html?bbox=7.057943344116212%2C50.72276418262858%2C7.12090015411377%2C50.75828718705439&layer=mapnik&marker=50.74052905321277%2C7.08942174911499";
      }

      // Toggle visibility
      const isVisible = container.style.display === "block";
      container.style.display = isVisible ? "none" : "block";
      button.textContent = isVisible
        ? "Auf Karte anzeigen"
        : "Karte verstecken";

      // Scroll to map when showing
      if (!isVisible) {
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
      // Initialize all modules
      Navigation.init();
      Carousel.init();
      MapHandler.init();
      Accessibility.init();
    },
  };

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }
})();
