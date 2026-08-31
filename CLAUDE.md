# CLAUDE.md

Project conventions for contributors and Claude Code.

## What this is

Static website for [bitcircus101](https://bitcircus101.de), a hackspace in Bonn.
Pure HTML/CSS/JS — **no bundler, no framework.** Everything is edited directly; the only build steps are **`pnpm run build:layout`** for the shared chrome in `includes/*.html` (see [Shared layout](#shared-layout)) and **`pnpm run build:logos`** for `images/logo-slider/*`.

## Branches

| Branch | Purpose |
|--------|---------|
| `feat/…` or `fix/…` | **Short-lived branches.** All work happens here; open a PR into `main`. Delete after merge. |
| `main` | Integration branch. **Do not push local commits directly** — merge via PR only. |
| `live` | Production. Deployed via GitHub Pages. Only CI commits here |

**Workflow:** `git checkout -b feat/my-change` → commit → push → PR to `main` → merge → delete `feat/my-change`.

### For AI agents — branches

Always branch (**`feat/<kebab>`** or **`fix/<kebab>`**) from current `main`, commit there, open a PR. Never commit on `main` without an explicit exception — and that holds regardless of size: a one-line docs fix is not too small for a PR.

**Merge the PR locally, not via `tea pr merge` or the Forgejo web UI** — a server-side merge signs the commit with the Forge identity, which the pre-push leak gate blocks, so the push would need `--no-verify`. `git merge --no-ff <branch> -m "Merge pull request #N: <title>"`, then push to **both** remotes (`origin` = Forgejo, `github` = the mirror; without the second push no deploy runs). Full rationale: `~/ops/reference/git-workflow.md`.

## Testing strategy

**Contributors don't need to run the full test suite locally.**

| Command | What | When to use |
|---------|------|-------------|
| `pnpm run test:quick` | Unit tests only (~3s, no browser); `test:unit` is an alias | Before submitting a PR |
| `pnpm run test:e2e` | Playwright across 2 browsers (~20 tests × 2) | Only if you changed JS logic |
| `pnpm test` | Full suite (unit + E2E) | CI runs this, you usually don't need to |

### How CI works

```
PR to main  →  Unit tests + layout sync check (fast, no Playwright)
Push to main  →  Full suite (unit + E2E × 2 browsers)  →  Deploy to live
```

Tests gate deployment, not contribution: a PR with failing units or layout drift gets flagged, but the heavy Playwright suite only runs after merge to `main`.

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
- Plain-text aesthetic: monospace font, reverse-video interaction, dark is the default, `◐` toggles the light scheme. The `--accent` token (terminal green) covers hyperlinks, primary CTAs and current-selection markers; controls and toggles stay reverse-video ink — full scope rule at the token definition in `style.css`
- No Google Fonts or external font loading (privacy)
- No inline styles — everything in `style.css` (applies to JS-built markup too: use the `hidden` attribute or a class, not `style="display:…"` in template strings)
- **Clean URLs are canonical, in-page links keep `.html`.** Production 308-redirects `/events.html` → `/events`, so everything a crawler or aggregator consumes names the extension-less form: `canonical`, `og:url`, JSON-LD `url`, the RSS links (`EVENTS_URL` in `sync-events.mjs`), `llms.txt`, sitemap (`drop-html-extension: true`). In-page `href`s keep `.html` — `python3 -m http.server` and Playwright serve files, not clean URLs, so a clean-URL `href` 404s locally. `index.html` pages are unaffected (`/`, `/chat/`).
- **Commit messages:** use [conventional commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `style:`, `chore:`, etc. Scopes in parentheses: `feat(events): add filter`. The release workflow parses these to auto-generate release notes.

## Releases

- **Versioning:** CalVer — `v2026.03.28` (date-based, `.N` suffix for same-day)
- **Trigger:** Manual via `release.yml` workflow dispatch (Actions → Create release → Run workflow)
- **What happens:** Commits since last tag are grouped by type, a GitHub Release is created, and `changelog.md` is updated automatically
- Releases are decoupled from deploys — deploys happen on every merge to `main`, releases when you decide

## Files you should NOT edit

CI generates these — never hand-edit them. The calendar-sync outputs live **only on `live`**; `main` carries no copy at all. Only the last two keep a seed on `main` that CI overwrites on `live`.

- `events-data.json`, `feed.xml` (RSS), `ical.ics` (iCal with real DTSTART/DTEND — the aggregator-facing feed) — written by the calendar sync
- `events/feed.xml`, `events/ical.ics` — byte-identical copies of both feeds, so a relative `<link>` resolved from the `/events` clean URL lands on the real feed
- `feeds/` — filtered ICS/RSS feeds, one pair per tag (`feeds/tag/<slug>.*`) and per source (`feeds/source/<id>.*`) plus `feeds/all.*`, derived from the same ≤40-event window the events page shows. `events-data.json` carries a `feeds` manifest mapping tags/sources to these paths — the frontend reads paths from there, never derives slugs
- `sitemap.xml` — generated on every deploy (seed on `main`)
- `funding.json` — updated via manual workflow (seed on `main`)

## Other notable files

- `main.js` — Modular Navigation, Carousel & Map functionality (shared across pages, not page-specific)
- `events.js` — events page renderer (loads `events-data.json`, falls back to a live ICS fetch; the fallback shapes cards via `events-core.js`, so it gets the same tags/types as the JSON path)
- `ics-core.js` — **single shared ICS parser** (UMD, written in ES5 so the browser loads it raw). Used by both `events.js` (browser fallback) and `scripts/sync-events.mjs` (CI sync) — edit once, both consumers update; no parser drift.
- `events-core.js` — **single shared card builder** (UMD, ES5 like `ics-core.js`): tags, event type and the card object (`toCards`). Same both-consumers contract as the parser; the card key order is pinned by a golden test in `tests/sync-events.spec.mjs`.
- `scripts/sync-events.mjs` — CI calendar sync: fetches sources → writes `events-data.json`, `feed.xml` (RSS) and `ical.ics` (iCal, with real DTSTART/DTEND) plus the `events/` copies of both feeds. Times are floating-local; CI pins `TZ=Europe/Berlin`, and the iCal export tags them `TZID=Europe/Berlin` with a bundled VTIMEZONE.
- `scripts/check-calendars.mjs` — calendar-manifest guard rails. Offline (default): validates `calendars/` and exits non-zero on error. `--probe <url>`: fetches one ICS and previews the cards it would produce; `--probe` alone health-checks every configured source. Writes nothing in either mode. Tested by `tests/calendars.spec.mjs`.
- `scripts/live-overlay.mjs`, `scripts/cache-bust.mjs`, `scripts/smoke-live.mjs` — the deploy pipeline's file logic (overlay main→live preserving CI feeds and pruning files no longer on `main`; `?v=` cache-busting; post-deploy health check), tested via `tests/deploy-scripts.spec.mjs`. The smoke check walks every URL in the deployed `sitemap.xml` and fails on anything that is not a direct 200, so a dead page or a redirecting entry breaks the deploy instead of going unnoticed. Standalone: `node scripts/smoke-live.mjs https://bitcircus101.de`.
- `llms.txt` — LLM-friendly site summary ([llms.txt standard](https://llmstxt.org/))
- `changelog.md` — release history (auto-updated by release workflow)
- `robots.txt` — crawler rules; explicitly allows AI bots, blocks `/ascii/`
- `google18556084d38e4dd8.html` — Google Search Console verification (do not delete)

## Adding a calendar source

Full contributor/outsider guide: **`calendars/README.md`** — this section is the short form.

Every source lives in its own JSON file under `calendars/`. Manifest `calendars/config.json` lists which sources to process and in what order. Removing = remove the line (or delete the file).

**Workflow:** `node scripts/check-calendars.mjs --probe "<ics-url>"` (fetches the link, renders it through the real `toCards()` so the preview matches the sync exactly, prints a paste-ready snippet — writes nothing) → create the JSON file → list it in `config.json` → **`pnpm run check:calendars`**.

Never run `sync-events.mjs` to try a link out: it overwrites the feeds **and rewrites the JSON-LD block in the tracked `events.html`**. `--probe` is the read-only path.

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

`pnpm run check:calendars` (also a PR gate in `ci.yml`, and asserted by `tests/calendars.spec.mjs`) turns the flow's silent failures into build failures: unknown keys — `id`/`name`/`ics` are required, and `name` must be **unique** because it keys `icsKeys`, the RSS source filter and the stale-cache lookup — bad types, misspelled `filter` keys, duplicate ids. A source file that exists but is not listed in `config.json` is a *warning*, not an error: parking a source that way is intentional.

## Adding a new page

1. Create the HTML file
2. Add the nav link in `includes/site-header.html`, run `pnpm run build:layout`, and commit the updated partial + HTML files (or register the page in `scripts/inject-layout.mjs` if it should share the same chrome)
3. Add the page to the `pages` array in `tests/site.spec.js` (no-JS-errors test)
4. Sitemap is auto-generated on deploy

### Hidden and unlisted pages

The sitemap generator honors three exclusion mechanisms automatically: `noindex` meta, `robots.txt` `Disallow`, and the `exclude-paths` option of the sitemap-generation step in `deploy.yml` (only for pages *without* `noindex` — currently the Google verification stub and `donations.html`).

- **Hidden pages** (e.g. `/ascii/`): use a subfolder like `ascii/index.html`, keep it out of `includes/site-header.html` **and** `scripts/inject-layout.mjs` (partials assume root-relative links); mark `noindex` and `Disallow` it in `robots.txt`.
- **Reachable-but-unlisted pages** (`invite-*/`, `join-*/` Signal redirect stubs): `noindex` only, intentionally **not** `Disallow`ed — they're shareable links; don't re-add a robots block "for consistency".
