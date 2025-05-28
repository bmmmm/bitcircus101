document.addEventListener('DOMContentLoaded', function () {
  const langToggle = document.getElementById('lang-toggle');
  if (!langToggle) return;
  langToggle.addEventListener('change', function () {
    const lang = langToggle.value;
    // Get current page filename (e.g., "about.html")
    const page = window.location.pathname.split('/').pop() || 'index.html';
    // Redirect to the same page in the other language
    window.location.href = `/${lang}/${page}`;
  });
});