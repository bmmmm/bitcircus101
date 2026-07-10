# CLAUDE.md

Project conventions for contributors and Claude Code.

## What this is

Static website for [bitcircus101](https://bitcircus101.de), a hackspace in Bonn.
Pure HTML/CSS/JS — **no bundler, no framework.** Shared site chrome (nav + footer) uses `includes/*.html` plus a one-shot **`pnpm run build:layout`** (see [Shared layout](#shared-layout)); everything else is edited directly.

## Branches

| Branch | Purpose |
|--------|---------|
| `feat/…` or `fix/…` | **Short-lived branches.** All work happens here; open a PR into `main`. Delete after merge. |
| `main` | Integration branch. **Do not push local commits directly** — merge via PR only. |
| `live` | Production. Deployed via GitHub Pages. Only CI commits here |

**Workflow:** `git checkout -b feat/my-change` → commit → push → PR to `main` → merge → delete `feat/my-change`.

### For AI agents — branches

Always create a **`feat/<kebab-description>`** or **`fix/<kebab-description>`** branch from current `main` for edits, commit there, and have the user push / open a PR. Do **not** commit on `main` unless the user explicitly asks for an exception.

## Testing strategy

**Contributors don't need to run the full test suite locally.**

| Command | What | When to use |
|---------|------|-------------|
| `pnpm run test:quick` | Unit tests only (~3s, no browser) | Before submitting a PR |
| `pnpm run test:unit` | Same as test:quick | Alias |
| `pnpm run test:e2e` | Playwright across 2 browsers (~20 tests × 2) | Only if you changed JS logic |
| `pnpm test` | Full suite (unit + E2E) | CI runs this, you usually don't need to |

### How CI works

```
PR to main  →  Unit tests + layout sync check (fast, no Playwright)
Push to main  →  Full suite (unit + E2E × 2 browsers)  →  Deploy to live
```

Tests gate deployment, not contribution. A PR with failing unit tests or layout drift gets flagged.
The heavy Playwright suite runs after merge to `main` — before anything reaches production.

### For AI agents — tests

When adding or modifying tests:
- **Consolidate, don't multiply.** One test per logical area, not one per assertion.
  Each `page.goto()` is expensive — batch related checks into a single test.
- **Don't test static content.** If it can only break by deleting HTML, it's not worth a test.
- **Do test interactions.** Carousel, filter, mobile menu, consent banner — things with JS logic.
- **Do test invariants.** No JS errors, no broken links, no Google Fonts, noindex on danke page.
- Add new pages to the `pages` array in the "No JavaScript errors" test.

## Local development

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080` in your browser. For visual inspection use Chrome directly — no Playwright needed locally.

## Package manager — pnpm only

This repo is **pnpm-only** (supply-chain policy). npm and yarn are blocked by a
`preinstall` guard. Install deps with **`pnpm install`**; `package-lock.json` /
`yarn.lock` are git-ignored. `pnpm-workspace.yaml` enforces a 3-day release cooldown
(`minimumReleaseAge`) and blocks dependency build scripts (`onlyBuiltDependencies: []`).
Local E2E needs browsers once: `pnpm exec playwright install` (CI uses the Playwright
container, which has them baked in).

## Shared layout

| Item | Role |
|------|------|
| `includes/site-header.html` | Single source for `<header>` / nav |
| `includes/site-footer.html` | Single source for `<footer>` |
| `scripts/inject-layout.mjs` | Inlines those into the six layout HTML files |
| `pnpm run build:layout` | Run after editing the partials |

**Workflow:** Edit the partials → `pnpm run build:layout` → commit partials **and** changed `*.html`. CI runs `inject-layout.mjs` and fails if there is any `git diff` on HTML (drift). Deploy also runs inject before cache-busting so `live` stays aligned.

## Homepage logo strip (Freund*innen)

| Item | Role |
|------|------|
| `images/logo-slider/` | Partner logos (`.svg`, `.png`, `.jpg`, `.jpeg`) |
| `scripts/build-logo-slider.mjs` | Writes the marked block in `index.html` from that folder |
| `pnpm run build:logos` | Run after adding or removing files under `images/logo-slider/` |

**Workflow:** Add or delete logo files → `pnpm run build:logos` → commit `index.html` **and** the image files. CI runs `inject-layout.mjs` then `build-logo-slider.mjs` and fails on HTML drift (same check as layout). Deploy runs both before minification/cache-busting.

## Code conventions

- German UI text, English code comments — exception: terminal-/hacker-aesthetic pages (currently only the 404 page) may use English/terminal-slang copy
- No bundlers — edit HTML/CSS/JS directly (except `pnpm run build:layout` for `includes/*.html` and `pnpm run build:logos` when you touch `images/logo-slider/*`)
- Plain-text aesthetic: monospace font, reverse-video interaction, dark is the default, `◐` toggles the light scheme. The `--accent` token (terminal green) covers hyperlinks, primary CTAs and current-selection markers; controls and toggles stay reverse-video ink — full scope rule at the token definition in `style.css`
- No Google Fonts or external font loading (privacy)
- No inline styles — everything in `style.css` (applies to JS-built markup too: use the `hidden` attribute or a class, not `style="display:…"` in template strings)
- **Commit messages:** use [conventional commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `style:`, `chore:`, etc. Scopes in parentheses: `feat(events): add filter`. The release workflow parses these to auto-generate release notes.

## Releases

- **Versioning:** CalVer — `v2026.03.28` (date-based, `.N` suffix for same-day)
- **Trigger:** Manual via `release.yml` workflow dispatch (Actions → Create release → Run workflow)
- **What happens:** Commits since last tag are grouped by type, a GitHub Release is created, and `changelog.md` is updated automatically
- Releases are decoupled from deploys — deploys happen on every merge to `main`, releases when you decide

## Files you should NOT edit

These are generated by CI. Seed values exist on `main` (for local dev / E2E tests), but CI overwrites them on the `live` branch:

- `events-data.json` — generated by calendar sync (not tracked on `main`)
- `feed.xml` — RSS feed, generated by calendar sync (not tracked on `main`)
- `ical.ics` — iCal feed of the primary calendar with real DTSTART/DTEND (the aggregator-facing feed), generated by calendar sync (not tracked on `main`)
- `events/feed.xml`, `events/ical.ics` — byte-identical copies of the two feeds so a relative `<link>` resolved from the `/events` clean-URL lands on the real feed; generated by calendar sync (not tracked on `main`)
- `sitemap.xml` — generated on deploy (seed on `main`)
- `funding.json` — updated via manual workflow (seed on `main`)

## Other notable files

- `main.js` — Modular Navigation, Carousel & Map functionality (shared across pages, not page-specific)
- `events.js` — events page renderer (loads `events-data.json`, falls back to a live ICS fetch)
- `ics-core.js` — **single shared ICS parser** (UMD, written in ES5 so the browser loads it raw). Used by both `events.js` (browser fallback) and `scripts/sync-events.mjs` (CI sync) — edit once, both consumers update; no parser drift.
- `scripts/sync-events.mjs` — CI calendar sync: fetches sources → writes `events-data.json`, `feed.xml` (RSS) and `ical.ics` (iCal, with real DTSTART/DTEND) plus the `events/` copies of both feeds. Times are floating-local; CI pins `TZ=Europe/Berlin`, and the iCal export tags them `TZID=Europe/Berlin` with a bundled VTIMEZONE.
- `scripts/live-overlay.mjs`, `scripts/cache-bust.mjs`, `scripts/smoke-live.mjs` — the deploy pipeline's file logic (overlay main→live preserving CI feeds, `?v=` cache-busting, post-deploy health poll); runs and tests locally via `tests/deploy-scripts.spec.mjs`.
- `llms.txt` — LLM-friendly site summary ([llms.txt standard](https://llmstxt.org/))
- `changelog.md` — release history (auto-updated by release workflow)
- `robots.txt` — crawler rules; explicitly allows AI bots, blocks `/ascii/`
- `google18556084d38e4dd8.html` — Google Search Console verification (do not delete)

## Adding a calendar source

Every source lives in its own JSON file under `calendars/`. Manifest `calendars/config.json` lists which sources to process and in what order. Adding a new source = create the JSON file, list its relative path in `config.json`. Removing = remove the line (or delete the file).

```
calendars/
  config.json                       ← manifest, lists active sources
  bitcircus.json                    ← stable primary feed
  datenburg.json
  external/
    kult41-theater-tumult-…json     ← curated external entries
```

Source `type`s:
- (default) `ics-full` — pull the whole calendar
- `ics-single` — single curated event ICS URL (e.g. `https://kult41.de/events/foo/ical/`)
- `ics-filtered` — full calendar with `filter.categoryAllow` / `categoryDeny` / `titleAllow` / `titleDeny` lists

Each source can also set `tags` (always-added hashtags), `cap` (per-source slot override), `eventUrl` (fallback link when ICS lacks `URL`). Sources without `id`/`ics` are skipped with a warning.

## Adding a new page

1. Create the HTML file
2. Add the nav link in `includes/site-header.html`, run `pnpm run build:layout`, and commit the updated partial + HTML files (or register the page in `scripts/inject-layout.mjs` if it should share the same chrome)
3. Add the page to the `pages` array in `tests/site.spec.js` (no-JS-errors test)
4. Sitemap is auto-generated on deploy

### Hidden and unlisted pages

The sitemap generator honors three exclusion mechanisms automatically: `noindex` meta, `robots.txt` `Disallow`, and `exclude-paths` in `sitemap.yml` (only for pages *without* `noindex` — currently the Google verification stub and `donations.html`).

- **Hidden pages** (e.g. `/ascii/`): use a subfolder like `ascii/index.html`, keep it out of `includes/site-header.html` **and** `scripts/inject-layout.mjs` (partials assume root-relative links); mark `noindex` and `Disallow` it in `robots.txt`.
- **Reachable-but-unlisted pages** (`invite-*/`, `join-*/` Signal redirect stubs): `noindex` only, intentionally **not** `Disallow`ed — they're shareable links; don't re-add a robots block "for consistency".
