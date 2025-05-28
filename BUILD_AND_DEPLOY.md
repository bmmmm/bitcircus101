# Build & Deploy Instructions for Multilingual Static Site

This project uses a simple static build process to generate `/en/` and `/de/` folders from templates and translation files. No frameworks or static site generators are required.

---

## 1. Prerequisites

- [Node.js](https://nodejs.org/) installed (v14+ recommended)
- All source files are in `src/` (templates, translations, assets)
- The build script is `build.js` in the project root

---

## 2. Project Structure

```
project-root/
├── src/
│   ├── templates/      # HTML templates with placeholders
│   ├── translations/   # en.json, de.json, etc.
│   └── assets/         # Shared JS, CSS, images
├── build.js            # Build script
├── en/                 # Generated English site
├── de/                 # Generated German site
└── ...
```

---

## 3. How to Build

1. **Edit your content:**
   - Update templates in `src/templates/`
   - Update translations in `src/translations/`
   - Add or update assets in `src/assets/`

2. **Run the build script:**

   ```
   node build.js
   ```

   This will:
   - Generate `/en/` and `/de/` folders with localized HTML files
   - Copy assets into each language folder

---

## 4. How to Deploy

- Upload the contents of `/en/`, `/de/`, and any other generated folders to your static web host (e.g. Netlify, GitHub Pages, Vercel, etc).
- Make sure your web server serves `/en/` and `/de/` as top-level folders.

---

## 5. Adding a New Language

1. Create a new translation file, e.g. `src/translations/fr.json`
2. Add `"fr"` to the `languages` array in `build.js`
3. Add `<option value="fr">Français</option>` to the language toggle in your template(s)
4. Run `node build.js` again

---

## 6. Adding a New Page

1. Add a new template file to `src/templates/` (e.g. `about.html`)
2. Add any new translation keys to each JSON file in `src/translations/`
3. Run `node build.js` again

---

## 7. SEO & Language Toggle

- Each page includes `<link rel="alternate" hreflang="...">` tags for SEO.
- The language toggle (`<select id="lang-toggle">`) switches between `/en/` and `/de/` while preserving the current page.

---

## 8. Troubleshooting

- If you add new translation keys, make sure they exist in **all** language JSON files.
- If you add a new template, ensure all placeholders have corresponding keys in the translation files.

---

**That’s it!**  
You now have a maintainable, multilingual static site with a simple build process.