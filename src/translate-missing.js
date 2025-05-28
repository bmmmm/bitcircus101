// Optional: Auto-translate missing keys using LibreTranslate (for local use)
// Usage: node src/translate-missing.js
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const enPath = path.join(__dirname, 'translations', 'en.json');
const dePath = path.join(__dirname, 'translations', 'de.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
let de = {};
try {
  de = JSON.parse(fs.readFileSync(dePath, 'utf8'));
} catch {
  de = {};
}

async function translate(text) {
  const res = await fetch('https://libretranslate.de/translate', {
    method: 'POST',
    body: JSON.stringify({
      q: text,
      source: 'en',
      target: 'de',
      format: 'text'
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  return data.translatedText;
}

(async () => {
  let changed = false;
  for (const key in en) {
    if (!de[key]) {
      // eslint-disable-next-line no-await-in-loop
      de[key] = await translate(en[key]);
      console.log(`Translated: ${en[key]} -> ${de[key]}`);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(dePath, JSON.stringify(de, null, 2));
    console.log('Updated de.json with new translations.');
  } else {
    console.log('No missing keys to translate.');
  }
})();