// main.js – Navigation, Carousel & Map functionality
(function () {
  "use strict";

  // Navigation
  const menuToggle = document.getElementById("menu-toggle");
  const mainNav = document.getElementById("main-nav");
  if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", function () {
      const expanded = mainNav.classList.toggle("active");
      menuToggle.setAttribute("aria-expanded", expanded);
    });
  }

  // Map functionality
  const showMapBtn = document.getElementById("show-map-btn");
  const mapContainer = document.getElementById("osm-map-container");
  if (showMapBtn && mapContainer) {
    showMapBtn.addEventListener("click", function () {
      const isVisible = mapContainer.style.display !== "none";
      mapContainer.style.display = isVisible ? "none" : "block";
      showMapBtn.textContent = isVisible
        ? "Karte anzeigen"
        : "Karte verstecken";
      showMapBtn.setAttribute("aria-expanded", !isVisible);

      if (!isVisible) {
        setTimeout(
          () =>
            mapContainer.scrollIntoView({
              behavior: "smooth",
              block: "center",
            }),
          100,
        );
      }
    });
  }

  // Carousel with Auto-Rotate
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    const items = carousel.querySelectorAll(".carousel-item");
    const dots = document.querySelectorAll(".dot");
    let current = 0;
    let autoRotateInterval;

    function showSlide(idx) {
      if (idx < 0 || idx >= items.length) return;
      items.forEach((item, i) => item.classList.toggle("active", i === idx));
      dots.forEach((dot, i) => dot.classList.toggle("active", i === idx));
    }

    function nextSlide() {
      current = (current + 1) % items.length;
      showSlide(current);
    }

    function prevSlide() {
      current = (current - 1 + items.length) % items.length;
      showSlide(current);
    }

    function startAutoRotate() {
      clearInterval(autoRotateInterval);
      autoRotateInterval = setInterval(nextSlide, 5000);
    }

    function stopAutoRotate() {
      clearInterval(autoRotateInterval);
    }

    function resetAutoRotate() {
      stopAutoRotate();
      setTimeout(startAutoRotate, 8000);
    }

    // Direct button event handlers
    const prevButton = carousel.querySelector(".carousel-button.prev");
    const nextButton = carousel.querySelector(".carousel-button.next");

    if (prevButton) {
      prevButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        prevSlide();
        resetAutoRotate();
      });
    }

    if (nextButton) {
      nextButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        nextSlide();
        resetAutoRotate();
      });
    }

    // Dot clicks
    dots.forEach((dot, index) => {
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        current = index;
        showSlide(current);
        resetAutoRotate();
      });
    });

    // Touch support
    let startX = 0;
    carousel.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    });

    carousel.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      const deltaX = startX - endX;

      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          nextSlide();
        } else {
          prevSlide();
        }
        resetAutoRotate();
      }
    });

    // Pause on hover
    carousel.addEventListener("mouseenter", stopAutoRotate);
    carousel.addEventListener("mouseleave", startAutoRotate);

    // Pause when tab is not visible
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopAutoRotate();
      } else {
        startAutoRotate();
      }
    });

    // Initialize
    showSlide(current);
    startAutoRotate();
  }

  // Smooth scrolling for anchor links
  document.addEventListener("click", (e) => {
    if (e.target.matches('a[href^="#"]')) {
      e.preventDefault();
      const target = document.querySelector(e.target.getAttribute("href"));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // Handle image loading errors
  document.addEventListener(
    "error",
    (e) => {
      if (e.target.matches("img")) {
        e.target.style.display = "none";
        console.warn("Failed to load image:", e.target.src);
      }
    },
    true,
  );
})();
