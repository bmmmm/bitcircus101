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

  // Carousel
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    const items = carousel.querySelectorAll(".carousel-item");
    const dots = document.querySelectorAll(".dot");
    let current = 0;
    let autoRotateInterval;
    let isUserInteracting = false;

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

    function toggleAutoRotate(start = true) {
      clearInterval(autoRotateInterval);
      if (start && !isUserInteracting) {
        autoRotateInterval = setInterval(nextSlide, 5000);
      }
    }

    function handleUserInteraction() {
      isUserInteracting = true;
      toggleAutoRotate(false);
      setTimeout(() => {
        isUserInteracting = false;
        toggleAutoRotate();
      }, 10000);
    }

    // Event delegation for all carousel controls
    carousel.addEventListener("click", (e) => {
      if (e.target.matches(".carousel-button.next")) {
        handleUserInteraction();
        nextSlide();
      } else if (e.target.matches(".carousel-button.prev")) {
        handleUserInteraction();
        prevSlide();
      } else if (e.target.matches(".dot")) {
        handleUserInteraction();
        current = [...dots].indexOf(e.target);
        showSlide(current);
      }
    });

    // Keyboard navigation
    carousel.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        handleUserInteraction();
        e.key === "ArrowLeft" ? prevSlide() : nextSlide();
      }
    });

    // Keyboard navigation for dots
    dots.forEach((dot, index) => {
      dot.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleUserInteraction();
          current = index;
          showSlide(current);
        }
      });
    });

    // Enhanced touch/swipe support
    let startX = 0;
    let startY = 0;
    let isSwiping = false;

    carousel.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = false;
      },
      { passive: true },
    );

    carousel.addEventListener(
      "touchmove",
      (e) => {
        if (!startX || !startY) return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = Math.abs(currentX - startX);
        const deltaY = Math.abs(currentY - startY);

        // Only handle horizontal swipes
        if (deltaX > deltaY && deltaX > 10) {
          isSwiping = true;
          e.preventDefault();
        }
      },
      { passive: false },
    );

    carousel.addEventListener(
      "touchend",
      (e) => {
        if (!isSwiping) return;

        const endX = e.changedTouches[0].clientX;
        const deltaX = startX - endX;

        if (Math.abs(deltaX) > 50) {
          handleUserInteraction();
          deltaX > 0 ? nextSlide() : prevSlide();
        }

        startX = 0;
        startY = 0;
        isSwiping = false;
      },
      { passive: true },
    );

    // Pause on hover and visibility change
    carousel.addEventListener("mouseenter", () => (isUserInteracting = true));
    carousel.addEventListener("mouseleave", () => (isUserInteracting = false));

    // Pause on touch interaction
    carousel.addEventListener("touchstart", () => (isUserInteracting = true));
    carousel.addEventListener("touchend", () => {
      setTimeout(() => (isUserInteracting = false), 1000);
    });

    document.addEventListener("visibilitychange", () =>
      toggleAutoRotate(!document.hidden),
    );

    // Improve button accessibility
    const prevButton = carousel.querySelector(".carousel-button.prev");
    const nextButton = carousel.querySelector(".carousel-button.next");

    if (prevButton) {
      prevButton.addEventListener("touchstart", (e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(0.95)";
      });
      prevButton.addEventListener("touchend", (e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(1)";
      });
    }

    if (nextButton) {
      nextButton.addEventListener("touchstart", (e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(0.95)";
      });
      nextButton.addEventListener("touchend", (e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(1)";
      });
    }

    // Initialize
    showSlide(current);
    toggleAutoRotate();
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
