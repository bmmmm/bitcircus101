# Contributing to bitcircus101

Willkommen! We're happy about every contribution, no matter how small.

## Quick start

```sh
git clone https://github.com/bitcircus101/bitcircus101.de.git
cd bitcircus101.de
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
npm install
npm run test:quick    # ~100ms, no browser needed
```

That runs unit tests and matches what PR CI enforces (plus a layout sync check — see below).

## Navigation and footer (shared layout)

Header and footer live in **`includes/site-header.html`** and **`includes/site-footer.html`**. A small Node script copies them into the layout HTML files — no bundler or framework.

After you change those files:

```sh
npm run build:layout
```

Commit **`includes/`** and the updated **`*.html`** files together. **PR checks** fail if partials and pages drift apart. See [CLAUDE.md](CLAUDE.md) for details.

If you only edit a page body, you do not need `build:layout`.

## You do NOT need to

- Install Playwright or any browsers
- Run the full test suite (`npm test`)
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

## Questions?

Open an issue or reach out at the space. Freitags ab 20:00 sind wir da.
