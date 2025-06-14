const fs = require('fs');
const path = require('path');

const languages = ['en', 'de'];
const srcDir = path.join(__dirname, 'src');
const templatesDir = path.join(srcDir, 'templates');
const translationsDir = path.join(srcDir, 'translations');
const assetsDir = path.join(srcDir, 'assets');

function renderTemplate(template, translations, lang, page) {
  // Replace placeholders with translation values
  let html = template.replace(/{{(\w+)}}/g, (_, key) => {
    if (key === 'lang') return lang;
    if (key === `${lang}_selected`) return 'selected';
    if (key === `${languages.find(l => l !== lang)}_selected`) return '';
    return translations[key] || '';
  });
  // Insert correct alternate links
  html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*"/, `<link rel="alternate" hreflang="en" href="/en/${page}"`);
  html = html.replace(/<link rel="alternate" hreflang="de" href="[^"]*"/, `<link rel="alternate" hreflang="de" href="/de/${page}"`);
  return html;
}

function build() {
  // Copy assets
  for (const lang of languages) {
    const outDir = path.join(__dirname, lang);
    fs.mkdirSync(outDir, { recursive: true });
    if (fs.existsSync(assetsDir)) {
      fs.cpSync(assetsDir, path.join(outDir, 'assets'), { recursive: true });
    }
  }

  // Build each template for each language
  const templates = fs.readdirSync(templatesDir).filter(f => f.endsWith('.html'));
  for (const lang of languages) {
    const translations = JSON.parse(fs.readFileSync(path.join(translationsDir, `${lang}.json`), 'utf8'));
    for (const file of templates) {
      const template = fs.readFileSync(path.join(templatesDir, file), 'utf8');
      const html = renderTemplate(template, translations, lang, file);
      fs.writeFileSync(path.join(__dirname, lang, file), html, 'utf8');
    }
  }
}

build();
console.log('Build complete!');