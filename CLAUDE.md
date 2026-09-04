# CLAUDE.md

Project conventions for contributors and Claude Code.

## What this is

Static website for [bitcircus101](https://bitcircus101.de), a hackspace in Bonn.
Pure HTML/CSS/JS — **no bundler, no framework.** Everything is edited directly; the only build steps are **`pnpm run build:layout`** (shared chrome, see [Shared layout](#shared-layout)) and **`pnpm run build:logos`** (logo strip).

## Branches

| Branch | Purpose |
|--------|---------|
| `feat/…` or `fix/…` | **Short-lived branches.** All work happens here; open a PR into `main`. Delete after merge. |
| `main` | Integration branch. **Do not push local commits directly** — merge via PR only. |
| `live` | Production. Deployed via GitHub Pages. Only CI commits here |

### For AI agents — branches

Always branch (**`feat/<kebab>`** or **`fix/<kebab>`**) from current `main`, commit there, open a PR. Never commit on `main` without an explicit exception — a one-line docs fix is not too small for a PR.

**Merge the PR locally** — `git merge --no-ff <branch> -m "Merge pull request #N: <title>"`, then push to **both** remotes (`origin` = Forgejo, `github` = the mirror; without the second push no deploy runs). A web-UI/`tea pr merge` stamps a Forge identity the pre-push leak gate blocks; rationale in `~/ops/reference/git-workflow.md`.

## Testing strategy

**Contributors don't need to run the full test suite locally.**

| Command | What | When to use |
|---------|------|-------------|
| `pnpm run test:quick` | Unit tests only (~3s, no browser); `test:unit` is an alias | Before submitting a PR |
| `pnpm run test:e2e` | Playwright across 2 browsers (~20 tests × 2) | Only if you changed JS logic |
| `pnpm test` | Full suite (unit + E2E) | CI runs this, you usually don't need to |

### How CI works

```
PR to main (Forgejo)  →  Unit tests + layout sync check (fast, no Playwright)
Push to main (GitHub) →  Full suite (unit + E2E × 2 browsers)  →  Deploy to live
```

Tests gate deployment, not contribution: the heavy Playwright suite only runs after merge to `main`.

The PR gate lives in `.forgejo/workflows/ci.yml` (PRs live on Forgejo; once that dir exists, Forgejo ignores `.github/workflows/` entirely — those run only on the GitHub mirror). Keep the two `ci.yml` twins in lockstep when changing the gate.

### For AI agents — tests

When adding or modifying tests:
- **Consolidate, don't multiply.** One test per logical area; each `page.goto()`
  is expensive — batch related checks into one test.
- **Don't test static content.** If it can only break by deleting HTML, it's not worth a test.
- **Do test interactions.** Carousel, filter, mobile menu, consent banner — things with JS logic.
- **Do test invariants.** No JS errors, no broken links, no Google Fonts, noindex on danke page.
- Add new pages to the `pages` array in the "No JavaScript errors" test.

## Local development

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080` — inspect directly in Chrome, no Playwright locally.

## Package manager — pnpm only

**pnpm-only** (supply-chain policy): npm/yarn are blocked by a `preinstall` guard,
their lockfiles git-ignored. `pnpm-workspace.yaml` enforces a 3-day release cooldown
and blocks dependency build scripts. Local E2E needs browsers once:
`pnpm exec playwright install` (baked into the CI container).

## Shared layout

| Item | Role |
|------|------|
| `includes/site-header.html` | Single source for `<header>` / nav |
| `includes/site-footer.html` | Single source for `<footer>` |
| `scripts/inject-layout.mjs` | Inlines those into the seven layout HTML files |
| `pnpm run build:layout` | Run after editing the partials |

**Workflow:** Edit the partials → `pnpm run build:layout` → commit partials **and** changed `*.html`. CI fails on any HTML drift; deploy re-runs inject before cache-busting.

## Homepage logo strip (Freund*innen)

| Item | Role |
|------|------|
| `images/logo-slider/` | Partner logos (`.svg`, `.png`, `.jpg`, `.jpeg`) |
| `scripts/build-logo-slider.mjs` | Writes the marked block in `index.html` from that folder |
| `pnpm run build:logos` | Run after adding or removing files under `images/logo-slider/` |

**Workflow:** Add or delete logo files → `pnpm run build:logos` → commit `index.html` **and** the image files. Same CI drift check and deploy re-run as the layout above.

## Code conventions

- German UI text, English code comments — exception: terminal-/hacker-aesthetic pages (currently only the 404 page) may use English/terminal-slang copy
- Plain-text aesthetic: monospace, reverse-video interaction, dark default, `◐` toggles light. `--accent` (terminal green) covers hyperlinks, primary CTAs and current-selection markers; controls/toggles stay reverse-video ink — full scope rule at the token definition in `style.css`
- No Google Fonts or external font loading (privacy)
- No inline styles — everything in `style.css` (applies to JS-built markup too: use the `hidden` attribute or a class, not `style="display:…"` in template strings)
- **Clean URLs are canonical, in-page links keep `.html`.** Production 308-redirects `/events.html` → `/events`, so everything a crawler or aggregator consumes names the extension-less form: `canonical`, `og:url`, JSON-LD `url`, the RSS links (`EVENTS_URL` in `sync-events.mjs`), `llms.txt`, sitemap (`drop-html-extension: true`). In-page `href`s keep `.html` — `python3 -m http.server` and Playwright serve files, not clean URLs, so a clean-URL `href` 404s locally. `index.html` pages are unaffected (`/`, `/chat/`).
- **Commit messages:** use [conventional commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `style:`, `chore:`, etc. Scopes in parentheses: `feat(events): add filter`. The release workflow parses these to auto-generate release notes.

## Releases

- **Versioning:** CalVer — `v2026.03.28` (`.N` suffix for same-day)
- **Trigger:** manual `release.yml` workflow dispatch; commits since the last tag are grouped by type into a GitHub Release, `changelog.md` updates automatically
- Decoupled from deploys — deploys happen on every merge to `main`, releases when you decide

## Files you should NOT edit

CI generates these — never hand-edit. Calendar-sync outputs live **only on `live`**; only `sitemap.xml` keeps a seed on `main`.

- `events-data.json`, `feed.xml` (RSS), `ical.ics` (aggregator-facing iCal, real DTSTART/DTEND) — written by the calendar sync
- `events/feed.xml`, `events/ical.ics` — copies so a relative `<link>` resolved from the `/events` clean URL still hits the real feed
- `feeds/` — filtered ICS/RSS per tag (`feeds/tag/<slug>.*`), per source (`feeds/source/<id>.*`) and `feeds/all.*`, same ≤40-event window as the page; the `feeds` manifest in `events-data.json` maps them (the frontend never derives slugs)
- `sitemap.xml` — generated on every deploy (seed on `main`)

## Other notable files

Detail lives in each file's own header comment — these are pointers:

- `main.js` — shared page JS: nav, carousel, map, homepage events preview
- `events.js` — events page renderer: `events-data.json` first, live-ICS fallback via the two shared modules below
- `ics-core.js` — **shared ICS parser** (UMD/ES5): one file for browser fallback and CI sync, no parser drift
- `events-core.js` — **shared card builder** (UMD/ES5): tags, event type, card shape; key order pinned by a golden test in `tests/sync-events.spec.mjs`
- `kiosk/index.html` + `kiosk.js` — chrome-less wall display (`/kiosk/`, noindex, unlisted, JSON-only; NOT in `inject-layout.mjs`)
- `scripts/sync-events.mjs` — CI calendar sync: writes `events-data.json`, both primary feeds + `events/` copies, and the `feeds/` tree. Times are floating-local (CI pins `TZ=Europe/Berlin`; the iCal export carries a bundled VTIMEZONE)
- `finanz-core.js` — **shared funding math** (UMD/ES5): one file for the browser renderer (`finanz.js`) and the maintainer CLI, plus the field predicates (`isCalendarDate`, `isCleanHttpsUrl`) the CLI validator calls
- `scripts/finanz.mjs` + `scripts/finanz-data.mjs` — the funding board's CLI and its pure data layer; see [Editing the funding board](#editing-the-funding-board)
- `scripts/build-lite-finanz.mjs` — writes the lite page's funding block **and** its "Stand" date from `finanz.json` (deterministic → gated). Its sibling `build-lite-events.mjs` writes only the event list and is deploy-only (live data → never drift-free)
- `scripts/check-calendars.mjs` — manifest validator (offline, exits non-zero) + read-only `--probe` card preview; tested by `tests/calendars.spec.mjs`
- `jobs-core.js` — **shared expiry math** (UMD/ES5) for the job board: one file for `jobs.js` in the browser and for the CI gate, so a posting comes down on the same day everywhere
- `jobs.js` — the Pinnwand renderer: filters against the visitor's own calendar day, always appends the invite note ("Das könnte Euer Zettel sein :)", which doubles as the empty state), escapes every field and independently refuses a non-https url (an E2E test feeds it postings the gate would reject)
- `scripts/check-jobs.mjs` — offline gate for `jobs.json`: `validate()` is pure (no clock), `staleWarnings()` takes the day in; errors exit 1, expiry only warns. See [The job board](#the-job-board-pinnwand)
- `scripts/live-overlay.mjs`, `scripts/cache-bust.mjs`, `scripts/smoke-live.mjs` — the deploy pipeline's file logic (overlay preserving CI feeds + pruning, `?v=` busting, post-deploy health check incl. a full sitemap walk — any non-200 breaks the deploy), tested via `tests/deploy-scripts.spec.mjs`
- `llms.txt` — LLM-friendly site summary ([llms.txt standard](https://llmstxt.org/))
- `changelog.md` — release history (auto-updated by release workflow)
- `robots.txt` — crawler rules; explicitly allows AI bots, blocks `/ascii/`
- `google18556084d38e4dd8.html` — Google Search Console verification (do not delete)

## Adding a calendar source

Full guide — fields, source `type`s, filter rules: **`calendars/README.md`**. Short form: one JSON file per source, listed in `calendars/config.json` (order = dedupe priority; removing the line disables the source).

**Workflow:** `node scripts/check-calendars.mjs --probe "<ics-url>"` (read-only preview through the real pipeline, prints a paste-ready snippet) → create the JSON file → list it in `config.json` → **`pnpm run check:calendars`** (also a PR gate: catches typo'd keys, duplicate ids, and non-unique `name` — the key for `icsKeys`, RSS filter and stale-cache; an unlisted file is only a warning, parking is intentional).

Never run `sync-events.mjs` to try a link out: it overwrites the feeds **and rewrites the JSON-LD block in the tracked `events.html`**. `--probe` is the read-only path.

## Editing the funding board

`finanz.json` feeds the cost/funding board on `support.html#projekte`, `funding.json` the footer's "LIGHTS ON?" percentage. **Both are edited through one CLI** — never by hand, and no longer by a workflow.

```sh
pnpm run finanz                     # interactive menu (prints the board first)
pnpm run finanz --help              # usage on stdout, exit 0
pnpm run finanz list [--json]       # print the board (--json: JSON only, nothing else)
pnpm run finanz validate [--json]   # --json emits { ok, errors }
pnpm run finanz raise <id> <amount> # add to a project's "raised" (negative allowed)
pnpm run finanz finish <id>         # raised = target
pnpm run finanz pulse <0..7>        # append a value-free heartbeat level
pnpm run finanz percent <0..100>    # set the footer percentage in funding.json
pnpm run finanz:validate            # validate against finanz.schema.json
```

**Scriptable and agent-safe.** `--json` derives every number through
`finanz-core.js`, so `list --json` cannot drift from what `support.html`
renders. `add`, `monthly` and the bare menu are **interactive**: without a TTY
they exit 1 on stderr instead of printing a prompt, writing nothing and
returning 0 — there is no non-interactive path for adding an item, so a script
edits `finanz.json` and runs `finanz:validate`. `tests/finanz-cli.spec.mjs`
pins those exit codes.

**Amounts are whole euros.** `target`, `raised` and `monthly` are `integer` in the schema, so the CLI refuses a decimal at the point it is typed — naming the input ("12,50"), not the sum it would have produced. The interactive prompts re-ask instead of dropping out.

Every write validates **first** and refuses with an error naming the bad field, so an invalid `finanz.json` never reaches disk. Both files stay tracked on `main` — commit them like any other change. `pnpm run finanz:validate` is also a gate in both `ci.yml` **and** in `deploy.yml`, which catches the one path the CLI cannot: hand-editing the JSON. It runs on the deploy path too because the PR gate never sees a commit pushed straight to `main`.

**After changing `finanz.json`, run `pnpm run build:lite-finanz`** and commit `lite/index.html` alongside it. The lite page's "Projekte & Kosten" block and its "Stand" date are generated from `finanz.json` — the same drift gate that covers the layout partials covers this, so a forgotten rebuild fails the PR. (`pnpm run build` runs it together with the other deterministic generators.)

`finanz.schema.json` is the structural contract; `scripts/finanz-data.mjs` mirrors it in a hand-rolled validator (no ajv, no new dependency) and `tests/finanz-data.spec.mjs` asserts the two stay in lockstep.

**Privacy by construction:** only rounded aggregate totals plus a `pulse` track of integer 0..7 levels — never euro amounts, donor names, or per-donation records.

The pulse is **opt-in**: `finanz.json` ships without a `pulse` key, and `pulse.js` renders nothing until one exists. `pnpm run finanz pulse <0..7>` appends a level; the CLI never accepts a euro figure, so no amount can leak into the public file through it.

**Not yet rendered:** the schema accepts optional `url1`/`url2` per item and the CLI offers them, but `finanz.js` does not display them yet — staged separately (issue #28).

## The job board (Pinnwand)

`jobs.json` feeds `pinnwand.html` (clean URL `/pinnwand`): one object per posting, six required fields, **no optional ones**. Companies add theirs by pull request — the how-to, the copy-paste snippet and the donation channels all live on the page itself, so the instructions and the gate cannot drift apart (a unit test parses the snippet out of the HTML and validates it).

```sh
pnpm run check:jobs        # the gate: node scripts/check-jobs.mjs [file]
```

- **Runtime is `months: 1 | 3 | 12`** — the enum *is* the price list (Richtwert ab 50 / 120 / 400 €). Any other value is refused at the gate.
- **Half-open expiry:** a posting is up from `from` through the day *before* the same day-of-month `months` later — "1 month from 01.09." means up to and including 30.09. If that day-of-month does not exist in the target month (31.01. + 1), the run ends on the target month's last day. The math lives once, in `jobs-core.js`, and both the browser and the gate use it.
- **The browser does the filtering**, against the visitor's local calendar day — so a posting comes down on its own last day with no redeploy.
- **Expiry is a WARNING, never an error.** `check-jobs.mjs` runs in both `ci.yml` twins **and** in `deploy.yml`; failing on an expired posting would turn every deploy red on the day one runs out. Removing the entry is housekeeping, and the warning is the reminder.
- **The donation is checked by hand before the merge** — there is no payment webhook, and this is the one deliberately manual step. Verwendungszweck is `JOBS-<id>`; contributors name their channel and date in the PR description.
- No amounts, no contact details and no applicant data ever enter `jobs.json` — every card is a link to a vacancy hosted by the company.
- **The page is the wall.** One paragraph names the offer; everything procedural (the three steps, the snippet, the donation channels, the house rules) sits in collapsed `details.sidenote` blocks, the same idiom `raum-nutzen.html` uses. Companies are addressed as *ihr*, which is why the invite note says "Euer" — the rest of the site is *du*, this page is the exception, on purpose.

## Adding a new page

1. Create the HTML file
2. Nav link into `includes/site-header.html` → `pnpm run build:layout` → commit partial + HTML (register the page in `scripts/inject-layout.mjs` if it shares the chrome)
3. Add the page to the `pages` array in `tests/site.spec.js` (no-JS-errors test)
4. Sitemap is auto-generated on deploy

### Hidden and unlisted pages

The sitemap generator honors `noindex` meta, `robots.txt` `Disallow`, and `deploy.yml`'s `exclude-paths` (for no-`noindex` pages: the Google stub and `donations.html`).

- **Hidden pages** (e.g. `/ascii/`): use a subfolder like `ascii/index.html`, keep it out of `includes/site-header.html` **and** `scripts/inject-layout.mjs` (partials assume root-relative links); mark `noindex` and `Disallow` it in `robots.txt`.
- **Reachable-but-unlisted pages** (`invite-*/`, `join-*/` Signal redirect stubs, `kiosk/` wall display): `noindex` only, intentionally **not** `Disallow`ed — they're shareable links; don't re-add a robots block "for consistency".
