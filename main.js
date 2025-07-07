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

  // Carousel with Auto-Rotate
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    const items = carousel.querySelectorAll(".carousel-item");
    const dots = document.querySelectorAll(".dot");
    let current = 0;
    let autoRotateInterval;
    let isAutoRotateEnabled = true;

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

    // Direct button event handlers - look in parent container
    const carouselContainer = carousel.parentElement;
    const prevButton = carouselContainer.querySelector(".carousel-button.prev");
    const nextButton = carouselContainer.querySelector(".carousel-button.next");
    const toggleButton = carouselContainer.querySelector(".carousel-toggle");

    if (prevButton) {
      prevButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        prevSlide();
        if (isAutoRotateEnabled) {
          resetAutoRotate();
        }
      });
    }

    if (nextButton) {
      nextButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        nextSlide();
        if (isAutoRotateEnabled) {
          resetAutoRotate();
        }
      });
    }

    // Toggle button functionality
    if (toggleButton) {
      toggleButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        isAutoRotateEnabled = !isAutoRotateEnabled;

        if (isAutoRotateEnabled) {
          toggleButton.innerHTML = "⏸️";
          toggleButton.setAttribute("aria-label", "Auto-Rotate pausieren");
          toggleButton.setAttribute("title", "Auto-Rotate pausieren");
          carouselContainer.classList.remove("manual-mode");
          startAutoRotate();
        } else {
          toggleButton.innerHTML = "▶️";
          toggleButton.setAttribute("aria-label", "Auto-Rotate starten");
          toggleButton.setAttribute("title", "Auto-Rotate starten");
          carouselContainer.classList.add("manual-mode");
          stopAutoRotate();
        }
      });
    }

    // Dot clicks
    dots.forEach((dot, index) => {
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        current = index;
        showSlide(current);
        if (isAutoRotateEnabled) {
          resetAutoRotate();
        }
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
        if (isAutoRotateEnabled) {
          resetAutoRotate();
        }
      }
    });

    // Pause on hover (only if auto-rotate is enabled)
    carousel.addEventListener("mouseenter", () => {
      if (isAutoRotateEnabled) {
        stopAutoRotate();
      }
    });
    carousel.addEventListener("mouseleave", () => {
      if (isAutoRotateEnabled) {
        startAutoRotate();
      }
    });

    // Pause when tab is not visible (only if auto-rotate is enabled)
    document.addEventListener("visibilitychange", () => {
      if (isAutoRotateEnabled) {
        if (document.hidden) {
          stopAutoRotate();
        } else {
          startAutoRotate();
        }
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
