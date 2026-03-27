# Contributing to bitcircus101

Willkommen! We're happy about every contribution, no matter how small.

## Quick start

```sh
git clone https://github.com/bitcircus101/bitcircus101.de.git
cd bitcircus101.de
```

That's it for most changes. This is a static site — just open the HTML files in your browser.

If you want to run the quick checks before submitting:

```sh
npm install
npm run test:quick    # ~100ms, no browser needed
```

## You do NOT need to

- Install Playwright or any browsers
- Run the full test suite (`npm test`)
- Set up Node.js (unless you want to run unit tests)

CI handles the heavy testing automatically.

## What happens when you open a PR

1. **CI runs unit tests** — fast, automatic feedback
2. **A maintainer reviews** your PR
3. **On merge to main** — the full Playwright test suite (204 tests across 3 browsers) runs automatically
4. **If tests pass** — your changes go live at [bitcircus101.de](https://bitcircus101.de)

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
