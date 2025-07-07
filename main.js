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

    // Fallback for iframe loading issues
    const mapIframe = mapContainer.querySelector("iframe");
    if (mapIframe) {
      // Add error handling for iframe loading
      mapIframe.addEventListener("error", function () {
        handleMapFallback(mapContainer);
      });

      // Check if iframe loads successfully
      mapIframe.addEventListener("load", function () {
        // If iframe is blocked or partitioned, show fallback
        try {
          if (
            mapIframe.contentWindow &&
            mapIframe.contentWindow.location.href === "about:blank"
          ) {
            handleMapFallback(mapContainer);
          }
        } catch (e) {
          // Cross-origin restrictions prevent access, but iframe loaded
          console.log("Map iframe loaded with cross-origin restrictions");
        }
      });
    }
  }

  // Handle map fallback when iframe fails
  function handleMapFallback(container) {
    const iframe = container.querySelector("iframe");
    if (iframe) {
      iframe.style.display = "none";

      // Create static map fallback
      const fallbackDiv = document.createElement("div");
      fallbackDiv.className = "map-fallback";
      fallbackDiv.innerHTML = `
        <div style="
          background: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          min-height: 350px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        ">
          <div style="font-size: 48px; margin-bottom: 15px;">🗺️</div>
          <h3 style="margin: 0 0 10px 0; color: #333;">Karte nicht verfügbar</h3>
          <p style="color: #666; margin: 0 0 15px 0;">
            Die interaktive Karte kann aufgrund von Browser-Sicherheitseinstellungen nicht geladen werden.
          </p>
          <a href="https://www.openstreetmap.org/?mlat=50.74053&mlon=7.08942#map=15/50.74053/7.08942"
             target="_blank"
             rel="noopener"
             style="
               background: #4285f4;
               color: white;
               padding: 10px 20px;
               text-decoration: none;
               border-radius: 5px;
               font-weight: bold;
             ">
            🌐 Karte in neuem Tab öffnen
          </a>
          <div style="margin-top: 15px; font-size: 0.9em; color: #666;">
            <strong>Adresse:</strong> Dorotheenstraße 101, 53111 Bonn
          </div>
        </div>
      `;

      container.appendChild(fallbackDiv);
    }
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
