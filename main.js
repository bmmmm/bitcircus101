// main.js – Navigation & Carousel modularisiert
(function() {
    // Navigation
    const menuToggle = document.getElementById('menu-toggle');
    const mainNav = document.getElementById('main-nav');
    if (menuToggle && mainNav) {
        menuToggle.addEventListener('click', function() {
            const expanded = mainNav.classList.toggle('active');
            menuToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }, {passive: true});
    }

    // Carousel
    const carousel = document.querySelector('.carousel');
    if (carousel) {
        const items = carousel.querySelectorAll('.carousel-item');
        const dots = document.querySelectorAll('.dot');
        let current = 0;
        function showSlide(idx) {
            items.forEach((item, i) => {
                item.classList.toggle('active', i === idx);
            });
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === idx);
            });
            carousel.setAttribute('aria-live', 'polite');
        }
        function nextSlide() {
            current = (current + 1) % items.length;
            showSlide(current);
        }
        function prevSlide() {
            current = (current - 1 + items.length) % items.length;
            showSlide(current);
        }
        document.querySelector('.carousel-button.next')?.addEventListener('click', nextSlide);
        document.querySelector('.carousel-button.prev')?.addEventListener('click', prevSlide);
        dots.forEach((dot, i) => {
            dot.addEventListener('click', () => {
                current = i;
                showSlide(current);
            });
        });
        showSlide(current);
    }
})();
