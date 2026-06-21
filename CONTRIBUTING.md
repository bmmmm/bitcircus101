# Contributing to bitcircus101

Willkommen! We're happy about every contribution, no matter how small.

## Quick start

```sh
git clone https://github.com/bmmmm/bitcircus101.git
cd bitcircus101
```

That's it for most changes. This is a static site — just open the HTML files in your browser.

## Branch workflow

**Use a feature branch for every change — do not push commits directly to `main`.**

1. Update `main` locally, then branch:
   ```sh
   git checkout main
   git pull
   git checkout -b feat/short-description
   ```
2. Commit on your branch and **open a pull request into `main`** (push the branch, then create the PR on GitHub.)
3. After the PR is merged, **delete the feature branch** (GitHub offers “Delete branch” on the merged PR, or prune locally with `git fetch --prune`).

Short-lived `feat/…` branches keep history clear; `main` stays the integration line that CI deploys from.

If you want to run the quick checks before submitting:

```sh
pnpm install          # pnpm-only — npm/yarn are blocked by a preinstall guard
pnpm run test:quick   # ~100ms, no browser needed
```

That runs unit tests and matches what PR CI enforces (plus a layout sync check — see below).

## Navigation and footer (shared layout)

Header and footer live in **`includes/site-header.html`** and **`includes/site-footer.html`**. A small Node script copies them into the layout HTML files — no bundler or framework.

After you change those files:

```sh
pnpm run build:layout
```

Commit **`includes/`** and the updated **`*.html`** files together. **PR checks** fail if partials and pages drift apart. See [CLAUDE.md](CLAUDE.md) for details.

If you only edit a page body, you do not need `build:layout`.

## You do NOT need to

- Install Playwright or any browsers
- Run the full test suite (`pnpm test`)
- Set up Node.js (unless you want to run unit tests)

CI handles the heavy testing automatically.

## What happens when you open a PR

1. **CI runs unit tests and checks layout HTML** — fast, automatic, done in seconds (no Playwright)
2. **A maintainer reviews** your PR
3. **On merge to main** — the full E2E test suite runs automatically (Playwright, 2 browsers)
4. **If all tests pass** — your changes go live at [bitcircus101.de](https://bitcircus101.de)

Nothing reaches production without passing all tests. But that's CI's job, not yours.

## What's a good first contribution?

- Fix a typo or improve text
- Improve accessibility (aria labels, alt texts)
- Add or update content
- CSS tweaks and improvements
- Add a calendar source to `calendars.json`

## Guidelines

- Keep it simple — this is a static site, no frameworks
- German UI text, English code/comments
- No Google Fonts (privacy)
- No inline styles — use `style.css`
- Terminal aesthetic: dark bg, green accents, monospace

## Security headers (Cloudflare)

GitHub Pages can't set HTTP response headers, so they're applied at the
Cloudflare proxy in front of the site via a *Response Header Transform Rule*
(Rules → Transform Rules → Modify Response Header), on all routes:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://nc.6bm.de; frame-src https://ko-fi.com https://www.openstreetmap.org; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

- `script-src` keeps `'unsafe-inline'`: every page ships inline `<script>`
  blocks (theme no-flash, consent, date) and static hosting can't mint
  per-request nonces. `style-src` keeps `'unsafe-inline'` too: the zero-JS
  `/lite/` view inlines its entire stylesheet by design (a pinned test
  invariant — no external stylesheet), and the support-page ASCII scenes paint
  glyphs via inline `style=`. Most JS-set styles use the CSSOM (`el.style.x =
  …`), which `style-src` doesn't govern — but those two inline cases need it.
- The hardening wins: `object-src 'none'`, `base-uri 'self'`, clickjacking
  defence via `frame-ancestors 'none'` + `X-Frame-Options: DENY` (the header for
  older browsers; no `<meta>` equivalent), the `frame-src` allowlist, and
  `Strict-Transport-Security` (pins HTTPS for a year). Add a host to `frame-src`
  before embedding any new third party.
- `img-src data:` covers the logo-slider placeholders; `connect-src` the events
  page's Nextcloud ICS fallback fetch.
- `Referrer-Policy` is also a `<meta>` on every page (so it applies even without
  the rule); the header is the authoritative copy. The old `frame-src`-only CSP
  `<meta>` on the homepage was removed in favour of this single complete policy.

## Questions?

Open an issue or reach out at the space. Freitags ab 20:00 sind wir da.
