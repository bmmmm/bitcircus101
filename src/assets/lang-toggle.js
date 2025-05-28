document.addEventListener('DOMContentLoaded', function () {
  const langToggle = document.getElementById('lang-toggle');
  if (!langToggle) return;
  langToggle.addEventListener('change', function () {
    const lang = langToggle.value;
    const path = window.location.pathname;
    // Match /en/ or /de/ at the start of the path
    const match = path.match(/^\/(en|de)(\/.*)?$/);
    if (match) {
      // If in a language folder, switch the language but keep the rest of the path
      const rest = match[2] || '/';
      window.location.href = `/${lang}${rest}`;
    } else {
      // If not in a language folder, go to the root of the selected language
      window.location.href = `/${lang}/`;
    }
  });
});