# CLAUDE.md

Agent rules only — detail is not repeated here. Structure, generated files, CI,
calendar system, test coverage → [README.md](README.md); contributor workflow →
[CONTRIBUTING.md](CONTRIBUTING.md); calendar source fields →
[calendars/README.md](calendars/README.md).

Static website for [bitcircus101](https://bitcircus101.de), a hackspace in Bonn.
Pure HTML/CSS/JS — **no bundler, no framework.** Build steps:
`build:layout` (header/footer), `build:logos` (logo strip), `build:lite-finanz`
(lite funding block); `pnpm run build` runs all three. Each has a CI drift gate:
edit source, rebuild, commit both — a forgotten rebuild fails the PR.

## Branches

Branch **`feat/<kebab>`** or **`fix/<kebab>`** from current `main`, commit there,
open a PR. Never commit on `main` without an explicit exception — a one-line
docs fix isn't too small for a PR.

**Merge the PR locally:** `git merge --no-ff <branch> -m "Merge pull request #N:
<title>"`, then push to **both** remotes (`origin` = Forgejo, `github` = the
mirror; without the second push no deploy runs). Delete the branch afterwards.
A web-UI or `tea pr merge` merge stamps a Forge identity the pre-push leak gate
blocks (`~/ops/reference/git-workflow.md`).

Commits: [conventional](https://www.conventionalcommits.org/), scope in
parentheses — `feat(events): add filter`. The release workflow parses them.

## CI gate

The PR gate is **`.forgejo/workflows/ci.yml`** — PRs live on Forgejo, and once
that directory exists Forgejo ignores `.github/workflows/` entirely.
`.github/workflows/ci.yml` is its twin on the mirror; keep both in lockstep.

`pnpm run test:quick` before a PR, `pnpm run test:e2e` only if you changed JS
logic. CI runs the full suite after the merge to `main`.

## Tests

- **Consolidate, don't multiply.** One test per logical area; each `page.goto()`
  is expensive — batch related checks.
- **Don't test static content.** If it can only break by deleting HTML, it isn't
  worth a test.
- **Do test interactions** — carousel, filter, mobile menu, consent banner.
- **Do test invariants** — no JS errors, no broken links, no Google Fonts,
  noindex on the danke page.

## Conventions

- German UI text, English code comments — exception: terminal-/hacker-aesthetic
  pages (currently only the 404) may use English/terminal slang.
- No inline styles — everything in `style.css`, JS-built markup included: use
  the `hidden` attribute or a class, never `style="display:…"` in a template
  string.
- The `--accent` scope rule (what may be green, what stays ink) sits at the
  token definition in `style.css`.
- **Clean URLs are canonical, in-page links keep `.html`.** Production
  308-redirects `/events.html` → `/events`, so everything a crawler consumes
  names the extension-less form: `canonical`, `og:url`, JSON-LD `url`, the RSS
  links (`EVENTS_URL` in `sync-events.mjs`), `llms.txt`, sitemap. In-page
  `href`s keep `.html` — `python3 -m http.server` and Playwright serve files,
  so a clean-URL `href` 404s locally. `index.html` pages are unaffected.

## Data files — never hand-edit

CI writes what [README § Generated files](README.md#generated-files) lists. Two
more are tooling-only:

- `finanz.json` / `funding.json` — only via `pnpm run finanz` (`--json` for
  scripts; `add`, `monthly` and the bare menu are interactive and exit 1 without
  a TTY — there is no non-interactive path for adding an item, so a script edits
  the JSON and runs `pnpm run finanz:validate`). Whole euros. After a change:
  `pnpm run build:lite-finanz`, commit `lite/index.html`.
- `jobs.json` — gate is `pnpm run check:jobs`; expiry only warns, never errors.

**Never run `scripts/sync-events.mjs` to try a calendar link out** — it
overwrites the feeds *and* rewrites the JSON-LD in the tracked `events.html`.
The read-only path is `node scripts/check-calendars.mjs --probe "<ics-url>"`;
then create the source file, list it in `calendars/config.json`, run
`pnpm run check:calendars`.

## Adding a page

1. Create the HTML file.
2. Nav link into `includes/site-header.html` (register it in
   `scripts/inject-layout.mjs` if it shares the chrome) → `pnpm run build:layout`
   → commit partial + HTML.
3. Add it to the `pages` array of the "No JavaScript errors" test in
   `tests/site.spec.js`.
4. The sitemap generates itself on deploy.

**Hidden** pages (`/ascii/`): own subfolder, out of `includes/site-header.html`
**and** `scripts/inject-layout.mjs` (partials assume root-relative links),
`noindex` + `Disallow` in `robots.txt`. **Unlisted but shareable** pages
(`invite-*/`, `join-*/`, `kiosk/`): `noindex` only — don't re-add a robots block
"for consistency".
