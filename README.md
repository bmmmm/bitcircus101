# bitcircus101

[bitcircus101](https://bitcircus101.de) is a tech and creative space located in Bonn, Germany.

This repository contains the website for bitcircus101.

---

## 🚀 Cloudflare Pages Multilingual Static Site Deployment

This project uses a minimal Node.js build script to generate `/en/` and `/de/` folders from templates and translation files.

### **How to Deploy on Cloudflare Pages**

1. **Ensure your repo contains:**
   - `build.js` (build script)
   - `src/` (with `templates/`, `translations/`, `assets/`)
   - `package.json` (with `"build": "node src/translate-missing.js && node build.js"`)
   - (Optional) `src/translate-missing.js` for auto-translation

2. **Cloudflare Pages Settings:**
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Output directory:** `.` (root)

3. **How it works:**
   - Cloudflare will run your build script on every push.
   - The script generates `/en/` and `/de/` with localized HTML and assets.
   - The language toggle and translations are handled at build time for SEO and performance.

4. **To add or update content:**
   - Edit `src/templates/` and `src/translations/`.
   - Commit and push to GitHub.
   - Cloudflare will auto-build and deploy.

---
