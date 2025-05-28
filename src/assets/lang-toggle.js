document.addEventListener('DOMContentLoaded', function () {
  const langToggle = document.getElementById('lang-toggle');
  if (!langToggle) return;
  langToggle.addEventListener('change', function () {
    const lang = langToggle.value;
    // Always go to the root of the selected language
    window.location.href = `/${lang}/`;
  });
});